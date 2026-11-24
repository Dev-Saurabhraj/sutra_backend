// Files for the CA: a plain CSV of the period, and a GSTR-1-style JSON (b2b + b2cs). Review before filing.
import { round2 } from "../../shared/money.js";
import { STATE_CODES } from "../../shared/gst/states.js";
import type { PurchaseRow, SaleRow } from "./gst-summary.js";

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (xs: (string | number | null | undefined)[]) => xs.map(cell).join(",");
const date = (d: Date) => d.toISOString().slice(0, 10);

export function gstCsv(meta: { business: string; gstin: string | null; period: string }, sales: SaleRow[], purchases: PurchaseRow[]): string {
  return [
    row(["Sutra GST export (review before filing)", meta.business, meta.gstin ?? "unregistered", meta.period]),
    "",
    row(["SALES", "Number", "Date", "Document", "Buyer", "Buyer GSTIN", "Place of supply", "HSN", "Taxable", "CGST", "SGST", "IGST", "Total"]),
    ...sales.map((s) => row(["", s.number, date(s.issuedAt), s.kind === "TAX" ? "Tax invoice" : "Bill of supply", s.buyerName, s.buyerGstin, s.buyerState, s.hsn, s.taxable, s.cgst, s.sgst, s.igst, s.total])),
    "",
    row(["PURCHASES", "Bill no", "Date", "Supplier", "Supplier GSTIN", "GSTIN valid", "Taxable", "CGST", "SGST", "IGST", "Total"]),
    ...purchases.map((p) => row(["", p.billNo, date(p.billDate), p.supplierName, p.supplierGstin, p.gstinValid ? "yes" : "NO", p.taxable, p.cgst, p.sgst, p.igst, p.total])),
  ].join("\r\n");
}

/** GSTR-1-style JSON (b2b grouped by buyer GSTIN, b2cs by place of supply and rate). Simplified; a CA reviews it. */
export function gstr1Json(gstin: string | null, fp: string, sales: SaleRow[]) {
  const b2b = new Map<string, { ctin: string; inv: unknown[] }>();
  const b2cs: Record<string, { pos: string; rt: number; txval: number; camt: number; samt: number; iamt: number }> = {};
  for (const s of sales.filter((x) => x.kind === "TAX")) {
    const pos = STATE_CODES[s.buyerState] ?? "";
    const rt = s.gstRate;
    if (s.buyerGstin) {
      const e = b2b.get(s.buyerGstin) ?? { ctin: s.buyerGstin, inv: [] };
      e.inv.push({
        inum: s.number, idt: date(s.issuedAt).split("-").reverse().join("-"), val: s.total, pos, rchrg: "N", inv_typ: "R",
        itms: [{ num: 1, itm_det: { rt, txval: s.taxable, camt: s.cgst, samt: s.sgst, iamt: s.igst, csamt: 0 } }],
      });
      b2b.set(s.buyerGstin, e);
    } else {
      const k = `${pos}-${rt}`;
      const e = (b2cs[k] ??= { pos, rt, txval: 0, camt: 0, samt: 0, iamt: 0 });
      e.txval = round2(e.txval + s.taxable);
      e.camt = round2(e.camt + s.cgst);
      e.samt = round2(e.samt + s.sgst);
      e.iamt = round2(e.iamt + s.igst);
    }
  }
  return {
    gstin, fp, generated_by: "Sutra (review before filing)",
    b2b: [...b2b.values()],
    b2cs: Object.values(b2cs).map((x) => ({ sply_ty: x.iamt ? "INTER" : "INTRA", typ: "OE", ...x, csamt: 0 })),
  };
}
