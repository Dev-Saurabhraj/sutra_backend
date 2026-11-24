import type { DbClient } from "../../core/db.js";
import { num } from "../../core/db.js";
import type { Repositories } from "../../data/unit-of-work.js";
import { inr } from "../../shared/money.js";

/** A rise of this much or more on a bill raises an alert. */
export const PRICE_RISE_ALERT = 0.05;
const HISTORY_DAYS = 180;

export type RateChange = { from: number; to: number; pct: number };

/** Pure: how much a rate moved. Null when there is nothing to compare. */
export function rateChange(from: number, to: number): RateChange | null {
  if (!(from > 0) || !(to > 0)) return null;
  return { from, to, pct: Math.round(((to - from) / from) * 1000) / 10 };
}

/**
 * P25 supplier price watch. Every bill updates the material's cost; before it does, compare with the last cost
 * and with what other suppliers charged recently, so a quiet price rise doesn't eat the margin unnoticed.
 */
export class PriceWatch {
  constructor(private readonly db: DbClient) {}

  /** Call inside the purchase transaction, before the new cost is saved. */
  async check(repos: Repositories, producerId: string, materialId: string, newRate: number, supplierName: string): Promise<RateChange | null> {
    const m = await repos.stock.materialWithSupplier(producerId, materialId);
    const old = await repos.stock.materialCost(materialId);
    const change = rateChange(old, newRate);
    if (!m || !change || change.pct / 100 < PRICE_RISE_ALERT) return change;
    await repos.alerts.create({
      producerId, kind: "PRICE", route: "/prices",
      title: `${supplierName} raised ${m.name} by ${change.pct}%`,
      titleHi: `${supplierName} ने ${m.nameHi} ${change.pct}% महँगा किया`,
      body: `${inr(change.from)} → ${inr(change.to)} per ${m.unit}. Compare suppliers before the next order, and check your prices.`,
      bodyHi: `${inr(change.from)} से ${inr(change.to)} प्रति ${m.unit}। अगला ऑर्डर देने से पहले दूसरे सप्लायर देखें, और अपना दाम जाँचें।`,
    });
    return change;
  }

  /** Per material: rates paid recently, by supplier, with the trend and the cheapest recent supplier. */
  async report(producerId: string, now: Date) {
    const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
    const [materials, items] = await Promise.all([
      this.db.material.findMany({ where: { producerId }, select: { id: true, name: true, nameHi: true, unit: true, costPerUnit: true }, orderBy: { name: "asc" } }),
      this.db.purchaseItem.findMany({
        where: { purchase: { producerId, billDate: { gte: since } } },
        select: { materialId: true, rate: true, qty: true, purchase: { select: { billDate: true, supplier: { select: { id: true, name: true } } } } },
        orderBy: { purchase: { billDate: "asc" } },
      }),
    ]);
    return {
      materials: materials.map((m) => {
        const rows = items.filter((i) => i.materialId === m.id).map((i) => ({
          date: i.purchase.billDate, supplierId: i.purchase.supplier.id, supplier: i.purchase.supplier.name, rate: num(i.rate), qty: num(i.qty),
        }));
        const bySupplier = new Map<string, { supplier: string; last: number; lastDate: Date; avg: number; buys: number }>();
        for (const r of rows) {
          const cur = bySupplier.get(r.supplierId);
          const buys = (cur?.buys ?? 0) + 1;
          bySupplier.set(r.supplierId, { supplier: r.supplier, last: r.rate, lastDate: r.date, avg: ((cur?.avg ?? 0) * (buys - 1) + r.rate) / buys, buys });
        }
        const suppliers = [...bySupplier.values()].map((x) => ({ ...x, avg: Math.round(x.avg * 100) / 100 })).sort((a, b) => a.last - b.last);
        const first = rows[0]?.rate ?? 0;
        const last = rows.at(-1)?.rate ?? num(m.costPerUnit);
        return {
          id: m.id, name: m.name, nameHi: m.nameHi, unit: m.unit, cost: num(m.costPerUnit),
          trend: rateChange(first, last),
          history: rows.slice(-12).map((r) => ({ date: r.date, rate: r.rate, supplier: r.supplier })),
          suppliers,
          cheapest: suppliers[0] ?? null,
        };
      }),
    };
  }
}
