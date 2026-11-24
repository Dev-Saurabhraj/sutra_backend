import { describe, expect, it } from "vitest";
import { balances, currentPeriod, dayRate, istDate, settle } from "./wages.js";

describe("pay periods (Code on Wages s.17)", () => {
  const tuesday = new Date("2026-11-24T10:00:00Z"); // Tue 24 Nov, 15:30 IST

  it("weekly: Monday–Sunday, pay by Saturday", () => {
    const p = currentPeriod("WEEKLY", tuesday);
    expect(p.start.toISOString().slice(0, 10)).toBe("2026-11-23");
    expect(p.end.toISOString().slice(0, 10)).toBe("2026-11-29");
    expect(p.payBy.toISOString().slice(0, 10)).toBe("2026-11-28");
  });

  it("monthly: pay before the 7th of the next month", () => {
    const p = currentPeriod("MONTHLY", tuesday);
    expect(p.start.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(p.end.toISOString().slice(0, 10)).toBe("2026-11-30");
    expect(p.payBy.toISOString().slice(0, 10)).toBe("2026-12-07");
  });

  it("uses the Indian calendar day, not UTC", () => {
    expect(istDate(new Date("2026-11-24T20:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-25"); // 01:30 IST next day
  });
});

describe("wages", () => {
  it("turns a monthly salary into a day rate over 26 working days", () => {
    expect(dayRate("MONTHLY", 9100)).toBe(350);
    expect(dayRate("DAILY", 400)).toBe(400);
  });

  it("keeps wage due and advance pending as separate balances", () => {
    expect(balances({ earned: 5600, wagePaid: 2000, advanceGiven: 3000, recovered: 1000 })).toEqual({ wageDue: 2600, advancePending: 2000 });
  });

  it("recovers an advance from wages, at most 50% of this period's earnings", () => {
    // earned 2,800 this week, advance 5,000 pending → recover 1,400, pay 1,400 cash
    expect(settle({ wageDue: 2800, advancePending: 5000, earnedThisPeriod: 2800, recoveredThisPeriod: 0 })).toEqual({ recovery: 1400, cash: 1400 });
  });

  it("recovers only what is pending and respects earlier recoveries this period", () => {
    expect(settle({ wageDue: 2800, advancePending: 300, earnedThisPeriod: 2800, recoveredThisPeriod: 0 })).toEqual({ recovery: 300, cash: 2500 });
    expect(settle({ wageDue: 1000, advancePending: 5000, earnedThisPeriod: 2800, recoveredThisPeriod: 1400 })).toEqual({ recovery: 0, cash: 1000 });
  });

  it("pays nothing when nothing is due", () => {
    expect(settle({ wageDue: 0, advancePending: 1000, earnedThisPeriod: 0, recoveredThisPeriod: 0 })).toEqual({ recovery: 0, cash: 0 });
  });
});
