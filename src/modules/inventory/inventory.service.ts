import type { EntrySource } from "@prisma/client";
import { AppError } from "../../core/errors.js";
import type { PriceWatch } from "../stock/price-watch.js";
import type { Repositories, UnitOfWork } from "../../data/unit-of-work.js";
import type { EventBus } from "../../events/event-bus.js";
import { stateForCity } from "../../shared/gst/states.js";
import { validateGstin } from "../../shared/gst/gstin.js";
import { splitTax } from "../../shared/gst/tax.js";
import { inr, round2, round3 } from "../../shared/money.js";
import { addDays, type Clock } from "../../shared/time.js";
import type { InvoiceService } from "../invoices/invoice.service.js";
import type { LabourService } from "../labour/labour.service.js";
import type { ProducerProfile } from "../producers/producer.repository.js";
import type { StockService } from "../stock/stock.service.js";

const PAYMENT_TERMS_DAYS = 15;

export type SaleBuyer = { id: string | null; name: string; gstin: string | null; state: string };

/**
 * The whole chain in one place: supplier → raw material → making → ready goods → client.
 * The `*In` methods run inside a caller's unit of work (voice entries use them too); the rest open their own.
 */
export class InventoryService {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly invoices: InvoiceService,
    private readonly labour: LabourService,
    private readonly stock: StockService,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly prices: PriceWatch,
  ) {}

  // ------------------------------------------------------------ core operations (inside a unit of work)

  /** Make N pieces: finished stock up, raw material down by recipe, piece wages for the worker if given. */
  async produceIn(repos: Repositories, producer: ProducerProfile, input: { productId: string; qty: number; workerId?: string | null; source: EntrySource }) {
    const product = await repos.stock.product(producer.id, input.productId);
    if (!product) throw AppError.notFound("Product");
    await repos.stock.moveProduct({ producerId: producer.id, productId: product.id, kind: "PRODUCE", qty: input.qty, source: input.source }, input.qty);
    for (const line of product.recipe) {
      const used = round3(line.qtyPerUnit * input.qty);
      await repos.stock.moveMaterial({ producerId: producer.id, materialId: line.materialId, kind: "CONSUME", qty: -used, source: input.source });
    }
    if (input.workerId) {
      await this.labour.addPieceWork(repos, producer.id, { workerId: input.workerId, qty: input.qty, productId: product.id, source: input.source, note: product.name });
    }
    return { product, consumedMaterialIds: product.recipe.map((r) => r.materialId) };
  }

  /** Sell N pieces: stock down, a direct order, the right GST document, and a khata entry to collect. */
  async sellIn(
    repos: Repositories,
    producer: ProducerProfile,
    input: { productId: string; qty: number; rate?: number; buyer: SaleBuyer; source: EntrySource; note?: string },
  ) {
    const product = await repos.stock.product(producer.id, input.productId);
    if (!product) throw AppError.notFound("Product");
    const now = this.clock.now();
    const rate = input.rate ?? product.price;
    const order = await repos.orders.create({
      code: `SUT-${await repos.counters.next("order", 1001)}`,
      producerId: producer.id, productId: product.id, buyerId: input.buyer.id, channel: "DIRECT", status: "DISPATCHED",
      qty: input.qty, rate, wantedBy: now, fullDate: now, quoteNote: input.note,
    });
    const invoice = await this.shipIn(repos, producer, { productId: product.id, qty: input.qty, rate, buyer: input.buyer, orderId: order.id, source: input.source });
    return { product, invoice };
  }

  /**
   * Goods leave the workshop for an order: finished stock down, the right GST document, money to collect.
   * Used by a direct sale and by dispatching a buyer's order.
   */
  async shipIn(
    repos: Repositories,
    producer: ProducerProfile,
    input: { productId: string; qty: number; rate: number; buyer: SaleBuyer; orderId: string; source: EntrySource; alreadyPaid?: number },
  ) {
    const product = await repos.stock.product(producer.id, input.productId);
    if (!product) throw AppError.notFound("Product");
    const now = this.clock.now();
    await repos.stock.moveProduct(
      { producerId: producer.id, productId: product.id, kind: "SALE", qty: -input.qty, source: input.source },
      -Math.min(input.qty, product.stock),
    );
    const invoice = await this.invoices.issueForSale(repos, {
      producer, buyer: input.buyer, item: { name: product.name, hsn: product.hsn, gstRate: product.gstRate },
      qty: input.qty, rate: input.rate, orderId: input.orderId, at: now,
    });
    const paid = Math.min(input.alreadyPaid ?? 0, invoice.total);
    if (invoice.total - paid > 0.5) {
      await repos.khata.create({
        producerId: producer.id, party: input.buyer.name, direction: "RECEIVE", amount: round2(invoice.total - paid),
        note: paid > 0 ? `Invoice ${invoice.number} (advance ${inr(paid)} received)` : `Invoice ${invoice.number}`,
        dueDate: addDays(now, PAYMENT_TERMS_DAYS), invoiceNo: invoice.number,
      });
    }
    return invoice;
  }

  /** Raw material came in. With a supplier and rate it is also a GST purchase and money to pay. */
  async stockInIn(
    repos: Repositories,
    producer: ProducerProfile,
    input: { materialId: string; qty: number; rate?: number; supplierId?: string | null; billNo?: string; source: EntrySource },
  ) {
    const material = await repos.stock.materialWithSupplier(producer.id, input.materialId);
    if (!material) throw AppError.notFound("Material");
    await repos.stock.moveMaterial({ producerId: producer.id, materialId: material.id, kind: "PURCHASE", qty: input.qty, source: input.source, note: input.billNo });
    const supplierId = input.supplierId ?? material.supplier?.id ?? null;
    if (!input.rate || !supplierId) return { material, purchaseId: null };

    const supplier = await repos.partners.supplier(producer.id, supplierId);
    if (!supplier) throw AppError.notFound("Supplier");
    const full = await repos.stock.materialGst(material.id);
    const tax = splitTax(input.qty * input.rate, full.gstRate, supplier.state, producer.state);
    const purchase = await repos.stock.createPurchase({
      producerId: producer.id, supplierId, billNo: input.billNo || `APP-${Date.now().toString(36).toUpperCase()}`, billDate: this.clock.now(),
      ...tax, gstinValid: validateGstin(supplier.gstin).valid,
      items: [{ materialId: material.id, qty: input.qty, rate: input.rate, amount: round2(input.qty * input.rate) }],
    });
    await this.prices.check(repos, producer.id, material.id, input.rate, supplier.name);
    await repos.stock.setMaterialCost(material.id, input.rate);
    await repos.khata.create({
      producerId: producer.id, party: supplier.name, direction: "PAY", amount: tax.total,
      note: `${input.qty} ${material.unit} ${material.name}`, dueDate: addDays(this.clock.now(), PAYMENT_TERMS_DAYS),
    });
    return { material, purchaseId: purchase.id };
  }

  // ------------------------------------------------------------ app-facing operations

  async produce(producerId: string, input: { productId: string; qty: number; workerId?: string | null }) {
    const producer = await this.producer(producerId);
    if (producer.businessKind === "TRADER") throw AppError.badRequest("TRADER_NO_PRODUCTION", "Traders buy finished goods; use stock-in instead");
    const r = await this.uow.run((repos) => this.produceIn(repos, producer, { ...input, source: "APP" }));
    await this.bus.publish("stock.materialsConsumed", { producerId, materialIds: r.consumedMaterialIds });
    return this.flow(producerId);
  }

  async sell(producerId: string, input: { productId: string; qty: number; rate?: number; clientId?: string; walkIn?: { name: string; city: string } }) {
    const producer = await this.producer(producerId);
    const buyer = await this.resolveBuyer(producer, input);
    const r = await this.uow.run((repos) => this.sellIn(repos, producer, { ...input, buyer, source: "APP" }));
    return { invoice: { id: r.invoice.id, number: r.invoice.number, kind: r.invoice.kind, total: r.invoice.total } };
  }

  async stockIn(producerId: string, input: { materialId: string; qty: number; rate?: number; supplierId?: string; billNo?: string }) {
    const producer = await this.producer(producerId);
    await this.uow.run((repos) => this.stockInIn(repos, producer, { ...input, source: "APP" }));
    await this.repos.alerts.markRead(producerId, undefined, "LOW_STOCK");
    return this.flow(producerId);
  }

  /** Counted the stock and it differs: write the difference as an adjustment. */
  async adjust(producerId: string, input: { materialId?: string; productId?: string; actual: number; reason?: string }) {
    await this.uow.run(async (repos) => {
      if (input.materialId) {
        const m = await repos.stock.materialWithSupplier(producerId, input.materialId);
        if (!m) throw AppError.notFound("Material");
        const delta = round3(input.actual - m.stock);
        if (delta !== 0) await repos.stock.moveMaterial({ producerId, materialId: m.id, kind: "ADJUST", qty: delta, source: "APP", note: input.reason ?? "Stock count" });
      } else if (input.productId) {
        const p = await repos.stock.product(producerId, input.productId);
        if (!p) throw AppError.notFound("Product");
        const delta = Math.round(input.actual) - p.stock;
        if (delta !== 0) await repos.stock.moveProduct({ producerId, productId: p.id, kind: "ADJUST", qty: delta, source: "APP", note: input.reason ?? "Stock count" }, delta);
      } else throw AppError.badRequest("NOTHING_TO_ADJUST", "Say which material or product to adjust");
    });
    return this.flow(producerId);
  }

  async addMaterial(producerId: string, input: { name: string; nameHi?: string; unit: string; hsn?: string; gstRate?: number; costPerUnit: number; stock: number; supplierId?: string }) {
    if (input.supplierId && !(await this.repos.partners.supplier(producerId, input.supplierId))) throw AppError.notFound("Supplier");
    await this.uow.run(async (repos) => {
      const id = await repos.stock.createMaterial({
        producerId, supplierId: input.supplierId ?? null, name: input.name, nameHi: input.nameHi || input.name, unit: input.unit,
        hsn: input.hsn ?? "", gstRate: input.gstRate ?? 18, costPerUnit: input.costPerUnit,
      });
      if (input.stock > 0) await repos.stock.moveMaterial({ producerId, materialId: id, kind: "ADJUST", qty: input.stock, source: "APP", note: "Opening stock" });
    });
    return this.flow(producerId);
  }

  async addProduct(producerId: string, input: {
    name: string; nameHi?: string; category?: string; price: number; hsn?: string; gstRate?: number; stock: number;
    unitsPerMachinePerWeek?: number; recipe: { materialId: string; qtyPerUnit: number }[];
  }) {
    const materials = new Set((await this.repos.stock.materialBrief(producerId)).map((m) => m.id));
    if (input.recipe.some((r) => !materials.has(r.materialId))) throw AppError.badRequest("BAD_RECIPE", "Recipe uses a material you don't have");
    await this.uow.run(async (repos) => {
      const id = await repos.stock.createProduct({
        producerId, slug: `${producerId.slice(-6)}-${Date.now().toString(36)}`, name: input.name, nameHi: input.nameHi || input.name,
        category: input.category || input.name, story: "", price: input.price, hsn: input.hsn ?? "", gstRate: input.gstRate ?? 5,
        unitsPerMachinePerWeek: input.unitsPerMachinePerWeek ?? 5, palette: "#B4441F,#F4D9A6", recipe: input.recipe,
      });
      if (input.stock > 0) await repos.stock.moveProduct({ producerId, productId: id, kind: "ADJUST", qty: input.stock, source: "APP", note: "Opening stock" }, input.stock);
    });
    return this.flow(producerId);
  }

  suppliers(producerId: string) {
    return this.repos.partners.suppliers(producerId);
  }

  addSupplier(producerId: string, input: { name: string; phone: string; city: string; state: string; gstin?: string; leadTimeDays: number }) {
    return this.repos.partners.createSupplier({ ...input, producerId, gstin: (input.gstin ?? "").toUpperCase() });
  }

  clients(producerId: string) {
    return this.repos.partners.clients(producerId);
  }

  addClient(producerId: string, input: { name: string; business?: string; phone: string; city: string; state?: string; gstin?: string }) {
    return this.repos.partners.createClient({
      producerId, name: input.name, business: input.business || input.name, phone: input.phone, city: input.city,
      state: input.state || stateForCity(input.city) || "", gstin: input.gstin ? input.gstin.toUpperCase() : null,
    });
  }

  movements(producerId: string, filter: { materialId?: string; productId?: string }, take = 40) {
    return this.repos.stock.movements(producerId, filter, take);
  }

  /** The five stations of the flow, with the numbers that matter at each. */
  async flow(producerId: string) {
    const producer = await this.producer(producerId);
    const weekAgo = addDays(this.clock.now(), -7);
    const [suppliers, health, products, clients, khata, inMaking, madeThisWeek, soldThisWeek] = await Promise.all([
      this.repos.partners.suppliers(producerId),
      this.stock.health(producerId),
      this.repos.stock.products(producerId),
      this.repos.partners.clients(producerId),
      this.repos.khata.openTotals(producerId),
      this.repos.orders.countByStatus(producerId, ["CONFIRMED", "IN_PRODUCTION"]),
      this.repos.stock.movedSince(producerId, "PRODUCE", weekAgo),
      this.repos.stock.movedSince(producerId, "SALE", weekAgo),
    ]);
    return {
      kind: producer.businessKind,
      suppliers: { count: suppliers.length, toPay: khata.toPay },
      raw: {
        items: health.length,
        low: health.filter((m) => m.status !== "OK").length,
        value: round2(health.reduce((a, m) => a + m.stockValue, 0)),
      },
      making: { openOrders: inMaking, madeThisWeek },
      ready: {
        items: products.length,
        units: products.reduce((a, p) => a + p.stock, 0),
        value: round2(products.reduce((a, p) => a + p.stock * p.price, 0)),
      },
      clients: { count: clients.length, toReceive: khata.toReceive, soldThisWeek },
      materials: health,
      products,
    };
  }

  private async resolveBuyer(producer: ProducerProfile, input: { clientId?: string; walkIn?: { name: string; city: string } }): Promise<SaleBuyer> {
    if (input.clientId) {
      const c = await this.repos.partners.client(producer.id, input.clientId);
      if (!c) throw AppError.notFound("Client");
      return { id: c.id, name: `${c.business}, ${c.city}`, gstin: c.gstin, state: c.state || producer.state };
    }
    const city = input.walkIn?.city || producer.city;
    return { id: null, name: input.walkIn?.name || `Customer, ${city}`, gstin: null, state: stateForCity(city) ?? producer.state };
  }

  private async producer(producerId: string): Promise<ProducerProfile> {
    const p = await this.repos.producers.findProfile(producerId);
    if (!p) throw AppError.notFound("Producer");
    return p;
  }
}
