// Tax split and document-type rules. Pure functions; see docs/RULES.md §C1.
import { round2 } from "../money.js";

export type TaxSplit = { taxable: number; cgst: number; sgst: number; igst: number; total: number };

/** Intra-state supply → CGST + SGST. Inter-state → IGST. */
export function splitTax(taxable: number, ratePct: number, sellerState: string, buyerState: string): TaxSplit {
  const tax = round2((taxable * ratePct) / 100);
  if (sellerState === buyerState) {
    const half = round2(tax / 2);
    return { taxable: round2(taxable), cgst: half, sgst: half, igst: 0, total: round2(taxable + half * 2) };
  }
  return { taxable: round2(taxable), cgst: 0, sgst: 0, igst: tax, total: round2(taxable + tax) };
}

/** A supply with no tax charged (Bill of Supply). */
export const noTax = (taxable: number): TaxSplit => ({ taxable: round2(taxable), cgst: 0, sgst: 0, igst: 0, total: round2(taxable) });

export type GstSchemeKind = "REGULAR" | "COMPOSITION" | "UNREGISTERED";
export type SaleDocument = "TAX" | "BILL_OF_SUPPLY";

export type SaleDecision =
  | { allowed: true; document: SaleDocument; chargesTax: boolean }
  | { allowed: false; reasonEn: string; reasonHi: string };

/**
 * Which document a producer may issue for a sale (RULES C1):
 * - REGULAR      → tax invoice, intra- or inter-state.
 * - COMPOSITION  → bill of supply, no tax, intra-state only.
 * - UNREGISTERED → bill of supply, no tax; inter-state allowed only for exempt handicraft sellers (needs e-way bill).
 */
export function decideSaleDocument(scheme: GstSchemeKind, sellerState: string, buyerState: string): SaleDecision {
  const interState = sellerState !== buyerState;
  switch (scheme) {
    case "REGULAR":
      return { allowed: true, document: "TAX", chargesTax: true };
    case "COMPOSITION":
      return interState
        ? {
            allowed: false,
            reasonEn: "Composition scheme sellers cannot sell to another state. Sell within your state, or move to the regular scheme.",
            reasonHi: "कंपोज़िशन स्कीम में दूसरे राज्य में माल नहीं बेच सकते। अपने राज्य में बेचें या रेगुलर GST लें।",
          }
        : { allowed: true, document: "BILL_OF_SUPPLY", chargesTax: false };
    case "UNREGISTERED":
      return { allowed: true, document: "BILL_OF_SUPPLY", chargesTax: false };
  }
}
