// GST periods in Indian time. Months, and quarters of the financial year (Q1 = Apr–Jun … Q4 = Jan–Mar).
import { AppError } from "../../core/errors.js";

const IST_MS = 5.5 * 3_600_000;
const istMidnight = (y: number, m0: number, d = 1) => new Date(Date.UTC(y, m0, d) - IST_MS);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type Period = { kind: "MONTH" | "QUARTER"; key: string; label: string; from: Date; to: Date };

/** "2026-11" → November 2026. */
export function monthPeriod(key: string): Period {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw AppError.badRequest("BAD_PERIOD", "Month must look like 2026-11");
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) throw AppError.badRequest("BAD_PERIOD", "Month must be 01–12");
  return { kind: "MONTH", key, label: `${MONTHS[mo]} ${y}`, from: istMidnight(y, mo), to: istMidnight(y, mo + 1) };
}

/** "2026-Q3" → financial year 2026-27, quarter 3 (Oct–Dec 2026). */
export function quarterPeriod(key: string): Period {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) throw AppError.badRequest("BAD_PERIOD", "Quarter must look like 2026-Q3");
  const fy = Number(m[1]);
  const q = Number(m[2]);
  const startMonth = (3 + (q - 1) * 3) % 12; // Q1 → Apr(3), Q4 → Jan(0)
  const year = q === 4 ? fy + 1 : fy;
  const from = istMidnight(year, startMonth);
  const to = istMidnight(year, startMonth + 3);
  return { kind: "QUARTER", key, label: `Q${q} ${fy}-${String((fy + 1) % 100).padStart(2, "0")} (${MONTHS[startMonth]}–${MONTHS[(startMonth + 2) % 12]})`, from, to };
}

function istParts(at: Date) {
  const ist = new Date(at.getTime() + IST_MS);
  return { y: ist.getUTCFullYear(), m0: ist.getUTCMonth() };
}

export function currentMonthKey(now: Date): string {
  const { y, m0 } = istParts(now);
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}

export function currentQuarterKey(now: Date): string {
  const { y, m0 } = istParts(now);
  const fy = m0 >= 3 ? y : y - 1;
  const q = m0 >= 3 ? Math.floor((m0 - 3) / 3) + 1 : 4;
  return `${fy}-Q${q}`;
}

/** Start of the financial year containing `now`. */
export function fyStart(now: Date): Date {
  const { y, m0 } = istParts(now);
  return istMidnight(m0 >= 3 ? y : y - 1, 3);
}

/** Recent periods for the period picker: the last 6 months and the last 4 quarters. */
export function recentPeriods(now: Date) {
  const { y, m0 } = istParts(now);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, m0 - i, 1));
    return monthPeriod(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  });
  const quarters: Period[] = [];
  let key = currentQuarterKey(now);
  for (let i = 0; i < 4; i++) {
    quarters.push(quarterPeriod(key));
    const [fy, q] = [Number(key.slice(0, 4)), Number(key.slice(-1))];
    key = q === 1 ? `${fy - 1}-Q4` : `${fy}-Q${q - 1}`;
  }
  return { months: months.map(({ key, label }) => ({ key, label })), quarters: quarters.map(({ key, label }) => ({ key, label })) };
}
