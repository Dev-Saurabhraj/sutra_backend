import type { Prisma } from "@prisma/client";
import type { DbClient } from "../../core/db.js";

export class VoiceRepository {
  constructor(private readonly db: DbClient) {}

  create(data: { producerId: string; transcript: string; parsed: Prisma.InputJsonValue; parser: string }) {
    return this.db.voiceEntry.create({ data });
  }

  find(producerId: string, id: string) {
    return this.db.voiceEntry.findFirst({ where: { id, producerId } });
  }

  /** Claim the entry for confirmation. Returns false if it was already confirmed (double tap / retry). */
  async claim(producerId: string, id: string, at: Date): Promise<boolean> {
    const r = await this.db.voiceEntry.updateMany({ where: { id, producerId, confirmedAt: null }, data: { confirmedAt: at } });
    return r.count === 1;
  }
}
