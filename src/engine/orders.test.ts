import { describe, expect, it } from "vitest";
import { availableActions, deliveredOnTime, nextStatus, updatedOnTimeRate } from "./order-flow.js";
import { margin, unitCost } from "./pricing.js";

describe("order stages", () => {
  it("only allows the next step", () => {
    expect(nextStatus("QUOTED", "accept")).toBe("IN_PRODUCTION");
    expect(nextStatus("QUOTED", "dispatch")).toBeNull();
    expect(nextStatus("IN_PRODUCTION", "dispatch")).toBe("DISPATCHED");
    expect(nextStatus("DISPATCHED", "deliver")).toBe("DELIVERED");
    expect(nextStatus("DELIVERED", "deliver")).toBeNull();
    expect(nextStatus("DECLINED", "accept")).toBeNull();
  });
  it("lists the buttons for each stage", () => {
    expect(availableActions("QUOTED")).toEqual(["accept", "decline"]);
    expect(availableActions("IN_PRODUCTION")).toEqual(["dispatch"]);
    expect(availableActions("DELIVERED")).toEqual([]);
  });
  it("keeps a running on-time rate", () => {
    expect(updatedOnTimeRate(0.9, 9, true)).toBe(0.91);
    expect(updatedOnTimeRate(0.9, 9, false)).toBe(0.81);
    expect(deliveredOnTime(new Date("2026-12-01T00:00:00Z"), new Date("2026-12-01T20:00:00Z"))).toBe(true);
    expect(deliveredOnTime(new Date("2026-12-01T00:00:00Z"), new Date("2026-12-03T00:00:00Z"))).toBe(false);
  });
});

describe("price floor", () => {
  // silk-cotton saree: 0.25 kg silk @5600 + 0.3 kg cotton @460 + 0.05 kg zari @9200 + ₹700 weaving
  const cost = unitCost(
    [
      { qtyPerUnit: 0.25, costPerUnit: 5600 },
      { qtyPerUnit: 0.3, costPerUnit: 460 },
      { qtyPerUnit: 0.05, costPerUnit: 9200 },
    ],
    700,
  );

  it("adds materials by recipe and piece wages", () => {
    expect(cost).toEqual({ materials: 1998, labour: 700, total: 2698 });
  });
  it("flags below-cost and thin quotes", () => {
    expect(margin(3200, cost.total)).toMatchObject({ perUnit: 502, belowCost: false, thin: false, pct: 15.7 });
    expect(margin(2900, cost.total)).toMatchObject({ thin: true, belowCost: false });
    expect(margin(2500, cost.total)).toMatchObject({ belowCost: true, perUnit: -198 });
  });
});
