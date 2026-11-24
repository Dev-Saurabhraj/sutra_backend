import type { MessageSender, OrderChannel, OrderStatus, Prisma } from "@prisma/client";
import { num, type DbClient } from "../../core/db.js";
import type { OpenOrderLoad } from "../../engine/quote.js";

const orderInclude = {
  product: { select: { id: true, name: true, nameHi: true, palette: true, imageUrl: true, price: true, stock: true, unitsPerMachinePerWeek: true } },
  buyer: { select: { id: true, name: true, business: true, city: true, state: true, gstin: true, phone: true } },
} satisfies Prisma.OrderInclude;

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

  async update(id: string, data: Prisma.OrderUncheckedUpdateInput): Promise<void> {
    await this.db.order.update({ where: { id }, data });
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
}

function toRow(o: OrderWithParts) {
  return {
    id: o.id, code: o.code, status: o.status, channel: o.channel, qty: o.qty, rate: num(o.rate),
    wantedBy: o.wantedBy, promisedQtyByWanted: o.promisedQtyByWanted, fullDate: o.fullDate, quoteNote: o.quoteNote,
    parentCode: o.parentCode, createdAt: o.createdAt, updatedAt: o.updatedAt, deliveredAt: o.deliveredAt,
    dispatchedAt: o.dispatchedAt, transporter: o.transporter, lrNumber: o.lrNumber, hasDispatchPhoto: !!o.dispatchPhoto,
    product: { id: o.product.id, name: o.product.name, nameHi: o.product.nameHi, palette: o.product.palette, imageUrl: o.product.imageUrl, price: num(o.product.price), stock: o.product.stock },
    buyer: o.buyer,
  };
}
