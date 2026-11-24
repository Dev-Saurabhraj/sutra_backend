// Wage rules as pure functions. See docs/RULES.md §C6 and README §3.4.
//
// Ledger model:
//   earned          = Σ work entries (attendance × day rate, pieces × piece rate)
//   wage due        = earned − WAGE paid − RECOVERY
//   advance pending = ADVANCE given − RECOVERY
// When wages are paid and an advance is pending, part of the wage is adjusted against the advance
// (RECOVERY). Deductions in one pay period are capped at 50% of that period's wages (Code on Wages, 2019).

import { round2 } from "../../shared/money.js";

export type WageTypeKind = "DAILY" | "PIECE" | "MONTHLY";
export type PayCycleKind = "DAILY" | "WEEKLY" | "MONTHLY";

/** Working days used to turn a monthly salary into a day rate. */
export const WORKING_DAYS_PER_MONTH = 26;
export const MAX_DEDUCTION_SHARE = 0.5;

const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** Calendar date in IST as a UTC-midnight Date (what Postgres `date` columns hold). */
export function istDate(at: Date): Date {
  const ist = new Date(at.getTime() + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** Rate for one full day present. */
export function dayRate(wageType: WageTypeKind, rate: number): number {
  return wageType === "MONTHLY" ? round2(rate / WORKING_DAYS_PER_MONTH) : rate;
}

export type Period = { start: Date; end: Date; payBy: Date };

/**
 * The pay period containing `now`, and the date wages for it must be paid by (Code on Wages s.17):
 * daily → end of that day; weekly (Mon–Sun, weekly off Sunday) → last working day, Saturday;
 * monthly → before the 7th of the next month.
 */
export function currentPeriod(cycle: PayCycleKind, now: Date): Period {
  const today = istDate(now);
  switch (cycle) {
    case "DAILY":
      return { start: today, end: today, payBy: today };
    case "WEEKLY": {
      const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
      const start = new Date(today.getTime() - dow * DAY_MS);
      const end = new Date(start.getTime() + 6 * DAY_MS);
      return { start, end, payBy: new Date(start.getTime() + 5 * DAY_MS) };
    }
    case "MONTHLY": {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
      return { start, end, payBy: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 7)) };
    }
  }
}

export type LedgerTotals = { earned: number; wagePaid: number; advanceGiven: number; recovered: number };

export function balances(t: LedgerTotals) {
  return {
    wageDue: round2(t.earned - t.wagePaid - t.recovered),
    advancePending: round2(t.advanceGiven - t.recovered),
  };
}

export type SettlementInput = {
  wageDue: number;
  advancePending: number;
  /** Wages earned in the current pay period (the 50% cap is per period). */
  earnedThisPeriod: number;
  /** Already recovered in the current pay period. */
  recoveredThisPeriod: number;
};

/** How a wage payment splits into an advance adjustment and cash in hand. */
export function settle(input: SettlementInput): { recovery: number; cash: number } {
  if (input.wageDue <= 0) return { recovery: 0, cash: 0 };
  const capLeft = Math.max(0, input.earnedThisPeriod * MAX_DEDUCTION_SHARE - input.recoveredThisPeriod);
  const recovery = round2(Math.min(input.advancePending, capLeft, input.wageDue));
  return { recovery: Math.max(0, recovery), cash: round2(input.wageDue - Math.max(0, recovery)) };
}
