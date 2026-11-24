import { AppError } from "../../core/errors.js";
import { inr } from "../../shared/money.js";
import { addDays, daysBetween, shortDate, type Clock } from "../../shared/time.js";
import type { ProducerProfile, ProducerRepository } from "../producers/producer.repository.js";
import type { KhataRepository, LedgerRow } from "./khata.repository.js";

/** Income-tax Act Sec. 43B(h): buyers must pay a Udyam micro/small supplier within 45 days (RULES C4). */
export const MSME_PAYMENT_DAYS = 45;

export type KhataEntryView = LedgerRow & {
  overdueDays: number;
  msmeDeadline: Date | null;
  msmeDaysLeft: number | null;
};

export type Reminder = { messageHi: string; messageEn: string; whatsappUrl: string; upiUrl: string | null };

export class KhataService {
  constructor(
    private readonly khata: KhataRepository,
    private readonly producers: ProducerRepository,
    private readonly clock: Clock,
  ) {}

  async list(producerId: string, settled: boolean) {
    const [producer, rows, totals] = await Promise.all([
      this.producer(producerId),
      this.khata.list(producerId, settled),
      this.khata.openTotals(producerId),
    ]);
    const now = this.clock.now();
    return { totals, entries: rows.map((r) => this.view(r, producer, now)) };
  }

  async settle(producerId: string, id: string): Promise<void> {
    if (!(await this.khata.find(producerId, id))) throw AppError.notFound("Khata entry");
    if (!(await this.khata.settle(producerId, id, this.clock.now()))) {
      throw AppError.conflict("ALREADY_SETTLED", "This entry is already settled");
    }
  }

  /** A polite reminder with a UPI link, citing the 45-day rule only when the producer qualifies. */
  async reminder(producerId: string, id: string): Promise<Reminder> {
    const [producer, row] = await Promise.all([this.producer(producerId), this.khata.find(producerId, id)]);
    if (!row) throw AppError.notFound("Khata entry");
    if (row.direction !== "RECEIVE" || row.settled) throw AppError.badRequest("NOT_RECEIVABLE", "Reminders are only for money you are owed");

    const view = this.view(row, producer, this.clock.now());
    const ref = row.invoiceNo ? ` (${row.invoiceNo})` : "";
    const msmeEn = view.msmeDeadline
      ? ` As a registered MSE (Udyam ${producer.udyamNumber}), payment is due by ${shortDate(view.msmeDeadline)} under the 45-day rule.`
      : "";
    const msmeHi = view.msmeDeadline ? ` MSME नियम के अनुसार भुगतान ${shortDate(view.msmeDeadline, "hi")} तक होना है।` : "";
    const upiUrl = producer.upiId
      ? `upi://pay?pa=${encodeURIComponent(producer.upiId)}&pn=${encodeURIComponent(producer.businessName)}&am=${row.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(row.invoiceNo ?? "Sutra payment")}`
      : null;
    const messageEn =
      `Namaste, this is ${producer.businessName}, ${producer.city}. A gentle reminder that ${inr(row.amount)}${ref} is pending.` +
      `${msmeEn}${upiUrl ? ` Pay by UPI: ${producer.upiId}.` : ""} Thank you.`;
    const messageHi =
      `नमस्ते, ${producer.businessName}, ${producer.city} से। ${inr(row.amount)}${ref} का भुगतान बाकी है, कृपया जल्दी भेज दें।` +
      `${msmeHi}${upiUrl ? ` UPI: ${producer.upiId}` : ""} धन्यवाद।`;
    return { messageHi, messageEn, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(messageEn)}`, upiUrl };
  }

  private view(r: LedgerRow, producer: ProducerProfile, now: Date): KhataEntryView {
    const overdueDays = !r.settled && r.dueDate && r.dueDate < now ? Math.floor(daysBetween(r.dueDate, now)) : 0;
    const msme = r.direction === "RECEIVE" && !r.settled && producer.udyamNumber ? addDays(r.createdAt, MSME_PAYMENT_DAYS) : null;
    return { ...r, overdueDays, msmeDeadline: msme, msmeDaysLeft: msme ? Math.ceil(daysBetween(now, msme)) : null };
  }

  private async producer(producerId: string): Promise<ProducerProfile> {
    const p = await this.producers.findProfile(producerId);
    if (!p) throw AppError.notFound("Producer");
    return p;
  }
}
