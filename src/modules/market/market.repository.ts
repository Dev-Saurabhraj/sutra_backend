import type { Prisma } from "@prisma/client";
import { num, type DbClient } from "../../core/db.js";
import type { OpenOrderLoad } from "../../engine/quote.js";

const makerSelect = {
  id: true, slug: true, name: true, businessName: true, city: true, state: true, machines: true, story: true, avatarColor: true,
  onTimeRate: true, ordersDone: true, joinedAt: true, gstin: true, gstScheme: true, udyamNumber: true, marks: true,
  cluster: { select: { id: true, slug: true, name: true } },
  industry: { select: { key: true, name: true, nameHi: true, emoji: true } },
} satisfies Prisma.ProducerSelect;

const listingInclude = { producer: { select: makerSelect } } satisfies Prisma.ProductInclude;
type ListingRow = Prisma.ProductGetPayload<{ include: typeof listingInclude }>;
export type MakerRow = Prisma.ProducerGetPayload<{ select: typeof makerSelect }>;

export type MarketFilter = { q?: string; industry?: string; cluster?: string; category?: string; maxPrice?: number };

/** Only what buyers may see: published products of onboarded makers. */
const visible = { published: true, producer: { onboardedAt: { not: null } } } satisfies Prisma.ProductWhereInput;

export class MarketRepository {
  constructor(private readonly db: DbClient) {}

  async listings(f: MarketFilter, take = 60) {
    const where: Prisma.ProductWhereInput = {
      ...visible,
      ...(f.category ? { category: f.category } : {}),
      ...(f.maxPrice ? { price: { lte: f.maxPrice } } : {}),
      ...(f.industry || f.cluster
        ? { producer: { onboardedAt: { not: null }, ...(f.industry ? { industryKey: f.industry } : {}), ...(f.cluster ? { cluster: { slug: f.cluster } } : {}) } }
        : {}),
      ...(f.q
        ? {
            OR: [
              { name: { contains: f.q, mode: "insensitive" } },
              { category: { contains: f.q, mode: "insensitive" } },
              { producer: { businessName: { contains: f.q, mode: "insensitive" } } },
              { producer: { city: { contains: f.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const rows = await this.db.product.findMany({ where, include: listingInclude, orderBy: [{ producer: { onTimeRate: "desc" } }, { price: "asc" }], take });
    return rows.map(toListing);
  }

  async listing(productId: string) {
    const p = await this.db.product.findFirst({ where: { id: productId, ...visible }, include: listingInclude });
    return p ? toListing(p) : null;
  }

  /** Same category from other makers in the same cluster: who could share a big order (B4). */
  async clusterPeers(clusterId: string, category: string, excludeProducerId: string) {
    const rows = await this.db.product.findMany({
      where: { ...visible, category, producer: { onboardedAt: { not: null }, clusterId, id: { not: excludeProducerId } } },
      include: listingInclude,
    });
    return rows.map(toListing);
  }

  maker(slug: string): Promise<MakerRow | null> {
    return this.db.producer.findFirst({ where: { slug, onboardedAt: { not: null } }, select: makerSelect });
  }

  async facets() {
    const [industries, clusters, categories] = await Promise.all([
      this.db.industry.findMany({ where: { producers: { some: { products: { some: { published: true } } } } }, select: { key: true, name: true, nameHi: true, emoji: true }, orderBy: { sortOrder: "asc" } }),
      this.db.cluster.findMany({ select: { slug: true, name: true, city: true } }),
      this.db.product.findMany({ where: visible, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    ]);
    return { industries, clusters, categories: categories.map((c) => c.category) };
  }

  /** Accepted orders per producer (feeds the badge's "ready after other orders"). */
  async openLoadsFor(producerIds: string[]): Promise<(OpenOrderLoad & { producerId: string })[]> {
    if (producerIds.length === 0) return [];
    const rows = await this.db.order.findMany({
      where: { producerId: { in: producerIds }, status: { in: ["CONFIRMED", "IN_PRODUCTION"] } },
      select: { producerId: true, productId: true, qty: true, product: { select: { stock: true, unitsPerMachinePerWeek: true } } },
    });
    return rows.map((o) => ({ producerId: o.producerId, productId: o.productId, qty: o.qty, productStock: o.product.stock, unitsPerMachinePerWeek: o.product.unitsPerMachinePerWeek }));
  }

  buyer(id: string) {
    return this.db.buyer.findUnique({ where: { id }, select: { id: true, name: true, business: true, city: true, state: true, gstin: true, phone: true } });
  }

  createBuyer(data: { name: string; business: string; city: string; state: string; gstin: string | null; phone: string }) {
    return this.db.buyer.create({ data, select: { id: true } });
  }
}

function toListing(p: ListingRow) {
  return {
    id: p.id, name: p.name, nameHi: p.nameHi, category: p.category, story: p.story, price: num(p.price), mrp: num(p.mrp),
    hsn: p.hsn, gstRate: num(p.gstRate), stock: p.stock, unitsPerMachinePerWeek: p.unitsPerMachinePerWeek, palette: p.palette, imageUrl: p.imageUrl,
    maker: p.producer,
  };
}
export type Listing = ReturnType<typeof toListing>;
