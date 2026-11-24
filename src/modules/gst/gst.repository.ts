import { num, type DbClient } from "../../core/db.js";
import type { PurchaseRow, SaleRow } from "./gst-summary.js";

/** Read-only access to the sales and purchase records GST reports are built from. */
export class GstRepository {
  constructor(private readonly db: DbClient) {}

  async sales(producerId: string, from: Date, to: Date): Promise<SaleRow[]> {
    const rows = await this.db.invoice.findMany({
      where: { producerId, kind: { in: ["TAX", "BILL_OF_SUPPLY"] }, issuedAt: { gte: from, lt: to } },
      orderBy: { issuedAt: "asc" },
    });
    return rows.map((i) => ({
      number: i.number, kind: i.kind as SaleRow["kind"], buyerName: i.buyerName, buyerGstin: i.buyerGstin, buyerState: i.buyerState,
      hsn: i.hsn, gstRate: num(i.gstRate), taxable: num(i.taxable), cgst: num(i.cgst), sgst: num(i.sgst), igst: num(i.igst), total: num(i.total), issuedAt: i.issuedAt,
    }));
  }

  async purchases(producerId: string, from: Date, to: Date): Promise<PurchaseRow[]> {
    const rows = await this.db.purchase.findMany({
      where: { producerId, billDate: { gte: from, lt: to } },
      include: { supplier: { select: { name: true, gstin: true } } },
      orderBy: { billDate: "asc" },
    });
    return rows.map((p) => ({
      billNo: p.billNo, supplierName: p.supplier.name, supplierGstin: p.supplier.gstin, gstinValid: p.gstinValid,
      taxable: num(p.taxable), cgst: num(p.cgst), sgst: num(p.sgst), igst: num(p.igst), total: num(p.total), billDate: p.billDate,
    }));
  }

  async turnoverSince(producerId: string, from: Date): Promise<number> {
    const agg = await this.db.invoice.aggregate({
      where: { producerId, kind: { in: ["TAX", "BILL_OF_SUPPLY"] }, issuedAt: { gte: from } },
      _sum: { taxable: true },
    });
    return num(agg._sum.taxable);
  }
}
