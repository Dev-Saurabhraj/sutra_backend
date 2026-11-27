import type { PaymentMode } from "@prisma/client";
import { AppError } from "../../core/errors.js";
import type { Repositories, UnitOfWork } from "../../data/unit-of-work.js";
import { inr, round2 } from "../../shared/money.js";
import type { Clock } from "../../shared/time.js";
import type { ProducerProfile } from "../producers/producer.repository.js";
import { balances, currentPeriod, dayRate, istDate, MAX_DEDUCTION_SHARE, settle, type Period } from "./wages.js";
import type { PaymentRow, WorkerRow, WorkEntryRow } from "./labour.repository.js";

export type WorkerView = {
  id: string;
  name: string;
  phone: string | null;
  skill: string | null;
  wageType: WorkerRow["wageType"];
  rate: number;
  /** Earned but not yet paid (negative = paid ahead). */
  wageDue: number;
  /** Advance (peshgi) still to be recovered. */
  advancePending: number;
  earnedThisPeriod: number;
  /** Part of the due amount whose legal pay-by date has passed. */
  overdue: number;
  period: { payBy: Date };
  /** Today's attendance: 1, 0.5, 0, or null if not marked. */
  todayUnits: number | null;
};

export type TeamSummary = {
  workers: WorkerView[];
  totals: {
    wageDue: number;
    overdue: number;
    advancePending: number;
    earnedThisPeriod: number;
    presentToday: number;
  };
};

export type PayPreview = { wageDue: number; advancePending: number; recovery: number; cash: number };
export type WageSlip = { textHi: string; textEn: string; whatsappUrl: string };
export type AddWorkerInput = { name: string; phone?: string; wageType: WorkerRow["wageType"]; rate: number; payCycle: WorkerRow["payCycle"] };

export class LabourService {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async team(producerId: string): Promise<TeamSummary> {
    const now = this.clock.now();
    const workers = await this.repos.labour.listWorkers(producerId);
    const ids = workers.map((w) => w.id);
    const [entries, payments] = await Promise.all([
      this.repos.labour.entriesForWorkers(producerId, ids),
      this.repos.labour.paymentsForWorkers(producerId, ids),
    ]);
    const entriesBy = groupBy(entries, (e) => e.workerId);
    const paymentsBy = groupBy(payments, (p) => p.workerId);
    const views = workers.map((w) => this.view(w, entriesBy.get(w.id) ?? [], paymentsBy.get(w.id) ?? [], now));

    return {
      workers: views,
      totals: {
        wageDue: round2(views.reduce((a, v) => a + Math.max(0, v.wageDue), 0)),
        overdue: round2(views.reduce((a, v) => a + v.overdue, 0)),
        advancePending: round2(views.reduce((a, v) => a + v.advancePending, 0)),
        earnedThisPeriod: round2(views.reduce((a, v) => a + v.earnedThisPeriod, 0)),
        presentToday: views.filter((v) => (v.todayUnits ?? 0) > 0).length,
      },
    };
  }

  addWorker(producerId: string, input: AddWorkerInput): Promise<WorkerRow> {
    return this.repos.labour.createWorker({
      producerId,
      name: input.name,
      phone: input.phone?.trim() || null,
      wageType: input.wageType,
      rate: input.rate,
      payCycle: input.payCycle,
    });
  }

  /** Mark attendance for today (1 = full day, 0.5 = half, 0 = absent). Returns the fresh team view. */
  async attendance(producerId: string, marks: { workerId: string; units: number }[]): Promise<TeamSummary> {
    const today = istDate(this.clock.now());
    const workers = await this.repos.labour.listWorkers(producerId);
    const byId = new Map(workers.map((w) => [w.id, w]));
    for (const mark of marks) {
      const worker = byId.get(mark.workerId);
      if (!worker) throw AppError.notFound("Worker");
      const rate = dayRate(worker.wageType, worker.rate);
      await this.repos.labour.upsertAttendance({
        producerId,
        workerId: mark.workerId,
        date: today,
        units: mark.units,
        rate,
        amount: round2(mark.units * rate),
      });
    }
    return this.team(producerId);
  }

  async piece(producerId: string, workerId: string, qty: number): Promise<void> {
    const worker = await this.requireWorker(producerId, workerId);
    await this.repos.labour.createPiece({
      producerId,
      workerId,
      date: istDate(this.clock.now()),
      units: qty,
      rate: worker.rate,
      amount: round2(qty * worker.rate),
      productId: worker.productId,
    });
  }

  async payPreview(producerId: string, workerId: string): Promise<PayPreview> {
    const worker = await this.requireWorker(producerId, workerId);
    const [entries, payments] = await this.ledgerFor(producerId, workerId);
    return this.settlementFor(worker, entries, payments, this.clock.now());
  }

  /** Pay wages: part of the due amount is adjusted against any pending advance (RECOVERY), the rest is cash. */
  async pay(producerId: string, workerId: string, mode: PaymentMode, cash?: number): Promise<{ slip: WageSlip }> {
    const now = this.clock.now();
    const [worker, producer] = await Promise.all([this.requireWorker(producerId, workerId), this.producer(producerId)]);
    const [entries, payments] = await this.ledgerFor(producerId, workerId);
    const settlement = this.settlementFor(worker, entries, payments, now, cash);
    if (settlement.cash <= 0 && settlement.recovery <= 0) {
      throw AppError.badRequest("NOTHING_DUE", "Nothing is due to this worker");
    }

    await this.uow.run(async (repos) => {
      if (settlement.recovery > 0) {
        await repos.labour.createPayment({ producerId, workerId, kind: "RECOVERY", amount: settlement.recovery, mode, note: "Advance adjusted" });
      }
      if (settlement.cash > 0) {
        await repos.labour.createPayment({ producerId, workerId, kind: "WAGE", amount: settlement.cash, mode, note: mode === "CASH" ? "Wages paid" : `Wages paid (${mode})` });
      }
    });

    return { slip: this.slipFor(worker, producer, settlement) };
  }

  async advance(producerId: string, workerId: string, amount: number, mode: PaymentMode): Promise<void> {
    await this.requireWorker(producerId, workerId);
    await this.repos.labour.createPayment({ producerId, workerId, kind: "ADVANCE", amount, mode, note: "Advance (peshgi)" });
  }

  async history(producerId: string, workerId: string) {
    await this.requireWorker(producerId, workerId);
    const [entries, payments] = await this.ledgerFor(producerId, workerId);
    return {
      entries: entries.map((e) => ({ kind: e.kind, amount: e.amount, date: e.date.toISOString(), units: e.units, note: e.note })),
      payments: payments.map((p) => ({ kind: p.kind, amount: p.amount, paidAt: p.paidAt.toISOString(), note: p.note })),
    };
  }

  /** A shareable wage slip for the current due, without saving anything. */
  async slip(producerId: string, workerId: string): Promise<WageSlip> {
    const now = this.clock.now();
    const [worker, producer, entries, payments] = await Promise.all([
      this.requireWorker(producerId, workerId),
      this.producer(producerId),
      ...(await this.ledgerFor(producerId, workerId)),
    ]);
    const settlement = this.settlementFor(worker, entries, payments, now);
    return this.slipFor(worker, producer, settlement);
  }

  private view(w: WorkerRow, entries: WorkEntryRow[], payments: PaymentRow[], now: Date): WorkerView {
    const t = this.ledger(entries, payments);
    const period = currentPeriod(w.payCycle, now);
    const todayMs = istDate(now).getTime();
    const earnedThisPeriod = round2(entries.filter((e) => within(e.date, period)).reduce((a, e) => a + e.amount, 0));
    const earnedOverdue = entries
      .filter((e) => currentPeriod(w.payCycle, e.date).payBy.getTime() < todayMs)
      .reduce((a, e) => a + e.amount, 0);
    const settled = t.wagePaid + t.recovered;
    const todayEntry = entries.find((e) => e.kind === "ATTENDANCE" && e.date.getTime() === todayMs);

    return {
      id: w.id,
      name: w.name,
      phone: w.phone,
      skill: w.skill,
      wageType: w.wageType,
      rate: w.rate,
      wageDue: t.wageDue,
      advancePending: t.advancePending,
      earnedThisPeriod,
      overdue: round2(Math.max(0, earnedOverdue - settled)),
      period: { payBy: period.payBy },
      todayUnits: todayEntry ? todayEntry.units : null,
    };
  }

  /** Wage due and advance pending, plus the raw sums needed for the 50% recovery cap. */
  private ledger(entries: WorkEntryRow[], payments: PaymentRow[]) {
    const earned = entries.reduce((a, e) => a + e.amount, 0);
    const wagePaid = payments.filter((p) => p.kind === "WAGE").reduce((a, p) => a + p.amount, 0);
    const advanceGiven = payments.filter((p) => p.kind === "ADVANCE").reduce((a, p) => a + p.amount, 0);
    const recovered = payments.filter((p) => p.kind === "RECOVERY").reduce((a, p) => a + p.amount, 0);
    return { ...balances({ earned, wagePaid, advanceGiven, recovered }), wagePaid, recovered };
  }

  private settlementFor(w: WorkerRow, entries: WorkEntryRow[], payments: PaymentRow[], now: Date, cash?: number): PayPreview {
    const t = this.ledger(entries, payments);
    const period = currentPeriod(w.payCycle, now);
    const earnedThisPeriod = round2(entries.filter((e) => within(e.date, period)).reduce((a, e) => a + e.amount, 0));
    const recoveredThisPeriod = round2(
      payments.filter((p) => p.kind === "RECOVERY" && within(istDate(p.paidAt), period)).reduce((a, p) => a + p.amount, 0),
    );

    if (cash === undefined) {
      const s = settle({ wageDue: t.wageDue, advancePending: t.advancePending, earnedThisPeriod, recoveredThisPeriod });
      return { wageDue: t.wageDue, advancePending: t.advancePending, recovery: s.recovery, cash: s.cash };
    }

    // Partial payment: hand exactly `cash`, and adjust the wages not paid in cash against the advance.
    const cashPaid = round2(Math.min(Math.max(0, cash), t.wageDue));
    const capLeft = Math.max(0, earnedThisPeriod * MAX_DEDUCTION_SHARE - recoveredThisPeriod);
    const recovery = round2(Math.min(t.advancePending, capLeft, Math.max(0, t.wageDue - cashPaid)));
    return { wageDue: t.wageDue, advancePending: t.advancePending, recovery: Math.max(0, recovery), cash: cashPaid };
  }

  private slipFor(w: WorkerRow, producer: ProducerProfile, s: { recovery: number; cash: number }): WageSlip {
    const settled = round2(s.recovery + s.cash);
    const recoveryLineHi = s.recovery > 0 ? `\nएडवांस कटौती: ${inr(s.recovery)}` : "";
    const recoveryLineEn = s.recovery > 0 ? `\nAdvance adjusted: ${inr(s.recovery)}` : "";
    const textHi = `वेतन पर्ची — ${w.name}\n${producer.businessName}\nदेय मज़दूरी: ${inr(settled)}${recoveryLineHi}\nहाथ में: ${inr(s.cash)}`;
    const textEn = `Wage slip — ${w.name}\n${producer.businessName}\nWages settled: ${inr(settled)}${recoveryLineEn}\nIn hand: ${inr(s.cash)}`;
    const digits = (w.phone ?? "").replace(/\D/g, "");
    return { textHi, textEn, whatsappUrl: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(textHi)}` : "" };
  }

  private async requireWorker(producerId: string, workerId: string): Promise<WorkerRow> {
    const worker = await this.repos.labour.findWorker(producerId, workerId);
    if (!worker) throw AppError.notFound("Worker");
    return worker;
  }

  private async producer(producerId: string): Promise<ProducerProfile> {
    const p = await this.repos.producers.findProfile(producerId);
    if (!p) throw AppError.notFound("Producer");
    return p;
  }

  private ledgerFor(producerId: string, workerId: string) {
    return Promise.all([
      this.repos.labour.entriesForWorkers(producerId, [workerId]),
      this.repos.labour.paymentsForWorkers(producerId, [workerId]),
    ]);
  }
}

function within(date: Date, period: Period): boolean {
  const t = date.getTime();
  return t >= period.start.getTime() && t <= period.end.getTime();
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
