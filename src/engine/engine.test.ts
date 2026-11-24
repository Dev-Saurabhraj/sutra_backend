import { describe, expect, it } from "vitest";
import { materialHealth, roundQty, statusFor } from "./reorder.js";
import { quote, type QuoteInput } from "./quote.js";
import { splitByCapacity } from "./split.js";

const NOW = new Date("2026-11-24T06:00:00Z");
const supplier = { id: "s1", name: "Mahalaxmi Zari Works", phone: "+91 99099 31876", leadTimeDays: 10 };

describe("materialHealth", () => {
  it("predicts days left from 28-day usage and flags CRITICAL inside lead time + safety", () => {
    const h = materialHealth(
      { id: "m1", name: "Zari", nameHi: "ज़री", unit: "kg", stock: 1.1, costPerUnit: 9200, consumedInWindow: 2.8, supplier },
      NOW,
    );
    expect(h.usagePerDay).toBeCloseTo(0.1);
    expect(h.daysLeft).toBeCloseTo(11);
    expect(h.status).toBe("CRITICAL"); // 11 <= 10 + 2
    expect(h.reorderBy?.toISOString()).toBe(NOW.toISOString()); // already past the reorder point
    expect(h.suggestedQty).toBe(3);
  });

  it("treats unused material as OK with no run-out date", () => {
    const h = materialHealth(
      { id: "m2", name: "Box", nameHi: "डिब्बा", unit: "pcs", stock: 40, costPerUnit: 24, consumedInWindow: 0, supplier: null },
      NOW,
    );
    expect(h.daysLeft).toBeNull();
    expect(h.status).toBe("OK");
    expect(h.reorderBy).toBeNull();
    expect(h.leadTimeDays).toBe(7);
  });

  it("bands status by lead time", () => {
    expect(statusFor(9, 7)).toBe("CRITICAL");
    expect(statusFor(15, 7)).toBe("LOW");
    expect(statusFor(30, 7)).toBe("OK");
  });

  it("rounds suggested quantities like a supplier quote", () => {
    expect(roundQty(52)).toBe(55);
    expect(roundQty(7.2)).toBe(8);
    expect(roundQty(1.23)).toBe(1.3);
  });
});

describe("quote", () => {
  const base: QuoteInput = {
    product: {
      id: "p1",
      name: "Chanderi Silk-Cotton Saree",
      stock: 24,
      unitsPerMachinePerWeek: 1.5,
      recipe: [
        { materialId: "silk", name: "Silk", nameHi: "रेशम", unit: "kg", qtyPerUnit: 0.25, materialStock: 100, supplier: null },
      ],
    },
    machines: 12,
    openOrders: [],
    qty: 20,
    wantedBy: new Date(NOW.getTime() + 10 * 86_400_000),
    now: NOW,
  };

  it("serves from ready stock immediately", () => {
    const q = quote(base);
    expect(q.ready).toBe(24);
    expect(q.canMeet).toBe(true);
    expect(q.fullDate?.toISOString()).toBe(NOW.toISOString());
  });

  it("is honest when the date is too tight: partial by the date, full date later", () => {
    const q = quote({ ...base, qty: 200 });
    // 12 machines * 0.8 * 1.5 / 7 ≈ 2.06 units/day → about 24 + 20 by day 10
    expect(q.canMeet).toBe(false);
    expect(q.qtyByWanted).toBeGreaterThan(24);
    expect(q.qtyByWanted).toBeLessThan(60);
    expect(q.fullDate).not.toBeNull();
    expect(q.fullDate!.getTime()).toBeGreaterThan(base.wantedBy.getTime());
  });

  it("reports material shortfalls with an order-by date", () => {
    const q = quote({
      ...base,
      qty: 100,
      product: { ...base.product, recipe: [{ ...base.product.recipe[0]!, materialStock: 2, supplier: { id: "s", name: "Silk Co", leadTimeDays: 7 } }] },
    });
    expect(q.shortfalls).toHaveLength(1);
    expect(q.shortfalls[0]!.needQty).toBeGreaterThan(0);
    expect(q.shortfalls[0]!.late).toBe(true);
  });

  it("books open orders before the new one", () => {
    const free = quote({ ...base, qty: 60 });
    const busy = quote({ ...base, qty: 60, openOrders: [{ productId: "p1", qty: 40, productStock: 24, unitsPerMachinePerWeek: 1.5 }] });
    expect(busy.ready).toBe(0);
    expect(busy.backlogDays).toBeGreaterThan(0);
    expect(busy.qtyByWanted).toBeLessThan(free.qtyByWanted);
  });
});

describe("splitByCapacity", () => {
  it("fills the preferred maker first, then shares by capacity", () => {
    const r = splitByCapacity(
      [
        { producerId: "a", productId: "pa", capacityByDate: 60 },
        { producerId: "b", productId: "pb", capacityByDate: 100 },
        { producerId: "c", productId: "pc", capacityByDate: 50 },
      ],
      200,
      "a",
    );
    expect(r.rows[0]).toMatchObject({ producerId: "a", assigned: 60 });
    expect(r.covered).toBe(200);
    expect(r.rows.reduce((s, x) => s + x.assigned, 0)).toBe(200);
    for (const row of r.rows) expect(row.assigned).toBeLessThanOrEqual(row.capacityByDate);
  });

  it("covers only what the cluster can make", () => {
    const r = splitByCapacity([{ producerId: "a", productId: "pa", capacityByDate: 30 }], 100);
    expect(r.covered).toBe(30);
    expect(r.totalCapacity).toBe(30);
  });
});
