// Run-out prediction for raw materials. Pure: the caller loads usage, this decides.
import { addDays } from "../shared/time.js";

export const USAGE_WINDOW_DAYS = 28;
export const SAFETY_DAYS = 2;
const DEFAULT_LEAD_DAYS = 7;

export type SupplierRef = { id: string; name: string; phone: string; leadTimeDays: number };

export type MaterialUsageInput = {
  id: string;
  name: string;
  nameHi: string;
  unit: string;
  stock: number;
  costPerUnit: number;
  /** Total quantity consumed in the last USAGE_WINDOW_DAYS (positive number). */
  consumedInWindow: number;
  supplier: SupplierRef | null;
};

export type HealthStatus = "CRITICAL" | "LOW" | "OK";

export type MaterialHealth = {
  id: string;
  name: string;
  nameHi: string;
  unit: string;
  stock: number;
  costPerUnit: number;
  stockValue: number;
  usagePerDay: number;
  /** null when the material isn't being used (never runs out). */
  daysLeft: number | null;
  leadTimeDays: number;
  status: HealthStatus;
  reorderBy: Date | null;
  suggestedQty: number;
  supplier: SupplierRef | null;
};

export function materialHealth(m: MaterialUsageInput, now: Date): MaterialHealth {
  const usagePerDay = m.consumedInWindow / USAGE_WINDOW_DAYS;
  const daysLeft = usagePerDay > 0 ? m.stock / usagePerDay : null;
  const lead = m.supplier?.leadTimeDays ?? DEFAULT_LEAD_DAYS;
  return {
    id: m.id,
    name: m.name,
    nameHi: m.nameHi,
    unit: m.unit,
    stock: m.stock,
    costPerUnit: m.costPerUnit,
    stockValue: m.stock * m.costPerUnit,
    usagePerDay,
    daysLeft,
    leadTimeDays: lead,
    status: statusFor(daysLeft, lead),
    reorderBy: daysLeft === null ? null : addDays(now, Math.max(0, daysLeft - lead - SAFETY_DAYS)),
    suggestedQty: roundQty(Math.max(usagePerDay * 30, 0)),
    supplier: m.supplier,
  };
}

/** CRITICAL: will run out before a reorder can arrive. LOW: within ~10 days of that point. */
export function statusFor(daysLeft: number | null, leadTimeDays: number): HealthStatus {
  if (daysLeft === null) return "OK";
  if (daysLeft <= leadTimeDays + SAFETY_DAYS) return "CRITICAL";
  if (daysLeft <= leadTimeDays + 10) return "LOW";
  return "OK";
}

/** Round order quantities the way a supplier would quote them. */
export function roundQty(q: number): number {
  if (q >= 50) return Math.ceil(q / 5) * 5;
  if (q >= 5) return Math.ceil(q);
  return Math.ceil(q * 10) / 10;
}
