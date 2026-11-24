import { AppError } from "../../core/errors.js";
import type { Repositories } from "../../data/unit-of-work.js";
import { materialHealth, USAGE_WINDOW_DAYS, type MaterialHealth } from "../../engine/reorder.js";
import { addDays, shortDate, type Clock } from "../../shared/time.js";
import type { ProducerRepository } from "../producers/producer.repository.js";

export type ReorderMessage = { message: string; whatsappUrl: string; supplier: string; eta: string; qty: number; unit: string };

export class StockService {
  constructor(
    private readonly repos: Repositories,
    private readonly producers: ProducerRepository,
    private readonly clock: Clock,
  ) {}

  /** Raw materials with run-out prediction, most urgent first. */
  async health(producerId: string): Promise<MaterialHealth[]> {
    const now = this.clock.now();
    const usage = await this.repos.stock.materialsWithUsage(producerId, addDays(now, -USAGE_WINDOW_DAYS));
    const rank = { CRITICAL: 0, LOW: 1, OK: 2 } as const;
    return usage
      .map((m) => materialHealth(m, now))
      .sort((a, b) => rank[a.status] - rank[b.status] || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
  }

  products(producerId: string) {
    return this.repos.stock.products(producerId);
  }

  /** Draft a WhatsApp reorder to the material's supplier and record it as sent. */
  async reorder(producerId: string, materialId: string, qty: number): Promise<ReorderMessage> {
    const [material, producer] = await Promise.all([
      this.repos.stock.materialWithSupplier(producerId, materialId),
      this.producers.findProfile(producerId),
    ]);
    if (!material || !producer) throw AppError.notFound("Material");
    const supplier = material.supplier;
    if (!supplier) throw AppError.badRequest("NO_SUPPLIER", "Add a supplier for this material first");

    const message =
      `Namaste ${supplier.name} ji, ${producer.businessName} (${producer.city}) se order: ${qty} ${material.unit} ${material.name}. ` +
      `Kripya ${supplier.leadTimeDays} din mein bhejein. Dhanyavaad. (Sutra se bheja gaya)`;
    await this.repos.stock.createSupplierOrder({ producerId, supplierId: supplier.id, materialId, qty, message });
    await this.repos.alerts.markRead(producerId, undefined, "LOW_STOCK");

    const phone = supplier.phone.replace(/\D/g, "");
    return {
      message,
      whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
      supplier: supplier.name,
      eta: shortDate(addDays(this.clock.now(), supplier.leadTimeDays)),
      qty,
      unit: material.unit,
    };
  }
}
