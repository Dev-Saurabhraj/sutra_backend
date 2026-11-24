import type { Prisma } from "@prisma/client";
import type { DbClient } from "../../core/db.js";

export class BillRepository {
  constructor(private readonly db: DbClient) {}

  create(data: { producerId: string; imagePath: string | null; sampleKey: string | null; parsed: Prisma.InputJsonValue; parser: string }) {
    return this.db.billScan.create({ data });
  }

  find(producerId: string, id: string) {
    return this.db.billScan.findFirst({ where: { id, producerId } });
  }

  /** Claim the scan for saving. False if it was already saved (double tap / retry). */
  async claim(producerId: string, id: string, at: Date): Promise<boolean> {
    const r = await this.db.billScan.updateMany({ where: { id, producerId, confirmedAt: null }, data: { confirmedAt: at } });
    return r.count === 1;
  }

  async linkPurchase(id: string, purchaseId: string): Promise<void> {
    await this.db.billScan.update({ where: { id }, data: { purchaseId } });
  }
}
