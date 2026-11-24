import type { MessageSender, OrderChannel, OrderStatus, Prisma } from "@prisma/client";
import { num, type DbClient } from "../../core/db.js";
import type { OpenOrderLoad } from "../../engine/quote.js";

const orderInclude = {
  product: { select: { id: true, name: true, nameHi: true, palette: true, imageUrl: true, price: true, stock: true, unitsPerMachinePerWeek: true } },
  buyer: { select: { id: true, name: true, business: true, city: true, state: true, gstin: true, phone: true } },
} satisfies Prisma.OrderInclude;

const makerBrief = { slug: true, businessName: true, city: true, avatarColor: true, onTimeRate: true } satisfies Prisma.ProducerSelect;

type OrderWithParts = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export type OrderRow = ReturnType<typeof toRow>;

export class OrderRepository {
  constructor(private readonly db: DbClient) {}

  create(data: {
    code: string; producerId: string; productId: string; buyerId?: string | null; channel: OrderChannel; status: OrderStatus;
    qty: number; rate: number; wantedBy?: Date; fullDate?: Date; quoteNote?: string;
  }) {
    return this.db.order.create({ data: { ...data, buyerId: data.buyerId ?? null } });
  }

  async countByStatus(producerId: string, statuses: OrderStatus[]): Promise<number> {
    return this.db.order.count({ where: { producerId, status: { in: statuses } } });
  }

  /** Find a known buyer mentioned by city or business name in a voice note. */
  findBuyerByMention(mention: string) {
    if (!mention) return Promise.resolve(null);
    return this.db.buyer.findFirst({
      where: { OR: [{ city: { contains: mention, mode: "insensitive" } }, { business: { contains: mention, mode: "insensitive" } }] },
    });
  }

  async list(producerId: string, statuses: OrderStatus[], take = 50): Promise<(OrderRow & { lastMessage: { text: string; textHi: string | null; sender: MessageSender } | null })[]> {
    const rows = await this.db.order.findMany({
      where: { producerId, status: { in: statuses } },
      include: { ...orderInclude, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ updatedAt: "desc" }],
      take,
    });
    return rows.map((o) => {
      const m = o.messages[0];
      return { ...toRow(o), lastMessage: m ? { text: m.text, textHi: m.textHi, sender: m.sender } : null };
    });
  }

  async byCode(producerId: string, code: string): Promise<OrderRow | null> {
    const o = await this.db.order.findFirst({ where: { producerId, code }, include: orderInclude });
    return o ? toRow(o) : null;
  }

  /** A buyer's own orders, newest first, with the maker each one is with. */
  async listForBuyer(buyerId: string, take = 50) {
    const rows = await this.db.order.findMany({
      where: { buyerId },
      include: { ...orderInclude, producer: { select: makerBrief }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
      take,
    });
    return rows.map((o) => {
      const m = o.messages[0];
      return { ...toRow(o), maker: o.producer, lastMessage: m ? { text: m.textEn ?? m.text, sender: m.sender } : null };
    });
  }

  async byCodeForBuyer(buyerId: string, code: string) {
    const o = await this.db.order.findFirst({ where: { buyerId, code }, include: { ...orderInclude, producer: { select: makerBrief } } });
    return o ? { ...toRow(o), maker: o.producer } : null;
  }

  /** Orders created together by one request split across makers. */
  async group(parentCode: string) {
    return this.db.order.findMany({ where: { parentCode }, select: { code: true, qty: true, status: true, producer: { select: { businessName: true } } }, orderBy: { code: "asc" } });
  }

  async update(id: string, data: Prisma.OrderUncheckedUpdateInput): Promise<void> {
    await this.db.order.update({ where: { id }, data });
  }

  async producerOf(id: string): Promise<string> {
    const o = await this.db.order.findUniqueOrThrow({ where: { id }, select: { producerId: true } });
    return o.producerId;
  }

  async dispatchPhotoPath(id: string): Promise<string | null> {
    const o = await this.db.order.findUnique({ where: { id }, select: { dispatchPhoto: true } });
    return o?.dispatchPhoto ?? null;
  }

  /** Orders already booked on the producer's machines (feeds the "can I deliver?" simulation). */
  async openLoads(producerId: string, excludeOrderId?: string): Promise<OpenOrderLoad[]> {
    const rows = await this.db.order.findMany({
      where: { producerId, status: { in: ["CONFIRMED", "IN_PRODUCTION"] }, ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) },
      include: { product: { select: { stock: true, unitsPerMachinePerWeek: true } } },
    });
    return rows.map((o) => ({ productId: o.productId, qty: o.qty, productStock: o.product.stock, unitsPerMachinePerWeek: o.product.unitsPerMachinePerWeek }));
  }

  messages(orderId: string) {
    return this.db.message.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
  }

  addMessage(data: { producerId: string; orderId: string; sender: MessageSender; text: string; textHi: string | null; textEn: string | null }) {
    return this.db.message.create({ data });
  }

  invoices(orderId: string) {
    return this.db.invoice.findMany({ where: { orderId }, select: { id: true, number: true, kind: true, total: true }, orderBy: { issuedAt: "asc" } });
  }

  /** The latest sale document of an order (tax invoice / bill of supply, else the proforma). */
  async saleDocument(orderId: string) {
    const rows = await this.db.invoice.findMany({ where: { orderId }, orderBy: { issuedAt: "desc" } });
    const doc = rows.find((r) => r.kind !== "PROFORMA") ?? rows[0];
    return doc
      ? { kind: doc.kind, number: doc.number, issuedAt: doc.issuedAt, taxable: num(doc.taxable), cgst: num(doc.cgst), sgst: num(doc.sgst), igst: num(doc.igst), total: num(doc.total), gstRate: num(doc.gstRate), hsn: doc.hsn, itemName: doc.itemName, buyerName: doc.buyerName, buyerGstin: doc.buyerGstin, buyerState: doc.buyerState }
      : null;
  }
}

function toRow(o: OrderWithParts) {
  return {
    id: o.id, code: o.code, status: o.status, channel: o.channel, qty: o.qty, rate: num(o.rate),
    wantedBy: o.wantedBy, promisedQtyByWanted: o.promisedQtyByWanted, fullDate: o.fullDate, quoteNote: o.quoteNote,
    parentCode: o.parentCode, createdAt: o.createdAt, updatedAt: o.updatedAt, deliveredAt: o.deliveredAt,
    dispatchedAt: o.dispatchedAt, transporter: o.transporter, lrNumber: o.lrNumber, hasDispatchPhoto: !!o.dispatchPhoto, vehicleNo: o.vehicleNo,
    advance: o.advanceStatus
      ? { amount: num(o.advanceAmount), status: o.advanceStatus, ref: o.advanceRef, requestedAt: o.advanceRequestedAt, paidAt: o.advancePaidAt }
      : null,
    product: { id: o.product.id, name: o.product.name, nameHi: o.product.nameHi, palette: o.product.palette, imageUrl: o.product.imageUrl, price: num(o.product.price), stock: o.product.stock },
    buyer: o.buyer,
  };
}
