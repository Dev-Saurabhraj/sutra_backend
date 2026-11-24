import type { DbClient } from "../core/db.js";

/** Atomic named counters (row-locked upsert), for order codes and invoice series. */
export class CounterRepository {
  constructor(private readonly db: DbClient) {}

  async next(key: string, startAt = 1): Promise<number> {
    const row = await this.db.counter.upsert({
      where: { key },
      create: { key, value: startAt },
      update: { value: { increment: 1 } },
    });
    return row.value;
  }
}
