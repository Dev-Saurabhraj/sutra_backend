import type { EntrySource, PayCycle, PaymentMode, WageType, WorkerPaymentKind, WorkKind } from "@prisma/client";
import { num, type DbClient } from "../../core/db.js";
import type { LedgerTotals } from "./wages.js";

export type WorkerRow = {
  id: string;
  name: string;
  phone: string | null;
  skill: string | null;
  wageType: WageType;
  rate: number;
  productId: string | null;
  payCycle: PayCycle;
  active: boolean;
  joinedAt: Date;
};

export type NewWorker = { producerId: string; name: string; phone?: string | null; skill?: string | null; wageType: WageType; rate: number; productId?: string | null; payCycle: PayCycle };

const zero = (): LedgerTotals => ({ earned: 0, wagePaid: 0, advanceGiven: 0, recovered: 0 });

export class LabourRepository {
  constructor(private readonly db: DbClient) {}

  async workers(producerId: string, includeInactive = false): Promise<WorkerRow[]> {
    const rows = await this.db.worker.findMany({
      where: { producerId, ...(includeInactive ? {} : { active: true }) },
      orderBy: [{ active: "desc" }, { joinedAt: "asc" }],
    });
    return rows.map(toWorker);
  }

  async worker(producerId: string, id: string): Promise<WorkerRow | null> {
    const w = await this.db.worker.findFirst({ where: { id, producerId } });
    return w ? toWorker(w) : null;
  }

  async createWorker(data: NewWorker): Promise<WorkerRow> {
    return toWorker(await this.db.worker.create({ data }));
  }

  async updateWorker(id: string, data: Partial<Omit<NewWorker, "producerId">> & { active?: boolean }): Promise<WorkerRow> {
    return toWorker(await this.db.worker.update({ where: { id }, data }));
  }

  /** Lifetime ledger totals per worker (optionally only entries/payments on or after `since`). */
  async totals(producerId: string, since?: Date): Promise<Map<string, LedgerTotals>> {
    const [earned, paid] = await Promise.all([
      this.db.workEntry.groupBy({
        by: ["workerId"],
        where: { producerId, ...(since ? { date: { gte: since } } : {}) },
        _sum: { amount: true },
      }),
      this.db.workerPayment.groupBy({
        by: ["workerId", "kind"],
        where: { producerId, ...(since ? { paidAt: { gte: since } } : {}) },
        _sum: { amount: true },
      }),
    ]);
    const map = new Map<string, LedgerTotals>();
    const get = (id: string) => map.get(id) ?? map.set(id, zero()).get(id)!;
    for (const e of earned) get(e.workerId).earned = num(e._sum.amount);
    for (const p of paid) {
      const t = get(p.workerId);
      const v = num(p._sum.amount);
      if (p.kind === "WAGE") t.wagePaid = v;
      else if (p.kind === "ADVANCE") t.advanceGiven = v;
      else t.recovered = v;
    }
    return map;
  }

  async attendanceOn(producerId: string, date: Date): Promise<Map<string, number>> {
    const rows = await this.db.workEntry.findMany({ where: { producerId, kind: "ATTENDANCE", date }, select: { workerId: true, units: true } });
    return new Map(rows.map((r) => [r.workerId, num(r.units)]));
  }

  /** One attendance mark per worker per day: replaces the earlier mark if any. */
  async setAttendance(data: { producerId: string; workerId: string; date: Date; units: number; rate: number; amount: number; source: EntrySource }) {
    const existing = await this.db.workEntry.findFirst({ where: { workerId: data.workerId, date: data.date, kind: "ATTENDANCE" } });
    if (existing) {
      return this.db.workEntry.update({ where: { id: existing.id }, data: { units: data.units, rate: data.rate, amount: data.amount } });
    }
    return this.db.workEntry.create({ data: { ...data, kind: "ATTENDANCE" } });
  }

  addEntry(data: { producerId: string; workerId: string; kind: WorkKind; date: Date; units: number; rate: number; amount: number; productId?: string | null; note?: string; source: EntrySource }) {
    return this.db.workEntry.create({ data });
  }

  addPayment(data: { producerId: string; workerId: string; kind: WorkerPaymentKind; amount: number; mode: PaymentMode; note?: string; paidAt?: Date }) {
    return this.db.workerPayment.create({ data });
  }

  async history(workerId: string, take = 40) {
    const [entries, payments] = await Promise.all([
      this.db.workEntry.findMany({ where: { workerId }, orderBy: { date: "desc" }, take }),
      this.db.workerPayment.findMany({ where: { workerId }, orderBy: { paidAt: "desc" }, take }),
    ]);
    return {
      entries: entries.map((e) => ({ id: e.id, kind: e.kind, date: e.date, units: num(e.units), rate: num(e.rate), amount: num(e.amount), note: e.note })),
      payments: payments.map((p) => ({ id: p.id, kind: p.kind, amount: num(p.amount), mode: p.mode, note: p.note, paidAt: p.paidAt })),
    };
  }
}

function toWorker(w: {
  id: string; name: string; phone: string | null; skill: string | null; wageType: WageType; rate: unknown;
  productId: string | null; payCycle: PayCycle; active: boolean; joinedAt: Date;
}): WorkerRow {
  return {
    id: w.id, name: w.name, phone: w.phone, skill: w.skill, wageType: w.wageType, rate: Number(w.rate),
    productId: w.productId, payCycle: w.payCycle, active: w.active, joinedAt: w.joinedAt,
  };
}
