import { AppError } from "../../core/errors.js";
import type { Repositories, UnitOfWork } from "../../data/unit-of-work.js";
import { materialHealth, roundQty, USAGE_WINDOW_DAYS } from "../../engine/reorder.js";
import { splitByCapacity } from "../../engine/split.js";
import { validateGstin } from "../../shared/gst/gstin.js";
import { inr, round2 } from "../../shared/money.js";
import { addDays, shortDate, type Clock } from "../../shared/time.js";
import type { GstService } from "../gst/gst.service.js";
import type { QuoteService } from "../quotes/quote.service.js";
import type { SchemeService } from "../schemes/scheme.service.js";
import type { ClusterRepository } from "./cluster.repository.js";

const GROUP_BUY_WEEKS = 4;
/** Only an illustration of what a bulk rate could save; the real rate is the supplier's to give. */
const ASSUMED_BULK_DISCOUNT = 0.05;

export type BulkRequest = { category: string; qty: number; wantedBy: Date; buyer?: string; note?: string };

/**
 * The cluster dashboard (C1–C5) for a cooperative / FPO secretary: every maker at a glance, bulk orders split by
 * real capacity, combined raw-material buying, GST health and the impact numbers funders ask for.
 */
export class ClusterService {
  constructor(
    private readonly cluster: ClusterRepository,
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly quotes: QuoteService,
    private readonly gst: GstService,
    private readonly schemes: SchemeService,
    private readonly clock: Clock,
  ) {}

  /** What this cluster's makers actually make (the bulk-order picker shows only these). */
  async categories(clusterId: string): Promise<string[]> {
    const makers = await this.cluster.makers(clusterId);
    const all = await Promise.all(makers.map((m) => this.repos.stock.products(m.id)));
    return [...new Set(all.flat().map((p) => p.category))].sort();
  }

  async clusterOf(userId: string): Promise<string> {
    const id = await this.cluster.adminCluster(userId);
    if (!id) throw AppError.forbidden("This account does not manage a cluster");
    return id;
  }

  /** C1: production, stock health, orders and GST status for every maker. */
  async overview(clusterId: string) {
    const now = this.clock.now();
    const [info, makers] = await Promise.all([this.cluster.cluster(clusterId), this.cluster.makers(clusterId)]);
    if (!info) throw AppError.notFound("Cluster");
    const ids = makers.map((m) => m.id);
    const [made, sales, orders] = await Promise.all([
      this.cluster.madeSince(ids, addDays(now, -30)),
      this.cluster.salesSince(ids, addDays(now, -30)),
      this.cluster.orderCounts(ids),
    ]);
    const rows = await Promise.all(
      makers.map(async (m) => {
        const health = (await this.repos.stock.materialsWithUsage(m.id, addDays(now, -USAGE_WINDOW_DAYS))).map((x) => materialHealth(x, now));
        const count = (statuses: string[]) => orders.filter((o) => o.producerId === m.id && statuses.includes(o.status)).reduce((a, o) => a + o.count, 0);
        return {
          id: m.id, slug: m.slug, name: m.name, businessName: m.businessName, machines: m.machines, avatarColor: m.avatarColor,
          onTimeRate: m.onTimeRate, made30: made.get(m.id) ?? 0, sales30: round2(sales.get(m.id)?.value ?? 0),
          newRequests: count(["QUOTED"]), openOrders: count(["CONFIRMED", "IN_PRODUCTION", "DISPATCHED"]),
          stock: { critical: health.filter((h) => h.status === "CRITICAL").length, low: health.filter((h) => h.status === "LOW").length },
          gst: { scheme: m.gstScheme, gstinOk: m.gstScheme === "UNREGISTERED" ? null : validateGstin(m.gstin).valid },
        };
      }),
    );
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
    return {
      cluster: info,
      totals: {
        makers: rows.length, machines: sum((r) => r.machines), made30: sum((r) => r.made30), sales30: round2(sum((r) => r.sales30)),
        openOrders: sum((r) => r.openOrders), newRequests: sum((r) => r.newRequests),
        stockAlerts: sum((r) => r.stock.critical), gstProblems: rows.filter((r) => r.gst.gstinOk === false).length,
      },
      makers: rows,
    };
  }

  /** C2: what each maker can honestly make by the date, then a fair share of the order by that capacity. */
  async split(clusterId: string, req: BulkRequest) {
    const makers = await this.cluster.makers(clusterId);
    const listings = (await Promise.all(makers.map(async (m) => {
      const product = (await this.repos.stock.products(m.id)).find((p) => p.category === req.category);
      return product ? { maker: m, product } : null;
    }))).filter((x) => x !== null);
    if (listings.length === 0) throw AppError.badRequest("NO_MAKERS", `No maker in this cluster makes ${req.category}`);
    const plans = await Promise.all(listings.map(async (l) => ({ ...l, plan: await this.quotes.forProduct(l.maker, l.product.id, req.qty, req.wantedBy) })));
    const result = splitByCapacity(plans.map((p) => ({ producerId: p.maker.id, productId: p.product.id, capacityByDate: p.plan?.qtyByWanted ?? 0 })), req.qty);
    const rows = result.rows.map((r) => {
      const p = plans.find((x) => x.maker.id === r.producerId)!;
      return {
        producerId: r.producerId, productId: r.productId, maker: p.maker.businessName, avatarColor: p.maker.avatarColor, onTimeRate: p.maker.onTimeRate,
        product: p.product.name, rate: p.product.price, capacity: r.capacityByDate, assigned: r.assigned, value: round2(r.assigned * p.product.price),
      };
    }).sort((a, b) => b.assigned - a.assigned);
    return {
      category: req.category, qty: req.qty, wantedBy: req.wantedBy, covered: result.covered, totalCapacity: result.totalCapacity,
      canMeet: result.covered >= req.qty, value: round2(rows.reduce((a, r) => a + r.value, 0)), rows,
    };
  }

  /** Send the split to the makers: one request each, grouped under one bulk code, with an alert in Hindi. */
  async sendSplit(clusterId: string, req: BulkRequest) {
    const plan = await this.split(clusterId, req);
    const info = await this.cluster.cluster(clusterId);
    const who = req.buyer?.trim() || info!.name;
    return this.uow.run(async (repos) => {
      const group = `BULK-${await repos.counters.next("bulk", 101)}`;
      const out = [];
      for (const r of plan.rows.filter((x) => x.assigned > 0)) {
        const code = `SUT-${await repos.counters.next("order", 1001)}`;
        const order = await repos.orders.create({
          code, producerId: r.producerId, productId: r.productId, channel: "DIRECT", status: "QUOTED", qty: r.assigned, rate: r.rate,
          wantedBy: req.wantedBy, quoteNote: `${group}: ${r.assigned} of ${req.qty} for ${who}`,
        });
        await repos.orders.update(order.id, { parentCode: group });
        const en = `${who}: ${r.assigned} of ${req.qty} ${req.category} by ${shortDate(req.wantedBy)}, shared across the cluster by capacity.${req.note ? ` ${req.note}` : ""}`;
        const hi = `${who}: ${req.qty} में से ${r.assigned} ${req.category}, ${shortDate(req.wantedBy, "hi")} तक। क्लस्टर में सबकी क्षमता के हिसाब से बाँटा गया।`;
        await repos.orders.addMessage({ producerId: r.producerId, orderId: order.id, sender: "SUTRA", text: en, textEn: en, textHi: hi });
        await repos.alerts.create({
          producerId: r.producerId, kind: "ORDER", route: `/order/${code}`,
          title: `Cluster order: ${r.assigned} ${req.category}`, titleHi: `क्लस्टर ऑर्डर: ${r.assigned} ${req.category}`,
          body: `Part of ${group} (${req.qty} in all) for ${who}. Check and answer.`, bodyHi: `${who} का ${group} (कुल ${req.qty})। देखकर जवाब दें।`,
        });
        out.push({ code, maker: r.maker, qty: r.assigned });
      }
      return { group, orders: out };
    });
  }

  /** C3: what every maker needs in the next 4 weeks, combined per material, so the cluster can ask one bulk rate. */
  async groupBuy(clusterId: string) {
    const now = this.clock.now();
    const makers = await this.cluster.makers(clusterId);
    type Line = {
      name: string; nameHi: string; unit: string; qty: number; value: number;
      makers: { businessName: string; qty: number }[]; suppliers: Map<string, { name: string; phone: string }>;
    };
    const lines = new Map<string, Line>();
    for (const m of makers) {
      const mats = await this.repos.stock.materialsWithUsage(m.id, addDays(now, -USAGE_WINDOW_DAYS));
      for (const x of mats) {
        const h = materialHealth(x, now);
        const need = h.usagePerDay * 7 * GROUP_BUY_WEEKS - h.stock;
        if (need <= 0) continue;
        const qty = roundQty(need);
        const key = x.name.toLowerCase();
        const line: Line = lines.get(key) ?? { name: x.name, nameHi: x.nameHi, unit: x.unit, qty: 0, value: 0, makers: [], suppliers: new Map() };
        line.qty = roundQty(line.qty + qty);
        line.value = round2(line.value + qty * x.costPerUnit);
        line.makers.push({ businessName: m.businessName, qty });
        if (x.supplier) line.suppliers.set(x.supplier.id, { name: x.supplier.name, phone: x.supplier.phone });
        lines.set(key, line);
      }
    }
    const info = await this.cluster.cluster(clusterId);
    const items = [...lines.values()]
      .sort((a, b) => b.value - a.value)
      .map((l) => {
        const suppliers = [...l.suppliers.values()];
        const message = `Namaste ji, ${info!.name} ki taraf se: ${l.makers.length} karigaron ke liye ek saath ${l.qty} ${l.unit} ${l.name} chahiye (agle ${GROUP_BUY_WEEKS} hafte). Bulk rate batayein. Dhanyavaad.`;
        return {
          name: l.name, nameHi: l.nameHi, unit: l.unit, qty: l.qty, value: l.value, makers: l.makers.sort((a, b) => b.qty - a.qty),
          suppliers, message, possibleSaving: round2(l.value * ASSUMED_BULK_DISCOUNT),
        };
      });
    return { weeks: GROUP_BUY_WEEKS, assumedDiscount: ASSUMED_BULK_DISCOUNT, total: round2(items.reduce((a, i) => a + i.value, 0)), items };
  }

  /** C4: GST health per maker this month: GSTIN, issues to fix, credit at risk, limits. */
  async compliance(clusterId: string) {
    const makers = await this.cluster.makers(clusterId);
    const rows = await Promise.all(makers.map(async (m) => {
      const g = await this.gst.summary(m.id, {});
      const issues = (g.issues ?? []) as { kind: string; text: string; textHi: string; amount: number }[];
      const itcAtRisk = "itc" in g && g.itc ? (g.itc as { atRisk: number }).atRisk : 0;
      const sch = await this.schemes.forProducer(m.id);
      return {
        id: m.id, businessName: m.businessName, scheme: m.gstScheme, gstin: m.gstin,
        gstinOk: m.gstScheme === "UNREGISTERED" ? null : validateGstin(m.gstin).valid,
        udyam: !!m.udyamNumber, issues, itcAtRisk: round2(itcAtRisk),
        schemes: sch.schemes.filter((s) => s.fit === "LIKELY").map((s) => ({ key: s.key, name: s.name, nameHi: s.nameHi, link: s.link })),
      };
    }));
    rows.sort((a, b) => b.issues.length - a.issues.length || b.itcAtRisk - a.itcAtRisk);
    return {
      makers: rows,
      totals: { withIssues: rows.filter((r) => r.issues.length > 0).length, itcAtRisk: round2(rows.reduce((a, r) => a + r.itcAtRisk, 0)), noUdyam: rows.filter((r) => !r.udyam).length },
    };
  }

  /** C5: what changed for the makers: sales, orders won directly, and the agent's cut they kept. */
  async impact(clusterId: string) {
    const now = this.clock.now();
    const makers = await this.cluster.makers(clusterId);
    const ids = makers.map((m) => m.id);
    const [sales90, direct] = await Promise.all([this.cluster.salesSince(ids, addDays(now, -90)), this.cluster.directDelivered(ids, addDays(now, -365))]);
    const rows = makers.map((m) => {
      const mine = direct.filter((d) => d.producerId === m.id);
      const directValue = round2(mine.reduce((a, d) => a + d.value, 0));
      return {
        id: m.id, businessName: m.businessName, avatarColor: m.avatarColor, onTimeRate: m.onTimeRate,
        sales90: round2(sales90.get(m.id)?.value ?? 0), monthlyIncome: round2((sales90.get(m.id)?.value ?? 0) / 3),
        directOrders: mine.length, directValue, agentCutKept: round2((directValue * m.agentCutPct) / 100), agentCutPct: m.agentCutPct,
      };
    }).sort((a, b) => b.agentCutKept - a.agentCutKept);
    const total = (f: (r: (typeof rows)[number]) => number) => round2(rows.reduce((a, r) => a + f(r), 0));
    const totals = {
      makers: rows.length, sales90: total((r) => r.sales90), directOrders: total((r) => r.directOrders), directValue: total((r) => r.directValue),
      agentCutKept: total((r) => r.agentCutKept), avgOnTime: rows.length ? Math.round((rows.reduce((a, r) => a + r.onTimeRate, 0) / rows.length) * 1000) / 10 : 0,
    };
    return {
      totals, makers: rows,
      headline: `${totals.makers} makers kept ${inr(totals.agentCutKept)} that would have gone to agents, on ${totals.directOrders} direct orders this year.`,
      headlineHi: `${totals.makers} कारीगरों ने इस साल ${totals.directOrders} सीधे ऑर्डर पर ${inr(totals.agentCutKept)} बचाए जो बिचौलिये को जाते।`,
    };
  }
}
