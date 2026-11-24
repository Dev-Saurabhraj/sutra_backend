import type { Prisma } from "@prisma/client";
import { AppError } from "../../core/errors.js";
import type { PriceWatch } from "../stock/price-watch.js";
import type { FileStore } from "../../core/file-store.js";
import type { Repositories, UnitOfWork } from "../../data/unit-of-work.js";
import { inr, round2 } from "../../shared/money.js";
import { addDays, type Clock } from "../../shared/time.js";
import type { ProducerProfile } from "../producers/producer.repository.js";
import { checkBill } from "./bill-checks.js";
import { BillSchema, type Bill, type BillImage, type BillReader } from "./bill-reader.js";
import { sampleList } from "./sample-bills.js";

const PAYMENT_TERMS_DAYS = 15;
const DEFAULT_LEAD_DAYS = 7;

/**
 * Snap a bill, in two steps (RULES B2 — AI drafts, people decide):
 * 1. scan: read the photo, check GSTIN and arithmetic, match items to materials, keep the photo.
 * 2. confirm: stock in, GST purchase with input tax credit, money to pay — once, in one transaction.
 */
export class BillService {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly reader: BillReader,
    private readonly files: FileStore,
    private readonly clock: Clock,
    private readonly aiEnabled: boolean,
    private readonly prices: PriceWatch,
  ) {}

  samples() {
    return { aiEnabled: this.aiEnabled, samples: sampleList() };
  }

  async scan(producerId: string, input: { image?: BillImage; sampleKey?: string }) {
    const producer = await this.producer(producerId);
    if (!input.image && !input.sampleKey) throw AppError.badRequest("NO_PHOTO", "Take a photo of the bill");
    if (input.image && !this.aiEnabled) {
      throw new AppError(422, "AI_OFF", "Reading photos needs the AI to be switched on. Try a sample bill.", {
        hi: "फ़ोटो पढ़ने के लिए AI चालू नहीं है। नमूना बिल आज़माएँ।",
      });
    }
    const materials = await this.repos.stock.materialBrief(producerId);
    const read = await this.reader.read(
      { image: input.image ?? null, sampleKey: input.sampleKey ?? null, producerState: producer.state },
      materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit })),
    );
    if (!read) {
      throw new AppError(422, "NOT_READABLE", "Could not read this bill. Take a clearer photo in good light.", {
        hi: "बिल पढ़ा नहीं गया। रोशनी में साफ़ फ़ोटो लें।",
      });
    }
    const imagePath = input.image ? await this.files.save(`bills-${producerId}`, Buffer.from(input.image.base64, "base64"), input.image.mediaType.split("/")[1] ?? "jpg") : null;
    const scan = await this.repos.bills.create({
      producerId, imagePath, sampleKey: input.sampleKey ?? null, parsed: read.bill as unknown as Prisma.InputJsonValue, parser: read.parser,
    });
    const supplier = await this.findSupplier(producerId, read.bill);
    return {
      scanId: scan.id,
      parser: read.parser,
      bill: read.bill,
      checks: checkBill(read.bill),
      supplier: supplier ? { known: true, id: supplier.id, name: supplier.name } : { known: false, id: null, name: read.bill.supplierName },
      materials,
    };
  }

  /** Save the scanned bill. `materialIds` lets the user fix which material each line is (null = skip that line). */
  async confirm(producerId: string, scanId: string, materialIds?: (string | null)[]) {
    const producer = await this.producer(producerId);
    const now = this.clock.now();
    return this.uow.run(async (repos) => {
      const scan = await repos.bills.find(producerId, scanId);
      if (!scan) throw AppError.notFound("Bill");
      if (!(await repos.bills.claim(producerId, scanId, now))) throw AppError.conflict("ALREADY_SAVED", "This bill was already saved");

      const bill = BillSchema.parse(scan.parsed);
      const owned = new Set((await repos.stock.materialBrief(producerId)).map((m) => m.id));
      const lines = bill.items
        .map((item, i) => ({ ...item, materialId: (materialIds ? materialIds[i] : item.materialId) || "" }))
        .filter((l) => l.materialId && l.qty > 0);
      if (lines.some((l) => !owned.has(l.materialId))) throw AppError.badRequest("BAD_MATERIAL", "A line points to a material you don't have");
      if (!lines.length) throw AppError.badRequest("NOTHING_TO_SAVE", "Choose which material each line is");

      const checks = checkBill(bill);
      const supplier = await this.supplierFor(repos, producer, bill, checks.gstin.state);
      const purchase = await repos.stock.createPurchase({
        producerId, supplierId: supplier.id, billNo: bill.billNo || "-", billDate: parseDate(bill.billDate, now),
        taxable: bill.taxable, cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst, total: bill.total, gstinValid: checks.gstin.valid,
        source: "BILL", aiModel: scan.parser.startsWith("ai:") ? scan.parser.slice(3) : null,
        items: lines.map((l) => ({ materialId: l.materialId, qty: l.qty, rate: l.rate, amount: round2(l.qty * l.rate) })),
      });

      const updated = [];
      for (const l of lines) {
        const stock = await repos.stock.moveMaterial({ producerId, materialId: l.materialId, kind: "PURCHASE", qty: l.qty, source: "BILL", note: bill.billNo });
        await this.prices.check(repos, producerId, l.materialId, l.rate, supplier.name);
        await repos.stock.setMaterialCost(l.materialId, l.rate);
        await repos.stock.markSupplierOrdersReceived(l.materialId);
        const m = await repos.stock.materialWithSupplier(producerId, l.materialId);
        updated.push({ name: m!.name, nameHi: m!.nameHi, unit: m!.unit, qty: l.qty, stock });
      }
      await repos.khata.create({
        producerId, party: supplier.name, direction: "PAY", amount: bill.total, note: `Bill ${bill.billNo}`, dueDate: addDays(now, PAYMENT_TERMS_DAYS),
      });
      await repos.alerts.markRead(producerId, undefined, "LOW_STOCK");
      if (checks.itcAtRisk) {
        await repos.alerts.create({
          producerId, kind: "GST", route: "/gst",
          title: `Check GSTIN on ${supplier.name} bill`,
          titleHi: `${supplier.name} के बिल का GSTIN जाँचें`,
          body: `GSTIN ${bill.supplierGstin || "(none)"} failed the check. Input tax credit of ${inr(checks.itc)} is at risk until the supplier corrects it.`,
          bodyHi: `GSTIN ${bill.supplierGstin || "(नहीं)"} गलत लग रहा है। सप्लायर से सही करवाएँ, वरना ${inr(checks.itc)} का टैक्स क्रेडिट नहीं मिलेगा।`,
        });
      }
      await repos.bills.linkPurchase(scanId, purchase.id);
      return { purchaseId: purchase.id, supplier: supplier.name, updated, itc: checks.itc, itcAtRisk: checks.itcAtRisk };
    });
  }

  private async findSupplier(producerId: string, bill: Bill) {
    const byGstin = await this.repos.partners.supplierByGstin(bill.supplierGstin);
    if (byGstin) return byGstin;
    const name = bill.supplierName.trim().toLowerCase();
    return (await this.repos.partners.suppliers(producerId)).find((s) => s.name.trim().toLowerCase() === name) ?? null;
  }

  /** The bill's supplier, created as the producer's own supplier the first time they appear. */
  private async supplierFor(repos: Repositories, producer: ProducerProfile, bill: Bill, gstinState?: string) {
    const existing = (await repos.partners.supplierByGstin(bill.supplierGstin)) ??
      (await repos.partners.suppliers(producer.id)).find((s) => s.name.trim().toLowerCase() === bill.supplierName.trim().toLowerCase());
    if (existing) return existing;
    return repos.partners.createSupplier({
      producerId: producer.id, name: bill.supplierName || "Supplier", phone: "", city: "", state: gstinState ?? producer.state,
      gstin: (bill.supplierGstin ?? "").toUpperCase(), leadTimeDays: DEFAULT_LEAD_DAYS,
    });
  }

  private async producer(producerId: string): Promise<ProducerProfile> {
    const p = await this.repos.producers.findProfile(producerId);
    if (!p) throw AppError.notFound("Producer");
    return p;
  }
}

function parseDate(s: string, fallback: Date): Date {
  const d = new Date(`${s}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}
