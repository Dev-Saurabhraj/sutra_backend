import type { AlertKind } from "@prisma/client";
import type { DbClient } from "../../core/db.js";

export type AlertInput = { producerId: string; kind: AlertKind; title: string; titleHi: string; body: string; bodyHi: string; route?: string };

export class AlertRepository {
  constructor(private readonly db: DbClient) {}

  list(producerId: string, opts: { unreadOnly: boolean; take: number }) {
    return this.db.alert.findMany({
      where: { producerId, ...(opts.unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: opts.take,
    });
  }

  create(data: AlertInput) {
    return this.db.alert.create({ data });
  }

  /** Avoid stacking the same low-stock alert again and again. */
  async hasUnread(producerId: string, kind: AlertKind, title: string): Promise<boolean> {
    return (await this.db.alert.count({ where: { producerId, kind, title, read: false } })) > 0;
  }

  async markRead(producerId: string, id?: string, kind?: AlertKind): Promise<number> {
    const r = await this.db.alert.updateMany({
      where: { producerId, read: false, ...(id ? { id } : {}), ...(kind ? { kind } : {}) },
      data: { read: true },
    });
    return r.count;
  }
}
