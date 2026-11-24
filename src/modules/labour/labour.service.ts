import type { EntrySource, PaymentMode } from "@prisma/client";
import { AppError } from "../../core/errors.js";
import type { Repositories, UnitOfWork } from "../../data/unit-of-work.js";
import { inr, round2 } from "../../shared/money.js";
import { shortDate, type Clock } from "../../shared/time.js";
import type { NewWorker, WorkerRow } from "./labour.repository.js";
import { balances, currentPeriod, dayRate, istDate, settle, type Period } from "./wages.js";

export type WorkerView = WorkerRow & {
  wageDue: number;
  advancePending: number;
  earnedThisPeriod: number;
  /** Part of the wage due that belongs to earlier periods whose pay-by date has passed. */
  overdue: number;
  period: Period;
  todayUnits: number | null;
};

/** Labour: attendance and piece work create earnings; wages and advances are payments. */
export class LabourService {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async summary(producerId: string) {
    const now = this.clock.now();
    const today = istDate(now);
    const workers = await this.repos.labour.workers(producerId);
    const [lifetime, attendance] = await Promise.all([this.repos.labour.totals(producerId), this.repos.labour.attendanceOn(producerId, today)]);
    // Periods depend only on the pay cycle, so one query per distinct cycle (not per worker).
    const cycles = [...new Set(workers.map((w) => w.payCycle))];
    const periodTotals = new Map(
      await Promise.all(cycles.map(async (c) => [c, await this.repos.labour.totals(producerId, currentPeriod(c, now).start)] as const)),
    );
    const views: WorkerView[] = [];
    for (const w of workers) {
      const period = currentPeriod(w.payCycle, now);
      const inPeriod = periodTotals.get(w.payCycle)?.get(w.id);
      const { wageDue, advancePending } = balances(lifetime.get(w.id) ?? { earned: 0, wagePaid: 0, advanceGiven: 0, recovered: 0 });
      const earnedThisPeriod = inPeriod?.earned ?? 0;
      views.push({
        ...w, wageDue, advancePending, earnedThisPeriod, period,
        overdue: round2(Math.max(0, wageDue - earnedThisPeriod)),
        todayUnits: attendance.get(w.id) ?? null,
      });
    }
    return {
      today,
      workers: views,
      totals: {
        wageDue: round2(views.reduce((a, w) => a + Math.max(0, w.wageDue), 0)),
        overdue: round2(views.reduce((a, w) => a + w.overdue, 0)),
        advancePending: round2(views.reduce((a, w) => a + Math.max(0, w.advancePending), 0)),
        earnedThisPeriod: round2(views.reduce((a, w) => a + w.earnedThisPeriod, 0)),
        presentToday: views.filter((w) => (w.todayUnits ?? 0) > 0).length,
      },
    };
  }

  addWorker(producerId: string, input: Omit<NewWorker, "producerId">) {
    return this.repos.labour.createWorker({ ...input, producerId });
  }

  async updateWorker(producerId: string, id: string, input: Partial<Omit<NewWorker, "producerId">> & { active?: boolean }) {
    await this.worker(producerId, id);
    return this.repos.labour.updateWorker(id, input);
  }

  /** Today's roll call: 1 = present, 0.5 = half day, 0 = absent. Re-marking replaces the earlier mark. */
  async markAttendance(producerId: string, marks: { workerId: string; units: number }[], on?: Date) {
    const date = istDate(on ?? this.clock.now());
    await this.uow.run(async (repos) => {
      for (const m of marks) {
        const w = await repos.labour.worker(producerId, m.workerId);
        if (!w) throw AppError.notFound("Worker");
        // Piece-rate workers earn by pieces; attendance only records that they came.
        const rate = w.wageType === "PIECE" ? 0 : dayRate(w.wageType, w.rate);
        await repos.labour.setAttendance({ producerId, workerId: w.id, date, units: m.units, rate, amount: round2(rate * m.units), source: "APP" });
      }
    });
    return this.summary(producerId);
  }

  /** Piece work: N pieces at the worker's piece rate (or a given rate). Usable inside another unit of work. */
  async addPieceWork(
    repos: Repositories,
    producerId: string,
    input: { workerId: string; qty: number; productId?: string | null; rate?: number; source: EntrySource; note?: string },
  ) {
    const w = await repos.labour.worker(producerId, input.workerId);
    if (!w) throw AppError.notFound("Worker");
    const rate = input.rate ?? (w.wageType === "PIECE" ? w.rate : 0);
    if (rate <= 0) throw AppError.badRequest("NO_PIECE_RATE", "Set a piece rate for this work");
    return repos.labour.addEntry({
      producerId, workerId: w.id, kind: "PIECE", date: istDate(this.clock.now()), units: input.qty, rate,
      amount: round2(rate * input.qty), productId: input.productId ?? w.productId, note: input.note, source: input.source,
    });
  }

  /** Piece work entered on its own (not as part of a production entry). */
  async recordPieceWork(producerId: string, input: { workerId: string; qty: number; productId?: string; rate?: number; note?: string }) {
    await this.uow.run((repos) => this.addPieceWork(repos, producerId, { ...input, source: "APP" }));
    return this.payPreview(producerId, input.workerId);
  }

  /** What paying now would look like: advance recovery (≤ 50% of this period's wages) and cash in hand. */
  async payPreview(producerId: string, workerId: string) {
    const w = await this.worker(producerId, workerId);
    const period = currentPeriod(w.payCycle, this.clock.now());
    const [lifetime, inPeriod] = await Promise.all([this.repos.labour.totals(producerId), this.repos.labour.totals(producerId, period.start)]);
    const life = lifetime.get(w.id) ?? { earned: 0, wagePaid: 0, advanceGiven: 0, recovered: 0 };
    const { wageDue, advancePending } = balances(life);
    const split = settle({ wageDue, advancePending, earnedThisPeriod: inPeriod.get(w.id)?.earned ?? 0, recoveredThisPeriod: inPeriod.get(w.id)?.recovered ?? 0 });
    return { workerId: w.id, name: w.name, wageDue, advancePending, ...split };
  }

  /** Pay wages: record the advance adjustment and the cash actually handed over. */
  async pay(producerId: string, workerId: string, input: { mode: PaymentMode; cash?: number }) {
    const preview = await this.payPreview(producerId, workerId);
    if (preview.wageDue <= 0) throw AppError.badRequest("NOTHING_DUE", "No wages are due for this worker");
    const cash = round2(Math.min(input.cash ?? preview.cash, preview.wageDue - preview.recovery));
    await this.uow.run(async (repos) => {
      if (preview.recovery > 0) {
        await repos.labour.addPayment({ producerId, workerId, kind: "RECOVERY", amount: preview.recovery, mode: input.mode, note: "Advance adjusted from wages" });
      }
      if (cash > 0) await repos.labour.addPayment({ producerId, workerId, kind: "WAGE", amount: cash, mode: input.mode });
    });
    return { ...preview, cash, slip: await this.slip(producerId, workerId) };
  }

  async giveAdvance(producerId: string, workerId: string, input: { amount: number; mode: PaymentMode; note?: string }) {
    await this.worker(producerId, workerId);
    await this.repos.labour.addPayment({ producerId, workerId, kind: "ADVANCE", amount: round2(input.amount), mode: input.mode, note: input.note });
    return this.payPreview(producerId, workerId);
  }

  async history(producerId: string, workerId: string) {
    const w = await this.worker(producerId, workerId);
    return { worker: w, ...(await this.repos.labour.history(workerId)) };
  }

  /** A short wage slip for WhatsApp, in Hindi and English. */
  async slip(producerId: string, workerId: string) {
    const [w, producer] = await Promise.all([this.worker(producerId, workerId), this.repos.producers.findProfile(producerId)]);
    const now = this.clock.now();
    const period = currentPeriod(w.payCycle, now);
    const inPeriod = (await this.repos.labour.totals(producerId, period.start)).get(w.id) ?? { earned: 0, wagePaid: 0, advanceGiven: 0, recovered: 0 };
    const { wageDue, advancePending } = balances((await this.repos.labour.totals(producerId)).get(w.id) ?? { earned: 0, wagePaid: 0, advanceGiven: 0, recovered: 0 });
    const from = shortDate(period.start, "hi");
    const textHi =
      `${producer?.businessName ?? ""} — मज़दूरी पर्ची\n${w.name}, ${from} से\n` +
      `कमाई: ${inr(inPeriod.earned)}\nपेशगी कटी: ${inr(inPeriod.recovered)}\nदिया: ${inr(inPeriod.wagePaid)}\n` +
      `बाकी: ${inr(Math.max(0, wageDue))}${advancePending > 0 ? `\nपेशगी बाकी: ${inr(advancePending)}` : ""}`;
    const textEn =
      `${producer?.businessName ?? ""} — wage slip\n${w.name}, from ${shortDate(period.start)}\n` +
      `Earned: ${inr(inPeriod.earned)}\nAdvance adjusted: ${inr(inPeriod.recovered)}\nPaid: ${inr(inPeriod.wagePaid)}\n` +
      `Due: ${inr(Math.max(0, wageDue))}${advancePending > 0 ? `\nAdvance pending: ${inr(advancePending)}` : ""}`;
    const phone = (w.phone ?? "").replace(/\D/g, "");
    return { textHi, textEn, whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(textHi)}` };
  }

  private async worker(producerId: string, id: string): Promise<WorkerRow> {
    const w = await this.repos.labour.worker(producerId, id);
    if (!w) throw AppError.notFound("Worker");
    return w;
  }
}
