import type { InvoiceKind } from "@prisma/client";
import { num, type DbClient } from "../../core/db.js";

export type InvoiceRecord = {
  id: string;
  number: string;
  financialYear: string;
  kind: InvoiceKind;
  orderId: string | null;
  buyerName: string;
  buyerGstin: string | null;
  buyerState: string;
  itemName: string;
  hsn: string;
  qty: number;
  rate: number;
  taxable: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  issuedAt: Date;
};

export type NewInvoice = Omit<InvoiceRecord, "id" | "issuedAt"> & { producerId: string; issuedAt?: Date };

export class InvoiceRepository {
  constructor(private readonly db: DbClient) {}

  async create(data: NewInvoice): Promise<InvoiceRecord> {
    return toRecord(await this.db.invoice.create({ data }));
  }

  async list(producerId: string, take: number): Promise<InvoiceRecord[]> {
    const rows = await this.db.invoice.findMany({ where: { producerId }, orderBy: { issuedAt: "desc" }, take });
    return rows.map(toRecord);
  }

  async find(producerId: string, id: string): Promise<InvoiceRecord | null> {
    const row = await this.db.invoice.findFirst({ where: { id, producerId } });
    return row ? toRecord(row) : null;
  }

  /** An invoice on one of this buyer's orders, with the seller it belongs to (buyers read, never write). */
  async findForBuyer(buyerId: string, id: string): Promise<(InvoiceRecord & { producerId: string }) | null> {
    const row = await this.db.invoice.findFirst({ where: { id, order: { buyerId } } });
    return row ? { ...toRecord(row), producerId: row.producerId } : null;
  }

  /** Taxable sales (tax invoices + bills of supply) since a date. */
  async salesSince(producerId: string, since: Date): Promise<{ taxable: number; count: number }> {
    const agg = await this.db.invoice.aggregate({
      where: { producerId, kind: { in: ["TAX", "BILL_OF_SUPPLY"] }, issuedAt: { gte: since } },
      _sum: { taxable: true },
      _count: true,
    });
    return { taxable: num(agg._sum.taxable), count: agg._count };
  }
}

function toRecord(r: {
  id: string; number: string; financialYear: string; kind: InvoiceKind; orderId: string | null; buyerName: string;
  buyerGstin: string | null; buyerState: string; itemName: string; hsn: string; qty: unknown; rate: unknown;
  taxable: unknown; gstRate: unknown; cgst: unknown; sgst: unknown; igst: unknown; total: unknown; issuedAt: Date;
}): InvoiceRecord {
  return {
    id: r.id, number: r.number, financialYear: r.financialYear, kind: r.kind, orderId: r.orderId, buyerName: r.buyerName,
    buyerGstin: r.buyerGstin, buyerState: r.buyerState, itemName: r.itemName, hsn: r.hsn, qty: Number(r.qty),
    rate: Number(r.rate), taxable: Number(r.taxable), gstRate: Number(r.gstRate), cgst: Number(r.cgst),
    sgst: Number(r.sgst), igst: Number(r.igst), total: Number(r.total), issuedAt: r.issuedAt,
  };
}
