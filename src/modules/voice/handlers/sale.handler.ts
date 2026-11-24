import type { VoiceAction } from "../../../ai/voice-parser.js";
import { stateForCity } from "../../../shared/gst/states.js";
import { decideSaleDocument } from "../../../shared/gst/tax.js";
import type { SaleBuyer } from "../../inventory/inventory.service.js";
import type { ActionResult, ActionView, ExecuteContext, PreviewContext, VoiceActionHandler, VoiceCatalog } from "./types.js";

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
    const taxInvoice = decision.allowed && decision.document === "TAX";
    return {
      label: `Sold ${a.qty} × ${p.name}${a.party ? ` to ${a.party}` : ""}`,
      labelHi: `${a.qty} ${p.nameHi} ${a.party ? a.party + " " : ""}भेजीं`,
      effect: taxInvoice ? "A GST invoice will be created" : "A bill of supply will be created",
      effectHi: taxInvoice ? "GST बिल अपने आप बनेगा" : "बिल ऑफ़ सप्लाई बनेगा",
      ...(p.stock < a.qty ? { warning: `Only ${p.stock} in stock`, warningHi: `स्टॉक में सिर्फ़ ${p.stock} हैं` } : {}),
      ...(!decision.allowed ? { blocked: { en: decision.reasonEn, hi: decision.reasonHi } } : {}),
    };
  }

  async execute(a: VoiceAction, ctx: ExecuteContext): Promise<ActionResult> {
    const buyer = await this.resolveBuyer(a, ctx);
    const { product, invoice } = await ctx.inventory.sellIn(ctx.repos, ctx.producer, {
      productId: a.productId, qty: a.qty, buyer, source: "VOICE", note: `Recorded by voice: "${ctx.transcript}"`,
    });
    const tax = invoice.kind === "TAX";
    return {
      text: `${tax ? "GST invoice" : "Bill of supply"} ${invoice.number} created for ${a.qty} × ${product.name}`,
      textHi: `${a.qty} ${product.nameHi} का ${tax ? "GST बिल" : "बिल"} ${invoice.number} बन गया`,
      invoice: { id: invoice.id, number: invoice.number, kind: invoice.kind },
    };
  }

  /** A known buyer if the note names one; otherwise a walk-in customer in the named (or home) city. */
  private async resolveBuyer(a: VoiceAction, { repos, producer }: Pick<PreviewContext, "repos" | "producer">): Promise<SaleBuyer> {
    const known = await repos.orders.findBuyerByMention(a.party);
    if (known) return { id: known.id, name: `${known.business}, ${known.city}`, gstin: known.gstin, state: known.state };
    const city = a.party || producer.city;
    return { id: null, name: `Customer, ${city}`, gstin: null, state: stateForCity(city) ?? producer.state };
  }
}
