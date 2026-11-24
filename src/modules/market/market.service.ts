import { AppError } from "../../core/errors.js";
import type { FileStore } from "../../core/file-store.js";
import type { Repositories, UnitOfWork } from "../../data/unit-of-work.js";
import type { Translator } from "../../ai/translator.js";
import { splitByCapacity } from "../../engine/split.js";
import { validateGstin } from "../../shared/gst/gstin.js";
import { decideSaleDocument, noTax, splitTax } from "../../shared/gst/tax.js";
import { shortDate, type Clock } from "../../shared/time.js";
import { inr, round2 } from "../../shared/money.js";
import { upiLink } from "../../shared/upi.js";
import type { InvoiceService } from "../invoices/invoice.service.js";
import type { QuoteService, QuoteView } from "../quotes/quote.service.js";
import type { Listing, MakerRow, MarketFilter } from "./market.repository.js";

/** A buyer deals with at most this many makers for one request. */
const MAX_SPLIT_MAKERS = 4;

export type QuoteRequest = { productId: string; qty: number; wantedBy: Date };
export type BuyerRequest = QuoteRequest & { note?: string; split: boolean };

/** Buyers see stages in plain words; the maker's internal statuses stay internal. */
const TRACK_STAGES = ["QUOTED", "IN_PRODUCTION", "DISPATCHED", "DELIVERED"] as const;

/**
 * The buyer side (B1–B7): browse, trust, an honest instant quote (shared across the cluster when one maker
 * can't make the date), a request with a proforma per maker, and tracking with dispatch proof.
 */
export class MarketService {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly quotes: QuoteService,
    private readonly invoices: InvoiceService,
    private readonly translator: Translator,
    private readonly files: FileStore,
    private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ browse (B1, B2, B7)

  async browse(filter: MarketFilter) {
    const [listings, facets] = await Promise.all([this.repos.market.listings(filter), this.repos.market.facets()]);
    const badges = await this.badges(listings);
    return { facets, items: listings.map((l) => this.card(l, badges.get(l.id))) };
  }

  async product(productId: string) {
    const l = await this.listing(productId);
    const more = (await this.repos.market.listings({}, 200)).filter((x) => x.maker.id === l.maker.id && x.id !== l.id);
    const badges = await this.badges([l, ...more]);
    return {
      product: { ...this.card(l, badges.get(l.id)), story: l.story, mrp: l.mrp, hsn: l.hsn, gstRate: l.gstRate },
      maker: trust(l.maker),
      more: more.map((m) => this.card(m, badges.get(m.id))),
    };
  }

  async maker(slug: string) {
    const m = await this.repos.market.maker(slug);
    if (!m) throw AppError.notFound("Maker");
    const products = (await this.repos.market.listings({}, 200)).filter((x) => x.maker.id === m.id);
    const badges = await this.badges(products);
    return { maker: trust(m), products: products.map((p) => this.card(p, badges.get(p.id))) };
  }

  // ------------------------------------------------------------------ quote (B3, B4)

  /** The honest answer for qty by a date, at list price, with GST for the buyer's state and a cluster option. */
  async quote(req: QuoteRequest, buyerState: string | null) {
    const l = await this.listing(req.productId);
    const plan = await this.plan(l, req.qty, req.wantedBy);
    const sale = this.saleTerms(l, req.qty, buyerState);
    const split = !plan.canMeet && sale.allowed ? await this.clusterOption(l, req, plan, buyerState) : null;
    return { product: this.card(l, undefined), maker: trust(l.maker), qty: req.qty, wantedBy: req.wantedBy, plan, sale, split };
  }

  /** GST depends on where the goods go: the buyer's registered state. */
  async buyerState(buyerId: string): Promise<string | null> {
    return (await this.repos.market.buyer(buyerId))?.state ?? null;
  }

  // ------------------------------------------------------------------ request (B5)

  /** Creates the order(s): one per maker, each with a proforma, a message in Hindi, and an alert to the maker. */
  async request(buyerId: string, req: BuyerRequest) {
    const buyer = await this.buyer(buyerId);
    const q = await this.quote(req, buyer.state);
    if (!q.sale.allowed) throw new AppError(422, "SALE_NOT_ALLOWED", q.sale.reasonEn ?? "This maker can't sell to your state", { reasonHi: q.sale.reasonHi });
    const parts = req.split && q.split && q.split.rows.length > 1
      ? await Promise.all(q.split.rows.map(async (r) => ({ listing: await this.listing(r.product.id), qty: r.assigned })))
      : [{ listing: await this.listing(req.productId), qty: req.qty }];

    const note = req.note?.trim() || `Request for ${req.qty} pieces by ${shortDate(req.wantedBy)}.`;
    const noteHi = (await this.translator.translate(note, "hi")) ?? null;
    const now = this.clock.now();

    const created = await this.uow.run(async (repos) => {
      const group = parts.length > 1 ? `REQ-${await repos.counters.next("request", 101)}` : null;
      const out = [];
      for (const part of parts) {
        const seller = await repos.producers.findProfile(part.listing.maker.id);
        if (!seller) throw AppError.notFound("Maker");
        const code = `SUT-${await repos.counters.next("order", 1001)}`;
        const order = await repos.orders.create({
          code, producerId: seller.id, productId: part.listing.id, buyerId, channel: "MARKETPLACE", status: "QUOTED",
          qty: part.qty, rate: part.listing.price, wantedBy: req.wantedBy,
          quoteNote: group ? `${group}: ${part.qty} of ${req.qty}` : undefined,
        });
        if (group) await repos.orders.update(order.id, { parentCode: group });
        const proforma = await this.invoices.issueProforma(repos, {
          producer: { id: seller.id, businessName: seller.businessName, state: seller.state, gstScheme: seller.gstScheme },
          buyer: { name: `${buyer.business}, ${buyer.city}`, gstin: buyer.gstin, state: buyer.state },
          item: { name: part.listing.name, hsn: part.listing.hsn, gstRate: part.listing.gstRate },
          qty: part.qty, rate: part.listing.price, orderId: order.id, at: now,
        });
        const share = group ? ` (${part.qty} of ${req.qty}, shared with other makers)` : "";
        await repos.orders.addMessage({ producerId: seller.id, orderId: order.id, sender: "BUYER", text: note + share, textEn: note + share, textHi: noteHi ? noteHi + (group ? ` (${req.qty} में से ${part.qty}, बाकी दूसरे कारीगरों से)` : "") : null });
        await repos.alerts.create({
          producerId: seller.id, kind: "ORDER", route: `/order/${code}`,
          title: `${buyer.business} wants ${part.qty} ${part.listing.category}`,
          titleHi: `${buyer.business} को ${part.qty} ${part.listing.nameHi} चाहिए`,
          body: `Wanted by ${shortDate(req.wantedBy)}. Check if you can deliver, then answer.`,
          bodyHi: `${shortDate(req.wantedBy, "hi")} तक चाहिए। देखें कि दे पाएँगे, फिर जवाब दें।`,
        });
        out.push({ code, maker: seller.businessName, qty: part.qty, rate: part.listing.price, proforma: { id: proforma.id, number: proforma.number, total: proforma.total } });
      }
      return { group, orders: out };
    });
    return { ...created, total: round2(created.orders.reduce((a, o) => a + o.proforma.total, 0)) };
  }

  // ------------------------------------------------------------------ tracking (B6)

  async orders(buyerId: string) {
    const rows = await this.repos.orders.listForBuyer(buyerId);
    return { orders: rows.map((o) => ({ ...o, stage: trackStage(o.status) })) };
  }

  async order(buyerId: string, code: string) {
    const o = await this.repos.orders.byCodeForBuyer(buyerId, code);
    if (!o) throw AppError.notFound("Order");
    const [messages, invoices, group] = await Promise.all([
      this.repos.orders.messages(o.id),
      this.repos.orders.invoices(o.id),
      o.parentCode ? this.repos.orders.group(o.parentCode) : Promise.resolve([]),
    ]);
    const advance = o.advance ? { ...o.advance, upiUrl: o.advance.status === "PAID" ? null : await this.advanceLink(o.id, o.code, o.advance.amount) } : null;
    return {
      order: { ...o, stage: trackStage(o.status), advance },
      stages: TRACK_STAGES,
      messages: messages.map((m) => ({
        id: m.id, mine: m.sender === "BUYER", createdAt: m.createdAt,
        // the buyer reads English; a maker's Hindi note says when it could not be translated
        text: m.sender === "BUYER" ? m.text : (m.textEn ?? m.text), original: m.text,
        translated: m.sender === "PRODUCER" && !!m.textEn && m.textEn !== m.text,
      })),
      invoices: invoices.map((i) => ({ ...i, total: Number(i.total) })),
      group: group.filter((g) => g.code !== o.code).map((g) => ({ code: g.code, qty: g.qty, stage: trackStage(g.status), maker: g.producer.businessName })),
    };
  }

  /** The buyer writes English; the maker reads Hindi (original kept). */
  async message(buyerId: string, code: string, text: string) {
    const o = await this.repos.orders.byCodeForBuyer(buyerId, code);
    if (!o) throw AppError.notFound("Order");
    const clean = text.trim();
    const hi = await this.translator.translate(clean, "hi");
    const producerId = await this.repos.orders.producerOf(o.id);
    await this.repos.orders.addMessage({ producerId, orderId: o.id, sender: "BUYER", text: clean, textEn: clean, textHi: hi });
    return this.order(buyerId, code);
  }

  /** The buyer says the advance is paid and gives the UPI reference; the maker then confirms it arrived. */
  async claimAdvance(buyerId: string, code: string, utr: string) {
    const o = await this.repos.orders.byCodeForBuyer(buyerId, code);
    if (!o) throw AppError.notFound("Order");
    if (!o.advance || o.advance.status === "PAID") throw AppError.conflict("NO_ADVANCE_DUE", "No advance is due on this order");
    const producerId = await this.repos.orders.producerOf(o.id);
    await this.uow.run(async (repos) => {
      await repos.orders.update(o.id, { advanceStatus: "CLAIMED", advanceRef: utr });
      const en = `Advance of ${inr(o.advance!.amount)} paid. UPI reference ${utr}.`;
      const hi = `${inr(o.advance!.amount)} एडवांस भेज दिया। UPI रेफ़रेंस ${utr}। खाते में देखकर "मिल गया" दबाएँ।`;
      await repos.orders.addMessage({ producerId, orderId: o.id, sender: "BUYER", text: en, textEn: en, textHi: hi });
      await repos.alerts.create({
        producerId, kind: "PAYMENT", route: `/order/${o.code}`,
        title: `Advance ${inr(o.advance!.amount)} paid for ${o.code}: check your UPI`, titleHi: `${o.code} का ${inr(o.advance!.amount)} एडवांस आया: UPI में देखें`,
        body: `UPI reference ${utr}. Confirm on the order once you see it.`, bodyHi: `UPI रेफ़रेंस ${utr}। पैसा दिखे तो ऑर्डर पर पक्का करें।`,
      });
    });
    return this.order(buyerId, code);
  }

  private async advanceLink(orderId: string, code: string, amount: number) {
    const producerId = await this.repos.orders.producerOf(orderId);
    const p = await this.repos.producers.findProfile(producerId);
    return p?.upiId ? upiLink(p.upiId, p.businessName, amount, `Advance ${code}`) : null;
  }

  invoicePdf(buyerId: string, invoiceId: string) {
    return this.invoices.pdfForBuyer(buyerId, invoiceId);
  }

  async dispatchPhoto(buyerId: string, code: string): Promise<{ bytes: Buffer; mediaType: string }> {
    const o = await this.repos.orders.byCodeForBuyer(buyerId, code);
    const stored = o ? await this.repos.orders.dispatchPhotoPath(o.id) : null;
    const bytes = stored ? await this.files.read(stored) : null;
    if (!stored || !bytes) throw AppError.notFound("Dispatch photo");
    return { bytes, mediaType: stored.endsWith(".png") ? "image/png" : stored.endsWith(".webp") ? "image/webp" : "image/jpeg" };
  }

  // ------------------------------------------------------------------ helpers

  private async plan(l: Listing, qty: number, wantedBy: Date): Promise<QuoteView> {
    const plan = await this.quotes.forProduct({ id: l.maker.id, machines: l.maker.machines }, l.id, qty, wantedBy);
    if (!plan) throw AppError.notFound("Product");
    // buyers do not see the maker's material shortfalls (suppliers, dates): only that they were counted
    return { ...plan, shortfalls: [] };
  }

  /** Other makers in the cluster share what the chosen maker can't make by the date. */
  private async clusterOption(l: Listing, req: QuoteRequest, plan: QuoteView, buyerState: string | null) {
    if (!l.maker.cluster) return null;
    // only makers who can clearly bill this buyer: allowed by their scheme and no registration question
    const peers = (await this.repos.market.clusterPeers(l.maker.cluster.id, l.category, l.maker.id)).filter((p) => {
      const t = this.saleTerms(p, 1, buyerState);
      return t.allowed && !t.warningEn;
    });
    if (peers.length === 0) return null;
    const remaining = req.qty - plan.qtyByWanted;
    const peerPlans = await Promise.all(
      peers.map(async (p) => ({ listing: p, plan: await this.quotes.forProduct({ id: p.maker.id, machines: p.maker.machines }, p.id, remaining, req.wantedBy) })),
    );
    const byProducer = new Map<string, Listing>([[l.maker.id, l], ...peerPlans.map((x) => [x.listing.maker.id, x.listing] as const)]);
    const result = splitByCapacity(
      [
        { producerId: l.maker.id, productId: l.id, capacityByDate: plan.qtyByWanted },
        ...peerPlans.filter((x) => x.plan).map((x) => ({ producerId: x.listing.maker.id, productId: x.listing.id, capacityByDate: x.plan!.qtyByWanted })),
      ],
      req.qty,
      l.maker.id,
      MAX_SPLIT_MAKERS,
    );
    const rows = result.rows
      .filter((r) => r.assigned > 0)
      .map((r) => {
        const listing = byProducer.get(r.producerId)!;
        return { assigned: r.assigned, maker: trust(listing.maker), product: this.card(listing, undefined), value: round2(r.assigned * listing.price) };
      });
    if (rows.length < 2) return null;
    return { covered: result.covered, qty: req.qty, canMeet: result.covered >= req.qty, rows };
  }

  /** Which document and how much GST, for this buyer's state; refuses what the seller's scheme does not allow. */
  private saleTerms(l: Listing, qty: number, buyerState: string | null) {
    const toState = buyerState ?? l.maker.state;
    const d = decideSaleDocument(l.maker.gstScheme, l.maker.state, toState);
    const taxable = round2(qty * l.price);
    const interState = l.maker.state !== toState;
    if (!d.allowed) return { allowed: false as const, reasonEn: d.reasonEn, reasonHi: d.reasonHi, warningEn: null, taxable, tax: 0, total: taxable, document: null, interState };
    const t = d.chargesTax ? splitTax(taxable, l.gstRate, l.maker.state, toState) : noTax(taxable);
    // An unregistered seller shipping to another state may need GST registration (handicraft exemptions vary): say so.
    const warningEn = l.maker.gstScheme === "UNREGISTERED" && interState
      ? "This maker is not GST-registered. Supplies to another state may need registration; confirm before you pay."
      : null;
    return { allowed: true as const, reasonEn: null, reasonHi: null, warningEn, document: d.document, taxable, tax: round2(t.cgst + t.sgst + t.igst), total: t.total, interState };
  }

  private badges(listings: Listing[]) {
    return this.quotes.badges(listings.map((l) => ({ productId: l.id, producerId: l.maker.id, stock: l.stock, unitsPerMachinePerWeek: l.unitsPerMachinePerWeek, machines: l.maker.machines })));
  }

  private card(l: Listing, badge: { ready: number; perWeek: number; slowWeek: boolean } | undefined) {
    return {
      id: l.id, name: l.name, category: l.category, price: l.price, palette: l.palette, imageUrl: l.imageUrl,
      maker: { slug: l.maker.slug, businessName: l.maker.businessName, city: l.maker.city, cluster: l.maker.cluster?.name ?? null, onTimeRate: l.maker.onTimeRate, avatarColor: l.maker.avatarColor },
      badge: badge ?? null,
    };
  }

  private async listing(productId: string): Promise<Listing> {
    const l = await this.repos.market.listing(productId);
    if (!l) throw AppError.notFound("Product");
    return l;
  }

  private async buyer(buyerId: string) {
    const b = await this.repos.market.buyer(buyerId);
    if (!b) throw AppError.notFound("Buyer");
    return b;
  }
}

/** The trust profile (B7): only facts the system can stand behind, each labelled with how it was checked. */
export function trust(m: MakerRow) {
  const gst = validateGstin(m.gstin);
  return {
    slug: m.slug, name: m.name, businessName: m.businessName, city: m.city, state: m.state, story: m.story, avatarColor: m.avatarColor,
    industry: m.industry, cluster: m.cluster ? { slug: m.cluster.slug, name: m.cluster.name } : null,
    machines: m.machines, since: m.joinedAt, ordersDone: m.ordersDone, onTimeRate: m.onTimeRate,
    gstin: m.gstin, gstinFormatOk: m.gstin ? gst.valid : false, gstScheme: m.gstScheme,
    udyamRegistered: !!m.udyamNumber, marks: m.marks,
  };
}

/** Maker statuses → the four stages a buyer follows. */
export function trackStage(status: string): "QUOTED" | "IN_PRODUCTION" | "DISPATCHED" | "DELIVERED" | "DECLINED" {
  if (status === "CONFIRMED") return "IN_PRODUCTION";
  return status as "QUOTED" | "IN_PRODUCTION" | "DISPATCHED" | "DELIVERED" | "DECLINED";
}
