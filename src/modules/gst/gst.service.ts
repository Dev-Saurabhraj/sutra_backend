import { AppError } from "../../core/errors.js";
import type { Repositories } from "../../data/unit-of-work.js";
import type { Clock } from "../../shared/time.js";
import type { ProducerProfile } from "../producers/producer.repository.js";
import { gstCsv, gstr1Json } from "./gst-export.js";
import { currentMonthKey, fyStart, monthPeriod, quarterPeriod, recentPeriods, type Period } from "./gst-period.js";
import { gstSummary } from "./gst-summary.js";
import { parse2b, reconcile } from "./gstr2b.js";
import { round2 } from "../../shared/money.js";
import { addDays } from "../../shared/time.js";

const RECONCILE_MONTHS = 3;
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

  /** X7: match the books' purchase bills with the GSTR-2B the supplier side filed. */
  async reconcile(producerId: string, twoB: unknown, months = RECONCILE_MONTHS) {
    const filed = parse2b(twoB);
    if (filed.length === 0) throw AppError.badRequest("EMPTY_2B", "No B2B invoices found in this GSTR-2B file");
    const now = this.clock.now();
    const books = await this.gst.purchases(producerId, addDays(now, -31 * months), addDays(now, 1));
    return reconcile(books.map((b) => ({ supplierGstin: b.supplierGstin, supplierName: b.supplierName, billNo: b.billNo, billDate: b.billDate, taxable: b.taxable, tax: b.cgst + b.sgst + b.igst })), filed);
  }

  /**
   * A demo GSTR-2B built from the maker's own recent bills, with two realistic gaps: one supplier that did not
   * file, and one that filed a different amount. Marked as a sample; real files come from the GST portal.
   */
  async sample2b(producerId: string) {
    const now = this.clock.now();
    const books = (await this.gst.purchases(producerId, addDays(now, -31 * RECONCILE_MONTHS), addDays(now, 1))).filter((b) => b.supplierGstin);
    const bySupplier = new Map<string, { ctin: string; trdnm: string; inv: unknown[] }>();
    books.forEach((b, i) => {
      if (i === 0) return; // this supplier "did not file" this bill
      const factor = i === 1 ? 0.9 : 1; // this one filed 10% less tax
      const s = bySupplier.get(b.supplierGstin!) ?? { ctin: b.supplierGstin!, trdnm: b.supplierName, inv: [] };
      s.inv.push({
        inum: b.billNo, dt: b.billDate.toISOString().slice(0, 10).split("-").reverse().join("-"), val: b.total, itcavl: "Y",
        items: [{ num: 1, txval: b.taxable, igst: round2(b.igst * factor), cgst: round2(b.cgst * factor), sgst: round2(b.sgst * factor), cess: 0 }],
      });
      bySupplier.set(b.supplierGstin!, s);
    });
    return { sample: true, data: { docdata: { b2b: [...bySupplier.values()] } } };
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
