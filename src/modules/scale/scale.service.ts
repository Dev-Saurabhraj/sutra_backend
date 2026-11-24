import type { PrismaClient } from "@prisma/client";
import { num } from "../../core/db.js";
import { AppError } from "../../core/errors.js";
import type { Repositories } from "../../data/unit-of-work.js";
import type { Clock } from "../../shared/time.js";
import { round2 } from "../../shared/money.js";
import { normalizePhone } from "../auth/auth.service.js";
import type { GstService } from "../gst/gst.service.js";
import { earlyPay, ASSUMED_ANNUAL_RATE, TREDS_PLATFORMS } from "../finance/early-pay.js";
import { domainFor, ondcCatalog, productIssues } from "../ondc/ondc.js";

/**
 * Phase 9, scale: ONDC catalog (X8), early payment on invoices through TReDS (X8), makers joining clusters
 * (multi-cluster), and a CA portal where one accountant sees every client who granted access.
 */
export class ScaleService {
  constructor(
    private readonly db: PrismaClient,
    private readonly repos: Repositories,
    private readonly gst: GstService,
    private readonly clock: Clock,
    private readonly publicBaseUrl: string,
  ) {}

  // ------------------------------------------------------------------ ONDC

  async ondc(producerId: string) {
    const p = await this.db.producer.findUnique({ where: { id: producerId }, include: { products: true } });
    if (!p) throw AppError.notFound("Producer");
    const seller = { id: p.id, businessName: p.businessName, city: p.city, state: p.state, phone: p.phone, gstin: p.gstin, industryKey: p.industryKey, upiId: p.upiId };
    const products = p.products.map((x) => ({
      id: x.id, name: x.name, category: x.category, story: x.story, price: num(x.price), mrp: num(x.mrp), hsn: x.hsn, gstRate: num(x.gstRate),
      stock: x.stock, imageUrl: x.imageUrl, published: x.published,
    }));
    const items = products.map((x) => ({ id: x.id, name: x.name, issues: productIssues(x, seller) }));
    const ready = items.filter((i) => !i.issues.some((x) => x.blocking));
    return {
      domain: domainFor(p.industryKey),
      ready: ready.length,
      total: items.length,
      items,
      catalog: ondcCatalog(seller, products.filter((x) => ready.some((r) => r.id === x.id)), this.publicBaseUrl),
    };
  }

  // ------------------------------------------------------------------ TReDS early payment

  async earlyPay(producerId: string) {
    const profile = await this.repos.producers.findProfile(producerId);
    if (!profile) throw AppError.notFound("Producer");
    const open = await this.db.ledgerEntry.findMany({ where: { producerId, direction: "RECEIVE", settled: false }, orderBy: { dueDate: "asc" } });
    const invoiceNos = open.map((o) => o.invoiceNo).filter((x): x is string => !!x);
    const invoices = await this.db.invoice.findMany({ where: { producerId, number: { in: invoiceNos } }, select: { number: true, buyerGstin: true } });
    const gstinOf = new Map(invoices.map((i) => [i.number, i.buyerGstin]));
    const rows = earlyPay(
      open.map((o) => ({ id: o.id, party: o.party, invoiceNo: o.invoiceNo, amount: num(o.amount), dueDate: o.dueDate, buyerGstin: o.invoiceNo ? (gstinOf.get(o.invoiceNo) ?? null) : null })),
      !!profile.udyamNumber,
      this.clock.now(),
    );
    const possible = rows.filter((r) => r.fit !== "NO");
    return {
      msme: !!profile.udyamNumber,
      assumedRate: ASSUMED_ANNUAL_RATE,
      possible: round2(possible.reduce((a, r) => a + r.amount, 0)),
      rows,
      platforms: TREDS_PLATFORMS,
    };
  }

  // ------------------------------------------------------------------ multi-cluster

  async clusters(producerId: string) {
    const p = await this.db.producer.findUnique({ where: { id: producerId }, select: { industryKey: true, clusterId: true, state: true } });
    if (!p) throw AppError.notFound("Producer");
    const [rows, pending] = await Promise.all([
      this.db.cluster.findMany({ include: { industry: { select: { name: true, nameHi: true, emoji: true } }, _count: { select: { producers: true } } }, orderBy: { name: "asc" } }),
      this.db.clusterJoin.findFirst({ where: { producerId, status: "PENDING" }, select: { clusterId: true, createdAt: true } }),
    ]);
    return {
      mine: p.clusterId,
      pending,
      clusters: rows
        .map((c) => ({
          id: c.id, name: c.name, city: c.city, state: c.state, industry: c.industry, makers: c._count.producers,
          sameTrade: c.industryKey === p.industryKey, sameState: c.state === p.state,
        }))
        .sort((a, b) => Number(b.sameTrade) - Number(a.sameTrade) || Number(b.sameState) - Number(a.sameState)),
    };
  }

  async requestJoin(producerId: string, clusterId: string) {
    const [p, c] = await Promise.all([
      this.db.producer.findUnique({ where: { id: producerId }, select: { clusterId: true, businessName: true } }),
      this.db.cluster.findUnique({ where: { id: clusterId }, select: { id: true, name: true } }),
    ]);
    if (!p || !c) throw AppError.notFound("Cluster");
    if (p.clusterId === clusterId) throw AppError.conflict("ALREADY_MEMBER", "You are already in this cluster");
    await this.db.clusterJoin.updateMany({ where: { producerId, status: "PENDING" }, data: { status: "DECLINED", decidedAt: this.clock.now() } });
    await this.db.clusterJoin.create({ data: { producerId, clusterId } });
    return this.clusters(producerId);
  }

  async pendingJoins(clusterId: string) {
    const rows = await this.db.clusterJoin.findMany({
      where: { clusterId, status: "PENDING" },
      include: { producer: { select: { id: true, name: true, businessName: true, city: true, machines: true, avatarColor: true, industry: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, maker: r.producer }));
  }

  async decideJoin(clusterId: string, joinId: string, approve: boolean) {
    const j = await this.db.clusterJoin.findFirst({ where: { id: joinId, clusterId, status: "PENDING" } });
    if (!j) throw AppError.notFound("Join request");
    await this.db.$transaction(async (tx) => {
      await tx.clusterJoin.update({ where: { id: j.id }, data: { status: approve ? "APPROVED" : "DECLINED", decidedAt: this.clock.now() } });
      if (approve) await tx.producer.update({ where: { id: j.producerId }, data: { clusterId } });
      const c = await tx.cluster.findUniqueOrThrow({ where: { id: clusterId }, select: { name: true } });
      await tx.alert.create({
        data: {
          producerId: j.producerId, kind: "INFO",
          title: approve ? `You are now part of ${c.name}` : `${c.name} did not accept the request`,
          titleHi: approve ? `अब आप ${c.name} में हैं` : `${c.name} ने अनुरोध नहीं माना`,
          body: approve ? "Bulk orders and buying together are open to you." : "You can ask another cluster.",
          bodyHi: approve ? "बड़े ऑर्डर और साथ में ख़रीद अब आपके लिए भी।" : "आप दूसरे क्लस्टर से पूछ सकते हैं।",
        },
      });
    });
    return this.pendingJoins(clusterId);
  }

  // ------------------------------------------------------------------ CA portal

  /** The maker gives a CA read-only access to their GST. A new number gets a CA login. */
  async grantCa(producerId: string, rawPhone: string, name: string) {
    const phone = normalizePhone(rawPhone);
    let user = await this.db.user.findUnique({ where: { phone } });
    if (user && user.role !== "CA") throw AppError.conflict("NOT_A_CA", "This number already belongs to a business account");
    user ??= await this.db.user.create({ data: { phone, role: "CA", displayName: name.trim(), language: "en" } });
    await this.db.caAccess.upsert({
      where: { producerId_caUserId: { producerId, caUserId: user.id } },
      update: { status: "ACTIVE", revokedAt: null },
      create: { producerId, caUserId: user.id },
    });
    return this.caAccessFor(producerId);
  }

  async caAccessFor(producerId: string) {
    const rows = await this.db.caAccess.findMany({ where: { producerId, status: "ACTIVE" }, include: { ca: { select: { phone: true, displayName: true } } } });
    return { access: rows.map((r) => ({ id: r.id, name: r.ca.displayName ?? "CA", phone: r.ca.phone, since: r.createdAt })) };
  }

  async revokeCa(producerId: string, accessId: string) {
    const r = await this.db.caAccess.updateMany({ where: { id: accessId, producerId, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: this.clock.now() } });
    if (r.count !== 1) throw AppError.notFound("Access");
    return this.caAccessFor(producerId);
  }

  async caClients(caUserId: string, month?: string) {
    const rows = await this.db.caAccess.findMany({
      where: { caUserId, status: "ACTIVE" },
      include: { producer: { select: { id: true, businessName: true, name: true, city: true, gstin: true, gstScheme: true, avatarColor: true } } },
    });
    const clients = await Promise.all(rows.map(async (r) => {
      const g = (await this.gst.summary(r.producer.id, month ? { month } : {})) as Record<string, unknown>;
      const net = g.net as { payable?: number } | undefined;
      const comp = g.composition as { tax?: number } | undefined;
      const itc = g.itc as { atRisk?: number } | undefined;
      return {
        ...r.producer,
        period: (g.period as { label: string }).label,
        payable: round2(net?.payable ?? comp?.tax ?? 0),
        itcAtRisk: round2(itc?.atRisk ?? 0),
        issues: (g.issues as unknown[]).length,
        filing: g.filing,
      };
    }));
    return { clients: clients.sort((a, b) => b.issues - a.issues || b.payable - a.payable) };
  }

  /** Every CA read goes through here: no grant, no data. */
  async caClient(caUserId: string, producerId: string) {
    const ok = await this.db.caAccess.findFirst({ where: { caUserId, producerId, status: "ACTIVE" } });
    if (!ok) throw AppError.forbidden("This maker has not given you access");
    return producerId;
  }
}
