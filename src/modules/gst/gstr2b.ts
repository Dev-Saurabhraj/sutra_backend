// GSTR-2B reconciliation (X7). Pure: compare the purchase bills in the books with what suppliers actually filed.
// Credit (ITC) can be claimed only for bills that appear in GSTR-2B (CGST s.16(2)(aa)); the rest is at risk.

import { round2 } from "../../shared/money.js";

export type TwoBDoc = { gstin: string; name: string; invoiceNo: string; date: string; taxable: number; tax: number; itcAvailable: boolean };
export type BookBill = { supplierGstin: string | null; supplierName: string; billNo: string; billDate: Date; taxable: number; tax: number };

export type MatchStatus = "MATCHED" | "AMOUNT_DIFF" | "NOT_IN_2B" | "NOT_IN_BOOKS";
export type MatchRow = {
  status: MatchStatus;
  gstin: string;
  supplier: string;
  invoiceNo: string;
  booksTax: number | null;
  filedTax: number | null;
  diff: number;
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

/** Reads the b2b section of a GSTR-2B JSON as downloaded from the GST portal (tolerant of wrappers). */
export function parse2b(json: unknown): TwoBDoc[] {
  const root = json as { data?: { docdata?: { b2b?: unknown[] } }; docdata?: { b2b?: unknown[] }; b2b?: unknown[] };
  const b2b = (root?.data?.docdata?.b2b ?? root?.docdata?.b2b ?? root?.b2b ?? []) as {
    ctin?: string; trdnm?: string; inv?: { inum?: string; dt?: string; itcavl?: string; items?: { txval?: number; igst?: number; cgst?: number; sgst?: number; cess?: number }[] }[];
  }[];
  const out: TwoBDoc[] = [];
  for (const s of b2b) {
    for (const inv of s.inv ?? []) {
      const items = inv.items ?? [];
      out.push({
        gstin: (s.ctin ?? "").toUpperCase(),
        name: s.trdnm ?? "",
        invoiceNo: inv.inum ?? "",
        date: inv.dt ?? "",
        taxable: round2(items.reduce((a, x) => a + num(x.txval), 0)),
        tax: round2(items.reduce((a, x) => a + num(x.igst) + num(x.cgst) + num(x.sgst) + num(x.cess), 0)),
        itcAvailable: (inv.itcavl ?? "Y").toUpperCase() !== "N",
      });
    }
  }
  return out;
}

/** "SGY/1193" = "sgy 1193", and "MZ-0042" = "MZ-42": punctuation, case and zero-padding of numbers don't matter. */
export const normInvoice = (s: string) =>
  (s.toUpperCase().match(/[A-Z]+|\d+/g) ?? []).map((t) => t.replace(/^0+(?=\d)/, "")).join("");

/** A difference within ₹1 is rounding. */
const TOLERANCE = 1;

export function reconcile(books: BookBill[], filed: TwoBDoc[]) {
  const key = (gstin: string, inv: string) => `${gstin.toUpperCase()}|${normInvoice(inv)}`;
  const filedBy = new Map(filed.map((d) => [key(d.gstin, d.invoiceNo), d]));
  const used = new Set<string>();
  const rows: MatchRow[] = [];
  for (const b of books) {
    if (!b.supplierGstin) continue; // unregistered supplier: no ITC anyway
    const k = key(b.supplierGstin, b.billNo);
    const d = filedBy.get(k);
    if (!d) {
      rows.push({ status: "NOT_IN_2B", gstin: b.supplierGstin, supplier: b.supplierName, invoiceNo: b.billNo, booksTax: b.tax, filedTax: null, diff: round2(b.tax) });
      continue;
    }
    used.add(k);
    const diff = round2(b.tax - d.tax);
    rows.push({
      status: Math.abs(diff) <= TOLERANCE ? "MATCHED" : "AMOUNT_DIFF",
      gstin: d.gstin, supplier: b.supplierName, invoiceNo: b.billNo, booksTax: b.tax, filedTax: d.tax, diff,
    });
  }
  for (const d of filed) {
    if (!used.has(key(d.gstin, d.invoiceNo))) {
      rows.push({ status: "NOT_IN_BOOKS", gstin: d.gstin, supplier: d.name, invoiceNo: d.invoiceNo, booksTax: null, filedTax: d.tax, diff: round2(-d.tax) });
    }
  }
  const sum = (s: MatchStatus, f: (r: MatchRow) => number) => round2(rows.filter((r) => r.status === s).reduce((a, r) => a + f(r), 0));
  const order: Record<MatchStatus, number> = { NOT_IN_2B: 0, AMOUNT_DIFF: 1, NOT_IN_BOOKS: 2, MATCHED: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status]);
  return {
    rows,
    totals: {
      matched: rows.filter((r) => r.status === "MATCHED").length,
      itcConfirmed: round2(sum("MATCHED", (r) => r.booksTax ?? 0) + sum("AMOUNT_DIFF", (r) => Math.min(r.booksTax ?? 0, r.filedTax ?? 0))),
      itcAtRisk: round2(sum("NOT_IN_2B", (r) => r.booksTax ?? 0) + sum("AMOUNT_DIFF", (r) => Math.max(0, r.diff))),
      notInBooks: sum("NOT_IN_BOOKS", (r) => r.filedTax ?? 0),
    },
  };
}
