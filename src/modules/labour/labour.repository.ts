import type { PaymentMode, PayCycle, Prisma, WageType, WorkKind, WorkerPaymentKind } from "@prisma/client";
import { num, type DbClient } from "../../core/db.js";

export type WorkerRow = {
  id: string;
  name: string;
  phone: string | null;
  skill: string | null;
  wageType: WageType;
  rate: number;
  payCycle: PayCycle;
  productId: string | null;
};

export type WorkEntryRow = {
  id: string;
  workerId: string;
  kind: WorkKind;
  date: Date;
  units: number;
  rate: number;
  amount: number;
  note: string | null;
};

export type PaymentRow = {
  id: string;
  workerId: string;
  kind: WorkerPaymentKind;
  amount: number;
  mode: PaymentMode;
  note: string | null;
  paidAt: Date;
};

export class LabourRepository {
  constructor(private readonly db: DbClient) {}

  async listWorkers(producerId: string): Promise<WorkerRow[]> {
    const rows = await this.db.worker.findMany({ where: { producerId, active: true }, orderBy: { name: "asc" } });
    return rows.map(toWorker);
  }

  async findWorker(producerId: string, workerId: string): Promise<WorkerRow | null> {
    const row = await this.db.worker.findFirst({ where: { id: workerId, producerId } });
    return row ? toWorker(row) : null;
  }

  async createWorker(data: {
    producerId: string;
    name: string;
    phone?: string | null;
    wageType: WageType;
    rate: number;
    payCycle: PayCycle;
  }): Promise<WorkerRow> {
    return toWorker(await this.db.worker.create({ data }));
  }

  async entriesForWorkers(producerId: string, workerIds: string[]): Promise<WorkEntryRow[]> {
    if (workerIds.length === 0) return [];
    const rows = await this.db.workEntry.findMany({
      where: { producerId, workerId: { in: workerIds } },
      orderBy: { date: "desc" },
    });
    return rows.map(toEntry);
  }

  async paymentsForWorkers(producerId: string, workerIds: string[]): Promise<PaymentRow[]> {
    if (workerIds.length === 0) return [];
    const rows = await this.db.workerPayment.findMany({
      where: { producerId, workerId: { in: workerIds } },
      orderBy: { paidAt: "desc" },
    });
    return rows.map(toPayment);
  }

  /** One attendance row per worker per day: update an existing mark, otherwise create it. */
  async upsertAttendance(data: { producerId: string; workerId: string; date: Date; units: number; rate: number; amount: number }): Promise<WorkEntryRow> {
    const existing = await this.db.workEntry.findFirst({
      where: { producerId: data.producerId, workerId: data.workerId, kind: "ATTENDANCE", date: data.date },
    });
    if (existing) {
      return toEntry(await this.db.workEntry.update({ where: { id: existing.id }, data: { units: data.units, rate: data.rate, amount: data.amount } }));
    }
    return toEntry(await this.db.workEntry.create({ data: { ...data, kind: "ATTENDANCE", source: "APP" } }));
  }

  async createPiece(data: {
    producerId: string;
    workerId: string;
    date: Date;
    units: number;
    rate: number;
    amount: number;
    productId?: string | null;
    note?: string | null;
  }): Promise<WorkEntryRow> {
    return toEntry(await this.db.workEntry.create({ data: { ...data, kind: "PIECE", source: "APP", productId: data.productId ?? null } }));
  }

  async createPayment(data: {
    producerId: string;
    workerId: string;
    kind: WorkerPaymentKind;
    amount: number;
    mode: PaymentMode;
    note?: string | null;
  }): Promise<PaymentRow> {
    return toPayment(await this.db.workerPayment.create({ data }));
  }
}

function toWorker(r: {
  id: string;
  name: string;
  phone: string | null;
  skill: string | null;
  wageType: WageType;
  rate: Prisma.Decimal | number | null;
  payCycle: PayCycle;
  productId: string | null;
}): WorkerRow {
  return { id: r.id, name: r.name, phone: r.phone, skill: r.skill, wageType: r.wageType, rate: num(r.rate), payCycle: r.payCycle, productId: r.productId };
}

function toEntry(r: {
  id: string;
  workerId: string;
  kind: WorkKind;
  date: Date;
  units: Prisma.Decimal | number | null;
  rate: Prisma.Decimal | number | null;
  amount: Prisma.Decimal | number | null;
  note: string | null;
}): WorkEntryRow {
  return { id: r.id, workerId: r.workerId, kind: r.kind, date: r.date, units: num(r.units), rate: num(r.rate), amount: num(r.amount), note: r.note };
}

function toPayment(r: {
  id: string;
  workerId: string;
  kind: WorkerPaymentKind;
  amount: Prisma.Decimal | number | null;
  mode: PaymentMode;
  note: string | null;
  paidAt: Date;
}): PaymentRow {
  return { id: r.id, workerId: r.workerId, kind: r.kind, amount: num(r.amount), mode: r.mode, note: r.note, paidAt: r.paidAt };
}
