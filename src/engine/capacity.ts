// Capacity calendar (P24): holidays, weddings, power cuts, absences and repairs take machines off for some days.
// Pure: days are counted from `now` (day 1 = tomorrow, like the quote simulation).
import { addDays, DAY_MS } from "../shared/time.js";

export type CapacityEventInput = { startsOn: Date; endsOn: Date; machinesOff: number; kind: string; note?: string | null };

/** Machines off on simulation days fromDay..toDay (inclusive). */
export type Downtime = { fromDay: number; toDay: number; machinesOff: number };

const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Calendar dates → simulation day numbers. Events that ended before today are dropped. */
export function toDowntime(events: CapacityEventInput[], now: Date): Downtime[] {
  const today = startOfDay(now);
  return events
    .map((e) => ({
      fromDay: Math.round((startOfDay(e.startsOn) - today) / DAY_MS),
      toDay: Math.round((startOfDay(e.endsOn) - today) / DAY_MS),
      machinesOff: Math.max(0, Math.round(e.machinesOff)),
    }))
    .filter((d) => d.toDay >= 0 && d.toDay >= d.fromDay);
}

/** Share of the machines working on `day` (0..1). Overlapping events add up, capped at all machines. */
export function workingShare(downtime: Downtime[] | undefined, machines: number, day: number): number {
  if (!downtime?.length || machines <= 0) return 1;
  const off = downtime.reduce((a, d) => (day >= d.fromDay && day <= d.toDay ? a + d.machinesOff : a), 0);
  return Math.max(0, machines - off) / machines;
}

export type CapacityDay = { date: string; machines: number; off: number };

/** The next `days` days as machines working vs off, for the calendar strip. */
export function capacityDays(downtime: Downtime[], machines: number, now: Date, days: number): CapacityDay[] {
  const out: CapacityDay[] = [];
  for (let d = 0; d < days; d++) {
    const working = Math.round(workingShare(downtime, machines, d) * machines);
    out.push({ date: addDays(now, d).toISOString().slice(0, 10), machines: working, off: machines - working });
  }
  return out;
}

/** Pieces a maker can promise in the next 7 days on top of stock: the "Can Deliver" badge (B2). */
export function weeklyCapacity(perDay: number, downtime: Downtime[] | undefined, machines: number): number {
  let total = 0;
  for (let d = 1; d <= 7; d++) total += perDay * workingShare(downtime, machines, d);
  return Math.floor(total);
}
