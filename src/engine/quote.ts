// "Can Deliver" quote: a day-by-day simulation over finished stock, machine capacity,
// open orders and raw-material lead times. Pure: no database, `now` is injected.
import { addDays, DAY_MS } from "../shared/time.js";
import { roundQty } from "./reorder.js";
import { workingShare, type Downtime } from "./capacity.js";

/** Share of machines promised to a new order; the rest keeps regular customers served. */
export const ALLOCATION = 0.8;
const DEFAULT_LEAD_DAYS = 7;
const MAX_SIM_DAYS = 400;
const SHORTFALL_BUFFER = 1.05;

export type QuoteRecipeLine = {
  materialId: string;
  name: string;
  nameHi: string;
  unit: string;
  qtyPerUnit: number;
  materialStock: number;
  supplier: { id: string; name: string; leadTimeDays: number } | null;
};

export type OpenOrderLoad = { productId: string; qty: number; productStock: number; unitsPerMachinePerWeek: number };

export type QuoteInput = {
  product: { id: string; name: string; stock: number; unitsPerMachinePerWeek: number; recipe: QuoteRecipeLine[] };
  machines: number;
  openOrders: OpenOrderLoad[];
  qty: number;
  wantedBy: Date;
  now: Date;
  /** Days with machines off (capacity calendar). Omitted = every machine every day. */
  downtime?: Downtime[];
};

export type Shortfall = {
  materialId: string;
  name: string;
  nameHi: string;
  unit: string;
  needQty: number;
  supplierName: string;
  leadTimeDays: number;
  orderBy: Date;
  /** Even ordering today causes a pause in production. */
  late: boolean;
};

export type Quote = {
  qty: number;
  wantedBy: Date;
  ready: number;
  perDay: number;
  backlogDays: number;
  qtyByWanted: number;
  fullDate: Date | null;
  canMeet: boolean;
  shortfalls: Shortfall[];
  curve: { date: string; units: number }[];
};

export function quote(input: QuoteInput): Quote {
  const { product, machines, qty, wantedBy, now } = input;
  const { reservedSame, backlogDays } = bookedLoad(input.openOrders, product.id, machines);
  const ready = Math.max(0, product.stock - reservedSame);
  const perDay = (machines * ALLOCATION * product.unitsPerMachinePerWeek) / 7;
  const toMake = Math.max(0, qty - ready);

  const { shortfalls, unitsFromStock, resumeDay } = materialLimits(product.recipe, toMake, backlogDays, perDay, now);

  const wantedDay = (wantedBy.getTime() - now.getTime()) / DAY_MS;
  const horizon = Math.max(Math.ceil(wantedDay) + 10, 30);
  const curve: Quote["curve"] = [];
  let made = 0;
  let fullDay: number | null = toMake === 0 ? 0 : null;
  let qtyByWanted = Math.min(qty, ready);
  // Other orders are worked off first, in full-machine days; downtime slows both.
  let backlogLeft = backlogDays;

  for (let d = 1; d <= MAX_SIM_DAYS; d++) {
    let share = workingShare(input.downtime, machines, d);
    const toBacklog = Math.min(backlogLeft, share);
    backlogLeft -= toBacklog;
    share -= toBacklog;
    const materialBlocked = made >= unitsFromStock && d <= resumeDay;
    if (share > 0 && !materialBlocked && made < toMake) made = Math.min(toMake, made + perDay * share);
    const total = Math.min(qty, Math.floor(ready + made));
    if (d <= wantedDay) qtyByWanted = total;
    if (fullDay === null && total >= qty) fullDay = d;
    if (d <= horizon) curve.push({ date: addDays(now, d).toISOString().slice(0, 10), units: total });
    if (fullDay !== null && d > horizon) break;
  }

  return {
    qty,
    wantedBy,
    ready,
    perDay,
    backlogDays,
    qtyByWanted,
    fullDate: fullDay === null ? null : addDays(now, fullDay),
    canMeet: qtyByWanted >= qty,
    shortfalls,
    curve,
  };
}

/** Open orders book finished stock first, then machine-days. */
function bookedLoad(open: OpenOrderLoad[], productId: string, machines: number) {
  let reservedSame = 0;
  let backlogMachineDays = 0;
  for (const o of open) {
    const fromStock = Math.min(o.qty, o.productStock);
    if (o.productId === productId) reservedSame += fromStock;
    if (o.unitsPerMachinePerWeek > 0) backlogMachineDays += ((o.qty - fromStock) * 7) / o.unitsPerMachinePerWeek;
  }
  return { reservedSame, backlogDays: backlogMachineDays / Math.max(1, machines) };
}

function materialLimits(recipe: QuoteRecipeLine[], toMake: number, backlogDays: number, perDay: number, now: Date) {
  const shortfalls: Shortfall[] = [];
  let unitsFromStock = Infinity;
  let resumeDay = 0;
  for (const r of recipe) {
    if (r.qtyPerUnit <= 0) continue;
    const can = r.materialStock / r.qtyPerUnit;
    unitsFromStock = Math.min(unitsFromStock, can);
    const need = toMake * r.qtyPerUnit - r.materialStock;
    if (need <= 0) continue;
    const lead = r.supplier?.leadTimeDays ?? DEFAULT_LEAD_DAYS;
    const runOutDay = backlogDays + (perDay > 0 ? can / perDay : 0);
    const orderByDay = runOutDay - lead;
    shortfalls.push({
      materialId: r.materialId,
      name: r.name,
      nameHi: r.nameHi,
      unit: r.unit,
      needQty: roundQty(need * SHORTFALL_BUFFER),
      supplierName: r.supplier?.name ?? "-",
      leadTimeDays: lead,
      orderBy: addDays(now, Math.max(0, orderByDay)),
      late: orderByDay < 0,
    });
    resumeDay = Math.max(resumeDay, lead);
  }
  return { shortfalls, unitsFromStock, resumeDay };
}
