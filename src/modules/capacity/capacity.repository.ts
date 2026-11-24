import type { CapacityKind } from "@prisma/client";
import type { DbClient } from "../../core/db.js";

export type CapacityEventRow = { id: string; kind: CapacityKind; startsOn: Date; endsOn: Date; machinesOff: number; note: string | null };

const select = { id: true, kind: true, startsOn: true, endsOn: true, machinesOff: true, note: true } as const;

export class CapacityRepository {
  constructor(private readonly db: DbClient) {}

  /** Events that have not ended yet, for one or many producers. */
  upcoming(producerIds: string[], today: Date): Promise<(CapacityEventRow & { producerId: string })[]> {
    if (producerIds.length === 0) return Promise.resolve([]);
    return this.db.capacityEvent.findMany({
      where: { producerId: { in: producerIds }, endsOn: { gte: today } },
      select: { ...select, producerId: true },
      orderBy: { startsOn: "asc" },
    });
  }

  create(data: { producerId: string; kind: CapacityKind; startsOn: Date; endsOn: Date; machinesOff: number; note?: string | null }): Promise<CapacityEventRow> {
    return this.db.capacityEvent.create({ data, select });
  }

  async remove(producerId: string, id: string): Promise<boolean> {
    const r = await this.db.capacityEvent.deleteMany({ where: { id, producerId } });
    return r.count === 1;
  }
}
