import { AppError } from "../../../core/errors.js";
import type { VoiceAction } from "../../../ai/voice-parser.js";
import { stateForCity } from "../../../shared/gst/states.js";
import { decideSaleDocument } from "../../../shared/gst/tax.js";
import { addDays } from "../../../shared/time.js";
import type { ActionResult, ActionView, ExecuteContext, PreviewContext, VoiceActionHandler, VoiceCatalog } from "./types.js";

const PAYMENT_TERMS_DAYS = 15;

/** "4 Jaipur bheji" → finished stock down, direct order, GST invoice (or bill of supply), khata entry. */
export class SaleHandler implements VoiceActionHandler {
  readonly kind = "SALE" as const;

  isValid(a: VoiceAction, catalog: VoiceCatalog): boolean {
    return a.qty > 0 && Number.isInteger(a.qty) && catalog.products.has(a.productId);
  }

  async describe(a: VoiceAction, { repos, producer, catalog }: PreviewContext): Promise<ActionView> {
    const p = catalog.products.get(a.productId)!;
    const buyer = await this.resolveBuyer(a, { repos, producer });
    const decision = decideSaleDocument(producer.gstScheme, producer.state, buyer.state);
    const to = a.party ? ` to ${a.party}` : "";
    return {
      label: `Sold ${a.qty} × ${p.name}${to}`,
      labelHi: `${a.qty} ${p.nameHi} ${a.party ? a.party + " " : ""}भेजीं`,
      effect: decision.allowed && decision.document === "TAX" ? "A GST invoice will be created" : "A bill of supply will be created",
      effectHi: decision.allowed && decision.document === "TAX" ? "GST बिल अपने आप बनेगा" : "बिल ऑफ़ सप्लाई बनेगा",
      ...(p.stock < a.qty ? { warning: `Only ${p.stock} in stock`, warningHi: `स्टॉक में सिर्फ़ ${p.stock} हैं` } : {}),
      ...(!decision.allowed ? { blocked: { en: decision.reasonEn, hi: decision.reasonHi } } : {}),
    };
  }

  async execute(a: VoiceAction, ctx: ExecuteContext): Promise<ActionResult> {
    const { repos, producer, now, invoices, transcript } = ctx;
    const product = await repos.stock.product(producer.id, a.productId);
    if (!product) throw AppError.notFound("Product");
    const buyer = await this.resolveBuyer(a, ctx);

    await repos.stock.moveProduct(
      { producerId: producer.id, productId: product.id, kind: "SALE", qty: -a.qty, source: "VOICE" },
      -Math.min(a.qty, product.stock),
    );
    const order = await repos.orders.create({
      code: `SUT-${await repos.counters.next("order", 1001)}`,
      producerId: producer.id, productId: product.id, buyerId: buyer.id, channel: "DIRECT", status: "DISPATCHED",
      qty: a.qty, rate: product.price, wantedBy: now, fullDate: now, quoteNote: `Recorded by voice: "${transcript}"`,
    });
    const invoice = await invoices.issueForSale(repos, {
      producer, buyer: { name: buyer.name, gstin: buyer.gstin, state: buyer.state },
      item: { name: product.name, hsn: product.hsn, gstRate: product.gstRate }, qty: a.qty, rate: product.price, orderId: order.id, at: now,
    });
    await repos.khata.create({
      producerId: producer.id, party: buyer.name, direction: "RECEIVE", amount: invoice.total,
      note: `Invoice ${invoice.number}`, dueDate: addDays(now, PAYMENT_TERMS_DAYS), invoiceNo: invoice.number,
    });
    return {
      text: `${invoice.kind === "TAX" ? "GST invoice" : "Bill of supply"} ${invoice.number} created for ${a.qty} × ${product.name}`,
      textHi: `${a.qty} ${product.nameHi} का ${invoice.kind === "TAX" ? "GST बिल" : "बिल"} ${invoice.number} बन गया`,
      invoice: { id: invoice.id, number: invoice.number, kind: invoice.kind },
    };
  }

  /** A known buyer if the note names one; otherwise a walk-in customer in the named (or home) city. */
  private async resolveBuyer(a: VoiceAction, { repos, producer }: Pick<PreviewContext, "repos" | "producer">) {
    const known = await repos.orders.findBuyerByMention(a.party);
    if (known) return { id: known.id, name: `${known.business}, ${known.city}`, gstin: known.gstin, state: known.state };
    const city = a.party || producer.city;
    return { id: null, name: `Customer, ${city}`, gstin: null, state: stateForCity(city) ?? producer.state };
  }
}
