import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { Repositories } from "../../data/unit-of-work.js";
import type { FileStore } from "../../core/file-store.js";
import { TemplateStoryWriter } from "../../ai/story-writer.js";
import { CatalogService } from "./catalog.service.js";
import { CATALOG_SIZE, SharpImageCleaner } from "./image-cleaner.js";

describe("SharpImageCleaner", () => {
  it("makes a square jpeg of catalog size from any photo", async () => {
    const photo = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 180, g: 60, b: 40 } } }).png().toBuffer();
    const out = await new SharpImageCleaner().clean(photo);
    const meta = await sharp(out.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", CATALOG_SIZE, CATALOG_SIZE]);
  });

  it("refuses bytes that are not an image", async () => {
    await expect(new SharpImageCleaner().clean(Buffer.from("not a photo"))).rejects.toThrow();
  });
});

describe("CatalogService price floor", () => {
  const product = {
    id: "p1", slug: "s", name: "Saree", nameHi: "साड़ी", category: "Saree", stock: 3, price: 1000, hsn: "5208", gstRate: 5,
    unitsPerMachinePerWeek: 2, palette: "#a33", imageUrl: null, story: "Woven by hand.", mrp: 1800, published: false,
    recipeCost: [{ qtyPerUnit: 2, costPerUnit: 300 }], // materials 600
  };
  const updates: unknown[] = [];
  const repos = {
    stock: { catalog: async () => [product], updateListing: async (_p: string, _id: string, d: unknown) => (updates.push(d), true) },
    labour: { workers: async () => [{ wageType: "PIECE", productId: "p1", rate: 300 }] }, // labour 300 → cost 900
  } as unknown as Repositories;
  const svc = new CatalogService(repos, new TemplateStoryWriter(), new SharpImageCleaner(), {} as FileStore);

  it("counts piece wages in the cost", async () => {
    const { items } = await svc.list("me");
    expect(items[0]!.cost.total).toBe(900);
    expect(items[0]!.labourKnown).toBe(true);
  });

  it("blocks publishing below cost unless the maker says yes", async () => {
    await expect(svc.update("me", "p1", { price: 850, published: true })).rejects.toMatchObject({ code: "BELOW_COST" });
    await svc.update("me", "p1", { price: 850, published: true, acceptBelowCost: true });
    expect(updates.at(-1)).toEqual({ price: 850, published: true });
  });

  it("lets a below-cost price be saved while unpublished", async () => {
    await svc.update("me", "p1", { price: 800 });
    expect(updates.at(-1)).toEqual({ price: 800 });
  });
});
