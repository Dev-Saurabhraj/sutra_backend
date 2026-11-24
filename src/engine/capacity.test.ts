import { describe, expect, it } from "vitest";
import { capacityDays, toDowntime, weeklyCapacity, workingShare } from "./capacity.js";
import { quote, type QuoteInput } from "./quote.js";

const NOW = new Date("2026-11-24T10:00:00.000Z");
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("capacity calendar", () => {
  const events = [
    { kind: "WEDDING", startsOn: day("2026-12-01"), endsOn: day("2026-12-06"), machinesOff: 3 },
    { kind: "REPAIR", startsOn: day("2026-12-05"), endsOn: day("2026-12-05"), machinesOff: 2 },
    { kind: "HOLIDAY", startsOn: day("2026-11-01"), endsOn: day("2026-11-02"), machinesOff: 12 }, // over: dropped
  ];

  it("turns dates into simulation days and drops events that are over", () => {
    expect(toDowntime(events, NOW)).toEqual([
      { fromDay: 7, toDay: 12, machinesOff: 3 },
      { fromDay: 11, toDay: 11, machinesOff: 2 },
    ]);
  });

  it("adds overlapping events, never below zero machines", () => {
    const d = toDowntime(events, NOW);
    expect(workingShare(d, 12, 6)).toBe(1);
    expect(workingShare(d, 12, 8)).toBe(9 / 12);
    expect(workingShare(d, 12, 11)).toBe(7 / 12);
    expect(workingShare([{ fromDay: 0, toDay: 3, machinesOff: 40 }], 12, 1)).toBe(0);
  });

  it("draws the next days as machines working", () => {
    const days = capacityDays(toDowntime(events, NOW), 12, NOW, 14);
    expect(days[7]).toEqual({ date: "2026-12-01", machines: 9, off: 3 });
    expect(days[11]!.machines).toBe(7);
  });

  it("weekly badge counts only working days", () => {
    expect(weeklyCapacity(2, [], 12)).toBe(14);
    expect(weeklyCapacity(2, [{ fromDay: 1, toDay: 7, machinesOff: 6 }], 12)).toBe(7);
  });
});

describe("quote with downtime", () => {
  const base: QuoteInput = {
    product: { id: "p", name: "Saree", stock: 0, unitsPerMachinePerWeek: 1.5, recipe: [] },
    machines: 12,
    openOrders: [],
    qty: 60,
    wantedBy: new Date("2026-12-15T10:00:00.000Z"),
    now: NOW,
  };

  it("promises less when looms are off before the date", () => {
    const free = quote(base);
    const wedding = quote({ ...base, downtime: [{ fromDay: 7, toDay: 12, machinesOff: 6 }] });
    expect(wedding.qtyByWanted).toBeLessThan(free.qtyByWanted);
    expect(wedding.fullDate!.getTime()).toBeGreaterThan(free.fullDate!.getTime());
  });

  it("a holiday after the full date changes nothing", () => {
    const free = quote(base);
    const later = quote({ ...base, downtime: [{ fromDay: 200, toDay: 210, machinesOff: 12 }] });
    expect(later.qtyByWanted).toBe(free.qtyByWanted);
    expect(later.fullDate).toEqual(free.fullDate);
  });
});
