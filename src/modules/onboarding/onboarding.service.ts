import { z } from "zod";
import { AppError } from "../../core/errors.js";
import type { Repositories, UnitOfWork } from "../../data/unit-of-work.js";
import { validateGstin } from "../../shared/gst/gstin.js";
import { STATE_CODES } from "../../shared/gst/states.js";
import type { Clock } from "../../shared/time.js";
import type { AuthService, Session } from "../auth/auth.service.js";
import { INDUSTRY_TEMPLATES, templateFor } from "./industry-templates.js";

const AVATAR_COLORS = ["#B4441F", "#0F766E", "#9D174D", "#1E3A8A", "#B45309", "#4D7C0F", "#6D28D9", "#155E75"];

export const OnboardingInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    businessName: z.string().trim().min(2).max(80),
    language: z.enum(["hi", "en"]).default("hi"),
    industryKey: z.string().min(1).max(20),
    businessKind: z.enum(["MAKER", "TRADER"]).default("MAKER"),
    city: z.string().trim().min(2).max(40),
    state: z.string().refine((s) => s in STATE_CODES, "Choose a state from the list"),
    machines: z.number().int().min(1).max(10_000),
    gstScheme: z.enum(["REGULAR", "COMPOSITION", "UNREGISTERED"]),
    gstin: z.string().trim().toUpperCase().optional(),
    udyamNumber: z.string().trim().max(25).optional(),
    upiId: z.string().trim().max(60).optional(),
    materials: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          nameHi: z.string().trim().max(80).optional(),
          unit: z.string().trim().min(1).max(12),
          hsn: z.string().trim().max(8).default(""),
          gstRate: z.number().min(0).max(28).default(18),
          costPerUnit: z.number().min(0).max(100_000_000),
          stock: z.number().min(0).max(1_000_000).default(0),
          supplier: z
            .object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().max(20).default(""), city: z.string().trim().max(40).default(""), leadTimeDays: z.number().int().min(0).max(120).default(7) })
            .optional(),
        }),
      )
      .max(30)
      .default([]),
    products: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          nameHi: z.string().trim().max(80).optional(),
          category: z.string().trim().max(40).optional(),
          price: z.number().min(0).max(100_000_000),
          hsn: z.string().trim().max(8).default(""),
          gstRate: z.number().min(0).max(28).default(5),
          stock: z.number().int().min(0).max(1_000_000).default(0),
          unitsPerMachinePerWeek: z.number().positive().max(10_000).default(5),
          /** Index into `materials` for each recipe line, so the app can send everything in one go. */
          recipe: z.array(z.object({ material: z.number().int().min(0), qtyPerUnit: z.number().positive().max(10_000) })).max(20).default([]),
        }),
      )
      .min(1)
      .max(30),
    workers: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          phone: z.string().trim().max(20).optional(),
          wageType: z.enum(["DAILY", "PIECE", "MONTHLY"]),
          rate: z.number().positive().max(1_000_000),
          payCycle: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("WEEKLY"),
        }),
      )
      .max(200)
      .default([]),
  })
  .superRefine((v, ctx) => {
    if (v.gstScheme !== "UNREGISTERED") {
      const check = validateGstin(v.gstin);
      if (!check.valid) ctx.addIssue({ code: "custom", path: ["gstin"], message: check.reason ?? "GSTIN is not valid" });
      else if (check.state !== v.state) ctx.addIssue({ code: "custom", path: ["gstin"], message: `This GSTIN is registered in ${check.state}, not ${v.state}` });
    }
    v.products.forEach((p, i) =>
      p.recipe.forEach((r) => {
        if (r.material >= v.materials.length) ctx.addIssue({ code: "custom", path: ["products", i, "recipe"], message: "Recipe points to a missing material" });
      }),
    );
  });
export type OnboardingInputT = z.infer<typeof OnboardingInput>;

/** A shop, boutique or exporter buying from makers: four facts, nothing else. */
export const BuyerOnboardingInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    business: z.string().trim().min(2).max(80),
    city: z.string().trim().min(2).max(40),
    state: z.string().refine((s) => s in STATE_CODES, "Choose a state from the list"),
    gstin: z.string().trim().toUpperCase().optional().or(z.literal("").transform(() => undefined)),
    language: z.enum(["hi", "en"]).default("en"),
  })
  .superRefine((b, ctx) => {
    if (!b.gstin) return;
    const g = validateGstin(b.gstin);
    if (!g.valid) ctx.addIssue({ code: "custom", path: ["gstin"], message: g.reason ?? "This GSTIN is not valid" });
    else if (g.state && g.state !== b.state) ctx.addIssue({ code: "custom", path: ["gstin"], message: `This GSTIN is registered in ${g.state}` });
  });
export type BuyerOnboardingInputT = z.infer<typeof BuyerOnboardingInput>;

/** Creates a whole business from one onboarding form: profile, suppliers, materials, products with recipes, workers. */
export class OnboardingService {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly auth: AuthService,
    private readonly clock: Clock,
  ) {}

  /** Industries with their starter templates, in display order. */
  industries() {
    return INDUSTRY_TEMPLATES.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async complete(userId: string, input: OnboardingInputT): Promise<Session> {
    const user = await this.repos.auth.findUserById(userId);
    if (!user) throw AppError.unauthorized();
    if (user.producerId) throw AppError.conflict("ALREADY_ONBOARDED", "This business is already set up");
    const template = templateFor(input.industryKey);
    if (!template) throw AppError.badRequest("UNKNOWN_INDUSTRY", "Choose what you make from the list");

    const now = this.clock.now();
    await this.uow.run(async (repos) => {
      const { materials, products, labour, ...industry } = template;
      await repos.producers.ensureIndustry({ ...industry, template: { materials, products, labour } });
      const producer = await this.createProducer(repos, input, user.phone, now);
      const materialIds = await this.createMaterials(repos, producer.id, input);
      await this.createProducts(repos, producer.id, input, materialIds);
      for (const w of input.workers) await repos.labour.createWorker({ ...w, producerId: producer.id, phone: w.phone ?? null });
      await repos.auth.linkProducer(userId, producer.id, input.language);
    });
    return this.auth.sessionFor(userId);
  }

  /** Buyer account: links the phone to a buyer business; the session then carries the buyer id. */
  async completeBuyer(userId: string, input: BuyerOnboardingInputT): Promise<Session> {
    const user = await this.repos.auth.findUserById(userId);
    if (!user) throw AppError.unauthorized();
    if (user.producerId || user.buyerId) throw AppError.conflict("ALREADY_ONBOARDED", "This account is already set up");
    await this.uow.run(async (repos) => {
      const buyer = await repos.market.createBuyer({ name: input.name, business: input.business, city: input.city, state: input.state, gstin: input.gstin ?? null, phone: user.phone });
      await repos.auth.linkBuyer(userId, buyer.id, input.language);
    });
    return this.auth.sessionFor(userId);
  }

  private createProducer(repos: Repositories, input: OnboardingInputT, phone: string, now: Date) {
    const slug = `${input.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "maker"}-${now.getTime().toString(36)}`;
    return repos.producers.create({
        slug, industryKey: input.industryKey, businessKind: input.businessKind, name: input.name, businessName: input.businessName,
        city: input.city, state: input.state, phone, gstScheme: input.gstScheme,
        gstin: input.gstScheme === "UNREGISTERED" ? null : input.gstin, udyamNumber: input.udyamNumber || null, upiId: input.upiId || null,
        language: input.language, machines: input.machines, story: "", onboardedAt: now,
        avatarColor: AVATAR_COLORS[Math.abs(hash(input.businessName)) % AVATAR_COLORS.length]!,
    });
  }

  private async createMaterials(repos: Repositories, producerId: string, input: OnboardingInputT): Promise<string[]> {
    const ids: string[] = [];
    for (const m of input.materials) {
      const supplier = m.supplier
        ? await repos.partners.createSupplier({ producerId, name: m.supplier.name, phone: m.supplier.phone, city: m.supplier.city, state: input.state, gstin: "", leadTimeDays: m.supplier.leadTimeDays })
        : null;
      const id = await repos.stock.createMaterial({
        producerId, supplierId: supplier?.id ?? null, name: m.name, nameHi: m.nameHi || m.name, unit: m.unit, hsn: m.hsn, gstRate: m.gstRate, costPerUnit: m.costPerUnit,
      });
      if (m.stock > 0) await repos.stock.moveMaterial({ producerId, materialId: id, kind: "ADJUST", qty: m.stock, source: "APP", note: "Opening stock" });
      ids.push(id);
    }
    return ids;
  }

  private async createProducts(repos: Repositories, producerId: string, input: OnboardingInputT, materialIds: string[]) {
    for (const [i, p] of input.products.entries()) {
      const id = await repos.stock.createProduct({
        producerId, slug: `${producerId.slice(-6)}-${i}-${Date.now().toString(36)}`, name: p.name, nameHi: p.nameHi || p.name,
        category: p.category || p.name, story: "", price: p.price, hsn: p.hsn, gstRate: p.gstRate,
        unitsPerMachinePerWeek: input.businessKind === "TRADER" ? 0 : p.unitsPerMachinePerWeek, palette: "#B4441F,#F4D9A6",
        recipe: input.businessKind === "TRADER" ? [] : p.recipe.map((r) => ({ materialId: materialIds[r.material]!, qtyPerUnit: r.qtyPerUnit })),
      });
      if (p.stock > 0) await repos.stock.moveProduct({ producerId, productId: id, kind: "ADJUST", qty: p.stock, source: "APP", note: "Opening stock" }, p.stock);
    }
  }
}

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}
