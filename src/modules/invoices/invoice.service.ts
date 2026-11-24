import { AppError } from "../../core/errors.js";
import type { Repositories } from "../../data/unit-of-work.js";
import { businessPrefix, financialYear, invoiceNumber } from "../../shared/gst/financial-year.js";
import { decideSaleDocument, noTax, splitTax, type GstSchemeKind } from "../../shared/gst/tax.js";
import type { InvoiceRecord, InvoiceRepository } from "./invoice.repository.js";
import type { InvoicePdfRenderer } from "./invoice-pdf.js";
import type { ProducerRepository } from "../producers/producer.repository.js";

export type SaleInvoiceInput = {
  producer: { id: string; businessName: string; state: string; gstScheme: GstSchemeKind };
  buyer: { name: string; gstin: string | null; state: string };
  item: { name: string; hsn: string; gstRate: number };
  qty: number;
  rate: number;
  orderId?: string;
  at: Date;
};

/**
 * Factory for sale documents. The producer's GST scheme decides the document type (RULES C1):
 * a regular dealer issues a tax invoice; composition and unregistered sellers issue a bill of supply.
 */
export class InvoiceService {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly producers: ProducerRepository,
    private readonly pdf: InvoicePdfRenderer,
  ) {}

  /** The invoice as a PDF to share on WhatsApp or print. */
  async pdfFor(producerId: string, id: string): Promise<{ filename: string; bytes: Buffer }> {
    const [inv, seller] = await Promise.all([this.get(producerId, id), this.producers.findProfile(producerId)]);
    if (!seller) throw AppError.notFound("Producer");
    return { filename: `${inv.number.replace(/\//g, "-")}.pdf`, bytes: await this.pdf.render(inv, seller) };
  }

  list(producerId: string, take = 30) {
    return this.invoices.list(producerId, take);
  }

  async get(producerId: string, id: string): Promise<InvoiceRecord> {
    const inv = await this.invoices.find(producerId, id);
    if (!inv) throw AppError.notFound("Invoice");
    return inv;
  }

  /** A buyer downloads an invoice on their own order. */
  async pdfForBuyer(buyerId: string, id: string): Promise<{ filename: string; bytes: Buffer }> {
    const inv = await this.invoices.findForBuyer(buyerId, id);
    if (!inv) throw AppError.notFound("Invoice");
    const seller = await this.producers.findProfile(inv.producerId);
    if (!seller) throw AppError.notFound("Producer");
    return { filename: `${inv.number.replace(/\//g, "-")}.pdf`, bytes: await this.pdf.render(inv, seller) };
  }

  /**
   * Proforma sent with a marketplace request (B5): same tax rules as the final invoice, its own number series,
   * no stock or money moves. Refuses a sale the seller's GST scheme does not allow.
   */
  async issueProforma(repos: Repositories, input: SaleInvoiceInput): Promise<InvoiceRecord> {
    const decision = decideSaleDocument(input.producer.gstScheme, input.producer.state, input.buyer.state);
    if (!decision.allowed) throw new AppError(422, "SALE_NOT_ALLOWED", decision.reasonEn, { reasonHi: decision.reasonHi });
    const fy = financialYear(input.at);
    const seq = await repos.counters.next(`inv:${input.producer.id}:PROFORMA:${fy.label}`);
    const taxable = input.qty * input.rate;
    const tax = decision.chargesTax ? splitTax(taxable, input.item.gstRate, input.producer.state, input.buyer.state) : noTax(taxable);
    return repos.invoices.create({
      producerId: input.producer.id,
      number: invoiceNumber(businessPrefix(input.producer.businessName), "PROFORMA", fy.short, seq),
      financialYear: fy.label,
      kind: "PROFORMA",
      orderId: input.orderId ?? null,
      buyerName: input.buyer.name,
      buyerGstin: input.buyer.gstin,
      buyerState: input.buyer.state,
      itemName: input.item.name,
      hsn: input.item.hsn,
      qty: input.qty,
      rate: input.rate,
      gstRate: decision.chargesTax ? input.item.gstRate : 0,
      ...tax,
      issuedAt: input.at,
    });
  }

  /** Must run inside a unit of work so the number, the invoice and the stock change commit together. */
  async issueForSale(repos: Repositories, input: SaleInvoiceInput): Promise<InvoiceRecord> {
    const decision = decideSaleDocument(input.producer.gstScheme, input.producer.state, input.buyer.state);
    if (!decision.allowed) throw new AppError(422, "SALE_NOT_ALLOWED", decision.reasonEn, { reasonHi: decision.reasonHi });

    const fy = financialYear(input.at);
    const seq = await repos.counters.next(`inv:${input.producer.id}:${decision.document}:${fy.label}`);
    const taxable = input.qty * input.rate;
    const tax = decision.chargesTax
      ? splitTax(taxable, input.item.gstRate, input.producer.state, input.buyer.state)
      : noTax(taxable);

    return repos.invoices.create({
      producerId: input.producer.id,
      number: invoiceNumber(businessPrefix(input.producer.businessName), decision.document, fy.short, seq),
      financialYear: fy.label,
      kind: decision.document,
      orderId: input.orderId ?? null,
      buyerName: input.buyer.name,
      buyerGstin: input.buyer.gstin,
      buyerState: input.buyer.state,
      itemName: input.item.name,
      hsn: input.item.hsn,
      qty: input.qty,
      rate: input.rate,
      gstRate: decision.chargesTax ? input.item.gstRate : 0,
      ...tax,
      issuedAt: input.at,
    });
  }
}
