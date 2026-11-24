import { AppError } from "../../core/errors.js";
import type { Repositories } from "../../data/unit-of-work.js";
import type { Clock } from "../../shared/time.js";
import type { ProducerProfile } from "../producers/producer.repository.js";
import { gstCsv, gstr1Json } from "./gst-export.js";
import { currentMonthKey, fyStart, monthPeriod, quarterPeriod, recentPeriods, type Period } from "./gst-period.js";
import { gstSummary } from "./gst-summary.js";
import type { GstRepository } from "./gst.repository.js";

export type PeriodQuery = { month?: string; quarter?: string };

/** GST for a month or quarter: the picture, the problems to fix, and files for the CA. */
export class GstService {
  constructor(
    private readonly gst: GstRepository,
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  periods() {
    return recentPeriods(this.clock.now());
  }

  async summary(producerId: string, q: PeriodQuery) {
    const producer = await this.producer(producerId);
    const period = this.period(q);
    const [sales, purchases, fyTurnover] = await Promise.all([
      this.gst.sales(producerId, period.from, period.to),
      this.gst.purchases(producerId, period.from, period.to),
      this.gst.turnoverSince(producerId, fyStart(this.clock.now())),
    ]);
    return gstSummary({ scheme: producer.gstScheme, state: producer.state, period, sales, purchases, fyTurnover });
  }

  async csv(producerId: string, q: PeriodQuery) {
    const producer = await this.producer(producerId);
    const period = this.period(q);
    const [sales, purchases] = await Promise.all([this.gst.sales(producerId, period.from, period.to), this.gst.purchases(producerId, period.from, period.to)]);
    return {
      filename: `sutra-gst-${period.key}.csv`,
      body: gstCsv({ business: producer.businessName, gstin: producer.gstin, period: period.label }, sales, purchases),
    };
  }

  async gstr1(producerId: string, q: PeriodQuery) {
    const producer = await this.producer(producerId);
    if (producer.gstScheme !== "REGULAR") throw AppError.badRequest("NOT_REGULAR", "GSTR-1 is only for regular GST registrations");
    const period = this.period(q);
    const sales = await this.gst.sales(producerId, period.from, period.to);
    // return period (fp) is MMYYYY of the period's last month
    const last = new Date(period.to.getTime() - 1 + 5.5 * 3_600_000);
    const fp = `${String(last.getUTCMonth() + 1).padStart(2, "0")}${last.getUTCFullYear()}`;
    return { filename: `sutra-gstr1-${period.key}.json`, body: gstr1Json(producer.gstin, fp, sales) };
  }

  private period(q: PeriodQuery): Period {
    if (q.quarter) return quarterPeriod(q.quarter);
    return monthPeriod(q.month ?? currentMonthKey(this.clock.now()));
  }

  private async producer(producerId: string): Promise<ProducerProfile> {
    const p = await this.repos.producers.findProfile(producerId);
    if (!p) throw AppError.notFound("Producer");
    return p;
  }
}
