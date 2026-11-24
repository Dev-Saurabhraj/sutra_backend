import { AppError } from "../../core/errors.js";
import type { FileStore } from "../../core/file-store.js";
import type { Repositories } from "../../data/unit-of-work.js";
import type { StoryWriter } from "../../ai/story-writer.js";
import { margin, unitCost } from "../../engine/pricing.js";
import type { ImageCleaner } from "./image-cleaner.js";

export const CATALOG_FOLDER = "catalog";
/** Public URL prefix for catalog photos (buyers see them without logging in). */
export const MEDIA_PREFIX = "/media/";

export type Photo = { base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" };
export type ListingUpdate = { name?: string; story?: string; price?: number; published?: boolean; acceptBelowCost?: boolean };

/** Catalog builder: photo → clean image + honest story → published listing, with a price floor. */
export class CatalogService {
  constructor(
    private readonly repos: Repositories,
    private readonly writer: StoryWriter,
    private readonly cleaner: ImageCleaner,
    private readonly files: FileStore,
  ) {}

  async list(producerId: string) {
    const [products, labour] = await Promise.all([this.repos.stock.catalog(producerId), this.pieceLabour(producerId)]);
    const items = products.map((p) => {
      const cost = unitCost(p.recipeCost, labour.get(p.id) ?? 0);
      const { recipeCost: _ignored, ...rest } = p;
      return { ...rest, cost, margin: margin(p.price, cost.total), labourKnown: labour.has(p.id), ready: !!p.imageUrl && !!p.story.trim() };
    });
    return { published: items.filter((i) => i.published).length, total: items.length, items };
  }

  /** Clean the photo (if any) and write a draft story. Nothing is published until the maker says so. */
  async draft(producerId: string, productId: string, input: { note: string; photo?: Photo }) {
    const producer = await this.repos.producers.findProfile(producerId);
    if (!producer) throw AppError.notFound("Producer");
    const product = (await this.repos.stock.products(producerId)).find((p) => p.id === productId);
    if (!product) throw AppError.notFound("Product");

    let imageUrl = product.imageUrl;
    let image: Photo | undefined;
    if (input.photo) {
      let clean;
      try {
        clean = await this.cleaner.clean(Buffer.from(input.photo.base64, "base64"));
      } catch {
        throw AppError.badRequest("BAD_PHOTO", "This photo could not be opened. Try another one.");
      }
      imageUrl = MEDIA_PREFIX + (await this.files.save(CATALOG_FOLDER, clean.bytes, clean.extension));
      await this.repos.stock.updateListing(producerId, productId, { imageUrl });
      image = { base64: clean.bytes.toString("base64"), mediaType: clean.mediaType };
    }
    const story = await this.writer.write({
      note: input.note, category: product.category, maker: producer.businessName, place: producer.city, industry: producer.industry.name, image,
    });
    return { productId, imageUrl, ...story };
  }

  /** Save listing fields. Publishing below cost needs an explicit yes (price-floor guard). */
  async update(producerId: string, productId: string, u: ListingUpdate) {
    const { acceptBelowCost, ...data } = u;
    const current = (await this.list(producerId)).items.find((i) => i.id === productId);
    if (!current) throw AppError.notFound("Product");
    const price = data.price ?? current.price;
    const m = margin(price, current.cost.total);
    if (m.belowCost && (data.published ?? current.published) && !acceptBelowCost) {
      throw AppError.conflict("BELOW_COST", `At Rs ${price} you lose Rs ${Math.abs(m.perUnit)} on every piece (cost Rs ${current.cost.total}).`);
    }
    if (data.published && !(data.story ?? current.story).trim()) throw AppError.badRequest("NO_STORY", "Write a few lines about the product first");
    await this.repos.stock.updateListing(producerId, productId, data);
    return (await this.list(producerId)).items.find((i) => i.id === productId)!;
  }

  /** Average piece rate per product: the labour part of the unit cost. */
  private async pieceLabour(producerId: string): Promise<Map<string, number>> {
    const rates = new Map<string, number[]>();
    for (const w of await this.repos.labour.workers(producerId)) {
      if (w.wageType !== "PIECE" || !w.productId) continue;
      rates.set(w.productId, [...(rates.get(w.productId) ?? []), w.rate]);
    }
    return new Map([...rates].map(([id, r]) => [id, r.reduce((a, b) => a + b, 0) / r.length]));
  }
}
