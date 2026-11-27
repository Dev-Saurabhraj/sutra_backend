import { describe, expect, it } from "vitest";
import type { Repositories, UnitOfWork } from "../../data/unit-of-work.js";
import type { ProducerProfile } from "../producers/producer.repository.js";
import { LabourService } from "./labour.service.js";
import type { PaymentRow, WorkerRow, WorkEntryRow } from "./labour.repository.js";

const NOW = new Date("2026-11-24T10:00:00Z"); // Tue 24 Nov 2026, 15:30 IST
const clock = { now: () => NOW };

let seq = 0;
const id = (p: string) => `${p}-${++seq}`;

function worker(over: Partial<WorkerRow> & { id: string }): WorkerRow {
  return { name: over.id, phone: null, skill: null, wageType: "DAILY", rate: 400, payCycle: "DAILY", productId: null, ...over };
}

function entry(over: Partial<WorkEntryRow> & { id: string; workerId: string; date: Date }): WorkEntryRow {
  return { kind: "ATTENDANCE", units: 1, rate: 400, amount: 400, note: null, ...over };
}

function payment(over: Partial<PaymentRow> & { id: string; workerId: string }): PaymentRow {
  return { kind: "WAGE", amount: 400, mode: "CASH", note: null, paidAt: NOW, ...over };
}

class FakeLabourRepo {
  constructor(
    public workers: WorkerRow[] = [],
    public entries: WorkEntryRow[] = [],
    public payments: PaymentRow[] = [],
  ) {}

  listWorkers = () => Promise.resolve(this.workers);
  findWorker = (_pid: string, workerId: string) => Promise.resolve(this.workers.find((w) => w.id === workerId) ?? null);
  entriesForWorkers = (_pid: string, ids: string[]) => Promise.resolve(this.entries.filter((e) => ids.includes(e.workerId)));
  paymentsForWorkers = (_pid: string, ids: string[]) => Promise.resolve(this.payments.filter((p) => ids.includes(p.workerId)));

  upsertAttendance = (data: { producerId: string; workerId: string; date: Date; units: number; rate: number; amount: number }) => {
    const existing = this.entries.find((e) => e.workerId === data.workerId && e.kind === "ATTENDANCE" && e.date.getTime() === data.date.getTime());
    if (existing) {
      Object.assign(existing, { units: data.units, rate: data.rate, amount: data.amount });
      return Promise.resolve(existing);
    }
    const row = entry({ id: id("att"), workerId: data.workerId, date: data.date, units: data.units, rate: data.rate, amount: data.amount });
    this.entries.push(row);
    return Promise.resolve(row);
  };

  createPiece = (data: { producerId: string; workerId: string; date: Date; units: number; rate: number; amount: number }) => {
    const row = entry({ id: id("piece"), workerId: data.workerId, date: data.date, kind: "PIECE", units: data.units, rate: data.rate, amount: data.amount });
    this.entries.push(row);
    return Promise.resolve(row);
  };

  createPayment = (data: { producerId: string; workerId: string; kind: PaymentRow["kind"]; amount: number; mode: PaymentRow["mode"]; note?: string | null }) => {
    const row = payment({ id: id("pay"), workerId: data.workerId, kind: data.kind, amount: data.amount, mode: data.mode, note: data.note ?? null });
    this.payments.push(row);
    return Promise.resolve(row);
  };
}

const producer: ProducerProfile = {
  id: "p1", slug: "rohit", name: "Rohit", businessName: "Kushwaha Handloom", city: "Chanderi", state: "Madhya Pradesh",
  phone: "+919800000001", gstin: null, gstScheme: "REGULAR", udyamNumber: null, upiId: null, machines: 12,
  avatarColor: "#B4441F", language: "hi", story: "", onTimeRate: 0.9, ordersDone: 0,
  cluster: { id: "c1", name: "Chanderi", city: "Chanderi" },
  industry: { key: "handloom", name: "Handloom", nameHi: "हथकरघा", machine: "loom", machineHi: "करघा", emoji: "🧵" },
};

function service(fake: FakeLabourRepo): LabourService {
  const repos = { labour: fake, producers: { findProfile: () => Promise.resolve(producer) } } as unknown as Repositories;
  const uow: UnitOfWork = { run: (fn) => fn(repos) };
  return new LabourService(repos, uow, clock);
}

describe("LabourService.team", () => {
  it("groups entries and payments into per-worker balances and team totals", async () => {
    const today = new Date("2026-11-24T00:00:00Z");
    const fake = new FakeLabourRepo(
      [
        worker({ id: "w1" }),
        worker({ id: "w2", rate: 500, payCycle: "WEEKLY" }),
      ],
      [
        entry({ id: "e1", workerId: "w1", date: today, amount: 400 }),
        entry({ id: "e2", workerId: "w2", date: new Date("2026-11-23T00:00:00Z"), rate: 500, amount: 500 }),
        entry({ id: "e3", workerId: "w2", date: today, rate: 500, amount: 500 }),
      ],
      [payment({ id: "p1", workerId: "w2", kind: "ADVANCE", amount: 1000 })],
    );

    const team = await service(fake).team("p1");

    expect(team.workers.find((w) => w.id === "w1")).toMatchObject({ wageDue: 400, advancePending: 0, earnedThisPeriod: 400, overdue: 0, todayUnits: 1 });
    expect(team.workers.find((w) => w.id === "w2")).toMatchObject({ wageDue: 1000, advancePending: 1000, earnedThisPeriod: 1000, overdue: 0, todayUnits: 1 });
    expect(team.totals).toEqual({ wageDue: 1400, overdue: 0, advancePending: 1000, earnedThisPeriod: 1400, presentToday: 2 });
  });

  it("flags daily wages from earlier days as overdue", async () => {
    const fake = new FakeLabourRepo(
      [worker({ id: "w1" })],
      [entry({ id: "e1", workerId: "w1", date: new Date("2026-11-20T00:00:00Z"), amount: 400 })],
      [],
    );

    const team = await service(fake).team("p1");
    expect(team.workers[0]).toMatchObject({ wageDue: 400, overdue: 400 });
  });
});

describe("LabourService.payPreview", () => {
  it("recovers an advance from wages, capped at 50% of this period's earnings", async () => {
    const today = new Date("2026-11-24T00:00:00Z");
    const fake = new FakeLabourRepo(
      [worker({ id: "w2", rate: 500, payCycle: "WEEKLY" })],
      [
        entry({ id: "e2", workerId: "w2", date: new Date("2026-11-23T00:00:00Z"), rate: 500, amount: 500 }),
        entry({ id: "e3", workerId: "w2", date: today, rate: 500, amount: 500 }),
      ],
      [payment({ id: "p1", workerId: "w2", kind: "ADVANCE", amount: 2000 })],
    );

    await expect(service(fake).payPreview("p1", "w2")).resolves.toEqual({ wageDue: 1000, advancePending: 2000, recovery: 500, cash: 500 });
  });
});

describe("LabourService.pay", () => {
  it("writes RECOVERY + WAGE atomically and returns a WhatsApp slip", async () => {
    const today = new Date("2026-11-24T00:00:00Z");
    const fake = new FakeLabourRepo(
      [worker({ id: "w2", name: "Mohan", rate: 500, payCycle: "WEEKLY", phone: "+919800000002" })],
      [
        entry({ id: "e2", workerId: "w2", date: new Date("2026-11-23T00:00:00Z"), rate: 500, amount: 500 }),
        entry({ id: "e3", workerId: "w2", date: today, rate: 500, amount: 500 }),
      ],
      [payment({ id: "p1", workerId: "w2", kind: "ADVANCE", amount: 2000 })],
    );

    const { slip } = await service(fake).pay("p1", "w2", "CASH");

    expect(fake.payments.filter((p) => p.kind === "RECOVERY").reduce((a, p) => a + p.amount, 0)).toBe(500);
    expect(fake.payments.filter((p) => p.kind === "WAGE").reduce((a, p) => a + p.amount, 0)).toBe(500);
    expect(slip.textEn).toContain("Advance adjusted");
    expect(slip.textEn).toContain("In hand");
    expect(slip.whatsappUrl).toContain("wa.me/919800000002");
  });

  it("supports a partial cash payment, recovering from the wages not paid in cash", async () => {
    const today = new Date("2026-11-24T00:00:00Z");
    const fake = new FakeLabourRepo(
      [worker({ id: "w2", rate: 500, payCycle: "WEEKLY" })],
      [
        entry({ id: "e2", workerId: "w2", date: new Date("2026-11-23T00:00:00Z"), rate: 500, amount: 500 }),
        entry({ id: "e3", workerId: "w2", date: today, rate: 500, amount: 500 }),
      ],
      [payment({ id: "p1", workerId: "w2", kind: "ADVANCE", amount: 2000 })],
    );

    await service(fake).pay("p1", "w2", "CASH", 300);
    expect(fake.payments.filter((p) => p.kind === "RECOVERY").reduce((a, p) => a + p.amount, 0)).toBe(500);
    expect(fake.payments.filter((p) => p.kind === "WAGE").reduce((a, p) => a + p.amount, 0)).toBe(300);
  });
});
