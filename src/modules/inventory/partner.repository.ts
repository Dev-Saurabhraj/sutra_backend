import type { DbClient } from "../../core/db.js";

export type SupplierRow = { id: string; name: string; phone: string; city: string; state: string; gstin: string; leadTimeDays: number };
export type ClientRow = { id: string; name: string; business: string; phone: string; city: string; state: string; gstin: string | null };

/** Suppliers (raw material comes from) and clients (finished goods go to). */
export class PartnerRepository {
  constructor(private readonly db: DbClient) {}

  /** The producer's own suppliers plus any supplier already linked to their materials. */
  suppliers(producerId: string): Promise<SupplierRow[]> {
    return this.db.supplier.findMany({
      where: { OR: [{ producerId }, { materials: { some: { producerId } } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true, city: true, state: true, gstin: true, leadTimeDays: true },
    });
  }

  async supplier(producerId: string, id: string): Promise<SupplierRow | null> {
    return (await this.suppliers(producerId)).find((s) => s.id === id) ?? null;
  }

  createSupplier(data: { producerId: string; name: string; phone: string; city: string; state: string; gstin: string; leadTimeDays: number }): Promise<SupplierRow> {
    return this.db.supplier.create({ data, select: { id: true, name: true, phone: true, city: true, state: true, gstin: true, leadTimeDays: true } });
  }

  /** The producer's own clients plus buyers who have ordered from them. */
  clients(producerId: string): Promise<ClientRow[]> {
    return this.db.buyer.findMany({
      where: { OR: [{ producerId }, { orders: { some: { producerId } } }] },
      orderBy: { business: "asc" },
      select: { id: true, name: true, business: true, phone: true, city: true, state: true, gstin: true },
    });
  }

  async client(producerId: string, id: string): Promise<ClientRow | null> {
    return (await this.clients(producerId)).find((c) => c.id === id) ?? null;
  }

  createClient(data: { producerId: string; name: string; business: string; phone: string; city: string; state: string; gstin: string | null }): Promise<ClientRow> {
    return this.db.buyer.create({ data, select: { id: true, name: true, business: true, phone: true, city: true, state: true, gstin: true } });
  }
}
