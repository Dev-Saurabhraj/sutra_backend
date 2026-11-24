import type { CapacityKind } from "@prisma/client";
import { AppError } from "../../core/errors.js";
import type { Repositories } from "../../data/unit-of-work.js";
import { capacityDays, toDowntime } from "../../engine/capacity.js";
import { shortDate, type Clock } from "../../shared/time.js";
import { publicEvent, startOfToday, type QuoteService } from "../quotes/quote.service.js";

const CALENDAR_DAYS = 42;
const MAX_EVENT_DAYS = 60;

export type NewCapacityEvent = { kind: CapacityKind; startsOn: Date; endsOn: Date; machinesOff?: number; note?: string };

/** The capacity calendar (P24): days with fewer machines, so every promise counts them. */
export class CapacityService {
  constructor(
    private readonly repos: Repositories,
    private readonly quotes: QuoteService,
    private readonly clock: Clock,
  ) {}

  async calendar(producerId: string) {
    const producer = await this.producer(producerId);
    const now = this.clock.now();
    const events = await this.repos.capacity.upcoming([producerId], startOfToday(now));
    const days = capacityDays(toDowntime(events, now), producer.machines, now, CALENDAR_DAYS);
    const lost = days.reduce((a, d) => a + d.off, 0);
    return { machines: producer.machines, machineLabel: producer.industry.machine, machineLabelHi: producer.industry.machineHi, days, machineDaysLost: lost, events: events.map(publicEvent) };
  }

  /** Add a stretch of downtime, then warn about accepted orders it now makes late. */
  async add(producerId: string, input: NewCapacityEvent) {
    const producer = await this.producer(producerId);
    const today = startOfToday(this.clock.now());
    if (input.endsOn < input.startsOn) throw AppError.badRequest("BAD_DATES", "The end date is before the start date");
    if (input.endsOn < today) throw AppError.badRequest("PAST_DATES", "These dates are already over");
    if ((input.endsOn.getTime() - input.startsOn.getTime()) / 86_400_000 > MAX_EVENT_DAYS) {
      throw AppError.badRequest("TOO_LONG", `Add at most ${MAX_EVENT_DAYS} days at a time`);
    }
    // A holiday stops everything unless said otherwise; never more machines than the maker has.
    const off = Math.min(producer.machines, Math.max(1, input.machinesOff ?? producer.machines));
    await this.repos.capacity.create({ producerId, kind: input.kind, startsOn: input.startsOn, endsOn: input.endsOn, machinesOff: off, note: input.note?.trim() || null });
    const atRisk = await this.ordersAtRisk(producerId, producer.machines);
    return { ...(await this.calendar(producerId)), atRisk };
  }

  async remove(producerId: string, id: string) {
    if (!(await this.repos.capacity.remove(producerId, id))) throw AppError.notFound("Calendar entry");
    return this.calendar(producerId);
  }

  /** Accepted orders whose promise no longer holds; each gets an alert so the maker can tell the buyer early. */
  private async ordersAtRisk(producerId: string, machines: number) {
    const open = await this.repos.orders.list(producerId, ["CONFIRMED", "IN_PRODUCTION"]);
    const risky: { code: string; promised: number; nowPossible: number }[] = [];
    for (const o of open) {
      if (!o.wantedBy || o.promisedQtyByWanted == null) continue;
      const q = await this.quotes.forProduct({ id: producerId, machines }, o.product.id, o.qty, o.wantedBy, o.id);
      if (!q || q.qtyByWanted >= o.promisedQtyByWanted) continue;
      risky.push({ code: o.code, promised: o.promisedQtyByWanted, nowPossible: q.qtyByWanted });
      const who = o.buyer?.business ?? o.code;
      const title = `${o.code} may be late: ${q.qtyByWanted} of ${o.promisedQtyByWanted} by ${shortDate(o.wantedBy)}`;
      if (await this.repos.alerts.hasUnread(producerId, "ORDER", title)) continue;
      await this.repos.alerts.create({
        producerId, kind: "ORDER", route: `/order/${o.code}`,
        title,
        titleHi: `${o.code} देर हो सकता है: ${shortDate(o.wantedBy, "hi")} तक ${o.promisedQtyByWanted} में से ${q.qtyByWanted}`,
        body: `The days off you added slow this order. Tell ${who} early.`,
        bodyHi: `आपकी छुट्टी के दिन गिनने पर यह ऑर्डर धीमा होगा। ${who} को पहले बता दें।`,
      });
    }
    return risky;
  }

  private async producer(producerId: string) {
    const p = await this.repos.producers.findProfile(producerId);
    if (!p) throw AppError.notFound("Producer");
    return p;
  }
}
