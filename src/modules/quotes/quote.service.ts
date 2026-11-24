import type { Repositories } from "../../data/unit-of-work.js";
import { toDowntime, weeklyCapacity, type Downtime } from "../../engine/capacity.js";
import { ALLOCATION, quote } from "../../engine/quote.js";
import { addDays, type Clock } from "../../shared/time.js";
import type { CapacityEventRow } from "../capacity/capacity.repository.js";

const DEFAULT_WANTED_DAYS = 14;

export type QuoteView = NonNullable<Awaited<ReturnType<QuoteService["forProduct"]>>>;

/**
 * The one place a "can I deliver?" answer is made: stock, machines, the maker's other open orders,
 * material lead times and the capacity calendar. Orders (maker side) and the market (buyer side) both ask here,
 * so a buyer and the maker always see the same promise.
 */
export class QuoteService {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async forProduct(producer: { id: string; machines: number }, productId: string, qty: number, wantedBy?: Date | null, excludeOrderId?: string) {
    const now = this.clock.now();
    const [product, openOrders, events] = await Promise.all([
      this.repos.stock.recipeDetails(producer.id, productId),
      this.repos.orders.openLoads(producer.id, excludeOrderId),
      this.repos.capacity.upcoming([producer.id], startOfToday(now)),
    ]);
    if (!product) return null;
    const downtime = toDowntime(events, now);
    const q = quote({
      product: { id: product.id, name: product.name, stock: product.stock, unitsPerMachinePerWeek: product.unitsPerMachinePerWeek, recipe: product.recipe },
      machines: producer.machines,
      openOrders,
      qty,
      wantedBy: wantedBy ?? addDays(now, DEFAULT_WANTED_DAYS),
      now,
      downtime,
    });
    const until = q.fullDate ?? q.wantedBy;
    return {
      qty: q.qty, wantedBy: q.wantedBy, ready: q.ready, perDay: Math.round(q.perDay * 100) / 100, backlogDays: Math.round(q.backlogDays * 10) / 10,
      qtyByWanted: q.qtyByWanted, fullDate: q.fullDate, canMeet: q.canMeet, shortfalls: q.shortfalls,
      curve: q.curve.filter((_, i) => i % 2 === 0 || i === q.curve.length - 1),
      /** Calendar events that slowed this promise, so the answer explains itself. */
      counted: events.filter((e) => e.startsOn <= until).map(publicEvent),
    };
  }

  /** "Can Deliver" badge for many products at once (B2): ready now after other orders, and pieces per week. */
  async badges(items: { productId: string; producerId: string; stock: number; unitsPerMachinePerWeek: number; machines: number }[]) {
    const now = this.clock.now();
    const producerIds = [...new Set(items.map((i) => i.producerId))];
    const [loads, events] = await Promise.all([this.repos.market.openLoadsFor(producerIds), this.repos.capacity.upcoming(producerIds, startOfToday(now))]);
    const downtimeBy = new Map<string, Downtime[]>();
    for (const id of producerIds) downtimeBy.set(id, toDowntime(events.filter((e) => e.producerId === id), now));
    const badges = new Map<string, { ready: number; perWeek: number; slowWeek: boolean }>();
    for (const i of items) {
      const reserved = loads.filter((l) => l.productId === i.productId).reduce((a, l) => a + Math.min(l.qty, l.productStock), 0);
      const perDay = (i.machines * ALLOCATION * i.unitsPerMachinePerWeek) / 7;
      const downtime = downtimeBy.get(i.producerId) ?? [];
      const perWeek = weeklyCapacity(perDay, downtime, i.machines);
      badges.set(i.productId, { ready: Math.max(0, i.stock - reserved), perWeek, slowWeek: perWeek < Math.floor(perDay * 7) });
    }
    return badges;
  }
}

export const startOfToday = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const publicEvent = (e: CapacityEventRow) => ({
  id: e.id, kind: e.kind, startsOn: e.startsOn.toISOString().slice(0, 10), endsOn: e.endsOn.toISOString().slice(0, 10), machinesOff: e.machinesOff, note: e.note,
});
