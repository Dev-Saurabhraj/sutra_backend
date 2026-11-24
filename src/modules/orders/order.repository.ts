import type { OrderChannel, OrderStatus } from "@prisma/client";
import type { DbClient } from "../../core/db.js";

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
}
