// Price floor: what one piece really costs (materials by recipe at the latest rates, plus piece wages),
// and what an order's rate leaves as margin. Small producers often quote below cost without knowing it.
import { round2 } from "../shared/money.js";

export type CostLine = { qtyPerUnit: number; costPerUnit: number };

/** Below this margin a quote is "thin": allowed, but flagged. */
export const THIN_MARGIN = 0.1;

export function unitCost(recipe: CostLine[], labourPerUnit: number) {
  const materials = round2(recipe.reduce((a, r) => a + r.qtyPerUnit * r.costPerUnit, 0));
  const labour = round2(labourPerUnit);
  return { materials, labour, total: round2(materials + labour) };
}

export function margin(rate: number, cost: number) {
  const perUnit = round2(rate - cost);
  const share = rate > 0 ? perUnit / rate : 0;
  return {
    perUnit,
    pct: Math.round(share * 1000) / 10,
    belowCost: perUnit < 0,
    thin: perUnit >= 0 && share < THIN_MARGIN,
  };
}
