import type { OrderStatus } from "@prisma/client";
import { AppError } from "../../core/errors.js";
import type { FileStore } from "../../core/file-store.js";
import type { Repositories, UnitOfWork } from "../../data/unit-of-work.js";
import type { Translator } from "../../ai/translator.js";
import { availableActions, deliveredOnTime, nextStatus, updatedOnTimeRate, type OrderAction, type OrderStatusKind } from "../../engine/order-flow.js";
import { margin, unitCost } from "../../engine/pricing.js";
import { quote } from "../../engine/quote.js";
import { stateForCity } from "../../shared/gst/states.js";
import { addDays, shortDate, type Clock } from "../../shared/time.js";
import type { InventoryService, SaleBuyer } from "../inventory/inventory.service.js";
import type { ProducerProfile } from "../producers/producer.repository.js";
import type { OrderRow } from "./order.repository.js";

export type OrderTab = "new" | "active" | "done";
const TABS: Record<OrderTab, OrderStatus[]> = {
  new: ["QUOTED"],
  active: ["CONFIRMED", "IN_PRODUCTION", "DISPATCHED"],
  done: ["DELIVERED", "DECLINED"],
};
const DEFAULT_WANTED_DAYS = 14;

export type DispatchInput = { transporter?: string; lrNumber?: string; photo?: { base64: string; mediaType: string } };

/** The orders inbox: answer requests honestly, move orders through their stages, talk to the buyer. */
export class OrderService {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly inventory: InventoryService,
    private readonly translator: Translator,
    private readonly files: FileStore,
    private readonly clock: Clock,
  ) {}

  async inbox(producerId: string, tab: OrderTab) {
    const [orders, counts] = await Promise.all([
      this.repos.orders.list(producerId, TABS[tab]),
      Promise.all((Object.keys(TABS) as OrderTab[]).map(async (t) => [t, await this.repos.orders.countByStatus(producerId, TABS[t])] as const)),
    ]);
    return { tab, counts: Object.fromEntries(counts), orders };
  }

  /** Everything needed to decide on an order: can I deliver, is the price worth it, what the buyer said. */
  async detail(producerId: string, code: string) {
    const producer = await this.producer(producerId);
    const order = await this.order(producerId, code);
    const [canDeliver, price, messages, invoices] = await Promise.all([
      this.canDeliver(producer, order),
      this.priceCheck(producerId, order),
      this.repos.orders.messages(order.id),
      this.repos.orders.invoices(order.id),
    ]);
    return {
      order,
      actions: availableActions(order.status as OrderStatusKind),
      canDeliver,
      price,
      messages: messages.map((m) => ({
        id: m.id, sender: m.sender, text: m.text, textHi: m.textHi, textEn: m.textEn, createdAt: m.createdAt,
        translated: m.sender === "BUYER" ? !!m.textHi && m.textHi !== m.text : !!m.textEn && m.textEn !== m.text,
      })),
      invoices: invoices.map((i) => ({ ...i, total: Number(i.total) })),
    };
  }

  async respond(producerId: string, code: string, accept: boolean) {
    const producer = await this.producer(producerId);
    const order = await this.order(producerId, code);
    const to = this.transition(order, accept ? "accept" : "decline");
    const plan = accept ? await this.canDeliver(producer, order) : null;
    await this.uow.run(async (repos) => {
      await repos.orders.update(order.id, {
        status: to,
        ...(plan ? { promisedQtyByWanted: plan.qtyByWanted, fullDate: plan.fullDate } : {}),
      });
      const wanted = order.wantedBy;
      const [hi, en] = accept && plan
        ? [
            `ऑर्डर मंज़ूर। ${plan.qtyByWanted} पीस ${shortDate(wanted, "hi")} तक, पूरे ${order.qty} ${shortDate(plan.fullDate, "hi")} तक।`,
            `Order accepted. ${plan.qtyByWanted} pieces by ${shortDate(wanted)}, all ${order.qty} by ${shortDate(plan.fullDate)}.`,
          ]
        : ["माफ़ कीजिए, इस बार यह ऑर्डर नहीं ले पाएँगे।", "Sorry, we can't take this order this time."];
      await repos.orders.addMessage({ producerId, orderId: order.id, sender: "PRODUCER", text: hi, textHi: hi, textEn: en });
      await repos.alerts.markRead(producerId, undefined, "ORDER");
    });
    return this.detail(producerId, code);
  }

  /** Goods leave: tax invoice (or bill of supply), money to collect, and proof the buyer can see. */
  async dispatch(producerId: string, code: string, input: DispatchInput) {
    const producer = await this.producer(producerId);
    const order = await this.order(producerId, code);
    const to = this.transition(order, "dispatch");
    if (order.product.stock < order.qty) {
      throw AppError.conflict("NOT_READY", `Only ${order.product.stock} of ${order.qty} pieces are in stock. Record what was made first, then dispatch.`);
    }
    const photo = input.photo
      ? await this.files.save(`dispatch-${producerId}`, Buffer.from(input.photo.base64, "base64"), input.photo.mediaType.split("/")[1] ?? "jpg")
      : null;
    const now = this.clock.now();
    await this.uow.run(async (repos) => {
      await this.inventory.shipIn(repos, producer, {
        productId: order.product.id, qty: order.qty, rate: order.rate, buyer: this.buyerOf(order, producer), orderId: order.id, source: "APP",
      });
      await repos.orders.update(order.id, {
        status: to, dispatchedAt: now, transporter: input.transporter || null, lrNumber: input.lrNumber || null, dispatchPhoto: photo,
      });
      const via = [input.transporter, input.lrNumber ? `LR ${input.lrNumber}` : ""].filter(Boolean).join(", ");
      const hi = `माल भेज दिया${via ? ` (${via})` : ""}। बिल साथ में है।`;
      const en = `Dispatched today${via ? ` via ${via}` : ""}. The invoice is attached to the order.`;
      await repos.orders.addMessage({ producerId, orderId: order.id, sender: "PRODUCER", text: hi, textHi: hi, textEn: en });
    });
    return this.detail(producerId, code);
  }

  async deliver(producerId: string, code: string) {
    const producer = await this.producer(producerId);
    const order = await this.order(producerId, code);
    const to = this.transition(order, "deliver");
    const now = this.clock.now();
    await this.uow.run(async (repos) => {
      await repos.orders.update(order.id, { status: to, deliveredAt: now });
      await repos.producers.recordDelivery(producerId, updatedOnTimeRate(producer.onTimeRate, producer.ordersDone, deliveredOnTime(order.wantedBy, now)));
    });
    return this.detail(producerId, code);
  }

  /** The producer writes in Hindi; the buyer reads English (the original is always kept). */
  async message(producerId: string, code: string, text: string) {
    const order = await this.order(producerId, code);
    const clean = text.trim();
    const en = await this.translator.translate(clean, "en");
    await this.repos.orders.addMessage({ producerId, orderId: order.id, sender: "PRODUCER", text: clean, textHi: clean, textEn: en ?? clean });
    return this.detail(producerId, code);
  }

  /** Proof of dispatch photo (only the producer sees it here; the buyer portal will get its own link). */
  async dispatchPhoto(producerId: string, code: string): Promise<{ bytes: Buffer; mediaType: string }> {
    const order = await this.repos.orders.byCode(producerId, code);
    const stored = order ? await this.repos.orders.dispatchPhotoPath(order.id) : null;
    const bytes = stored ? await this.files.read(stored) : null;
    if (!stored || !bytes) throw AppError.notFound("Dispatch photo");
    const ext = stored.split(".").pop() ?? "jpg";
    return { bytes, mediaType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
  }

  // ---------------------------------------------------------------- helpers

  /** Live simulation: stock, machines, other open orders, material lead times. */
  private async canDeliver(producer: ProducerProfile, order: OrderRow) {
    if (!["QUOTED", "CONFIRMED", "IN_PRODUCTION"].includes(order.status)) return null;
    const product = await this.repos.stock.recipeDetails(producer.id, order.product.id);
    if (!product) return null;
    const now = this.clock.now();
    const q = quote({
      product: { id: product.id, name: product.name, stock: product.stock, unitsPerMachinePerWeek: product.unitsPerMachinePerWeek, recipe: product.recipe },
      machines: producer.machines,
      openOrders: await this.repos.orders.openLoads(producer.id, order.id),
      qty: order.qty,
      wantedBy: order.wantedBy ?? addDays(now, DEFAULT_WANTED_DAYS),
      now,
    });
    return {
      qty: q.qty, wantedBy: q.wantedBy, ready: q.ready, perDay: Math.round(q.perDay * 100) / 100, backlogDays: Math.round(q.backlogDays * 10) / 10,
      qtyByWanted: q.qtyByWanted, fullDate: q.fullDate, canMeet: q.canMeet, shortfalls: q.shortfalls,
      curve: q.curve.filter((_, i) => i % 2 === 0 || i === q.curve.length - 1),
    };
  }

  /** Price floor: materials by recipe at latest rates + piece wages, against the order's rate. */
  private async priceCheck(producerId: string, order: OrderRow) {
    const [product, workers] = await Promise.all([this.repos.stock.recipeDetails(producerId, order.product.id), this.repos.labour.workers(producerId)]);
    if (!product) return null;
    const pieceRates = workers.filter((w) => w.wageType === "PIECE" && w.productId === product.id).map((w) => w.rate);
    const labour = pieceRates.length ? pieceRates.reduce((a, b) => a + b, 0) / pieceRates.length : 0;
    const cost = unitCost(product.recipe, labour);
    return { rate: order.rate, cost, margin: margin(order.rate, cost.total), labourKnown: pieceRates.length > 0 };
  }

  private transition(order: OrderRow, action: OrderAction): OrderStatusKind {
    const to = nextStatus(order.status as OrderStatusKind, action);
    if (!to) throw AppError.conflict("WRONG_STAGE", `This order is ${order.status.toLowerCase().replace("_", " ")}; it can't ${action} now`);
    return to;
  }

  private buyerOf(order: OrderRow, producer: ProducerProfile): SaleBuyer {
    const b = order.buyer;
    if (!b) return { id: null, name: `Customer, ${producer.city}`, gstin: null, state: producer.state };
    return { id: b.id, name: `${b.business}, ${b.city}`, gstin: b.gstin, state: b.state || stateForCity(b.city) || producer.state };
  }

  private async order(producerId: string, code: string): Promise<OrderRow> {
    const o = await this.repos.orders.byCode(producerId, code);
    if (!o) throw AppError.notFound("Order");
    return o;
  }

  private async producer(producerId: string): Promise<ProducerProfile> {
    const p = await this.repos.producers.findProfile(producerId);
    if (!p) throw AppError.notFound("Producer");
    return p;
  }
}
