// Order stages as an explicit state machine, so the API can never jump a step or move backwards.
//   QUOTED ──accept──▶ IN_PRODUCTION ──dispatch──▶ DISPATCHED ──deliver──▶ DELIVERED
//     └──decline──▶ DECLINED          CONFIRMED (marketplace, paid) ──start──▶ IN_PRODUCTION

export type OrderStatusKind = "QUOTED" | "CONFIRMED" | "IN_PRODUCTION" | "DISPATCHED" | "DELIVERED" | "DECLINED";
export type OrderAction = "accept" | "decline" | "start" | "dispatch" | "deliver";

const TRANSITIONS: Record<OrderAction, { from: OrderStatusKind[]; to: OrderStatusKind }> = {
  accept: { from: ["QUOTED"], to: "IN_PRODUCTION" },
  decline: { from: ["QUOTED"], to: "DECLINED" },
  start: { from: ["CONFIRMED"], to: "IN_PRODUCTION" },
  dispatch: { from: ["CONFIRMED", "IN_PRODUCTION"], to: "DISPATCHED" },
  deliver: { from: ["DISPATCHED"], to: "DELIVERED" },
};

export function nextStatus(current: OrderStatusKind, action: OrderAction): OrderStatusKind | null {
  const t = TRANSITIONS[action];
  return t.from.includes(current) ? t.to : null;
}

/** What the producer can do next, for the app's buttons. */
export function availableActions(current: OrderStatusKind): OrderAction[] {
  return (Object.keys(TRANSITIONS) as OrderAction[]).filter((a) => TRANSITIONS[a].from.includes(current));
}

/** Running on-time rate after one more delivery (the "trust profile" number buyers see). */
export function updatedOnTimeRate(rate: number, deliveredBefore: number, onTime: boolean): number {
  const next = (rate * deliveredBefore + (onTime ? 1 : 0)) / (deliveredBefore + 1);
  return Math.round(next * 1000) / 1000;
}

/** Delivered on time = on or before the end of the wanted-by day (a day's grace for IST date boundaries). */
export function deliveredOnTime(wantedBy: Date | null, deliveredAt: Date): boolean {
  if (!wantedBy) return true;
  return deliveredAt.getTime() <= wantedBy.getTime() + 86_400_000;
}
