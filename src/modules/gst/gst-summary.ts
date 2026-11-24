// The GST picture for a period, by scheme. Pure: callers load invoices and purchases, this decides.
// Figures are guidance for the producer and their CA — Sutra never files returns (RULES C1).
import { validateGstin } from "../../shared/gst/gstin.js";
import { inr, round2 } from "../../shared/money.js";
import type { GstSchemeKind } from "../../shared/gst/tax.js";
import type { Period } from "./gst-period.js";

/** Composition: 1% of turnover for manufacturers and traders (0.5% CGST + 0.5% SGST). */
export const COMPOSITION_RATE = 1;
export const COMPOSITION_LIMIT = 1_50_00_000;
/** Registration threshold for suppliers of goods (special-category states are lower). */
export const GOODS_THRESHOLD = 40_00_000;
export const SPECIAL_THRESHOLD = 20_00_000;
const SPECIAL_STATES = new Set(["Manipur", "Mizoram", "Nagaland", "Tripura"]);
const WATCH_SHARE = 0.8;

export type SaleRow = {
  number: string; kind: "TAX" | "BILL_OF_SUPPLY"; buyerName: string; buyerGstin: string | null; buyerState: string;
  hsn: string; gstRate: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; issuedAt: Date;
};
export type PurchaseRow = {
  billNo: string; supplierName: string; supplierGstin: string; gstinValid: boolean;
  taxable: number; cgst: number; sgst: number; igst: number; total: number; billDate: Date;
};

export type Issue = { kind: "BAD_SUPPLIER_GSTIN" | "BAD_BUYER_GSTIN" | "MISSING_HSN" | "INTERSTATE_UNREGISTERED" | "NEAR_LIMIT"; text: string; textHi: string; amount: number };

export type GstSummaryInput = {
  scheme: GstSchemeKind;
  state: string;
  period: Period;
  sales: SaleRow[];
  purchases: PurchaseRow[];
  /** Turnover so far this financial year (for thresholds). */
  fyTurnover: number;
};

const sum = <T>(xs: T[], f: (x: T) => number) => round2(xs.reduce((a, x) => a + f(x), 0));

export function gstSummary(input: GstSummaryInput) {
  const { scheme, sales, purchases, period } = input;
  const outputTax = { cgst: sum(sales, (s) => s.cgst), sgst: sum(sales, (s) => s.sgst), igst: sum(sales, (s) => s.igst) };
  const outputTotal = round2(outputTax.cgst + outputTax.sgst + outputTax.igst);

  const okBills = purchases.filter((p) => p.gstinValid && validateGstin(p.supplierGstin).valid);
  const badBills = purchases.filter((p) => !okBills.includes(p));
  const itc = { cgst: sum(okBills, (p) => p.cgst), sgst: sum(okBills, (p) => p.sgst), igst: sum(okBills, (p) => p.igst) };
  const itcTotal = round2(itc.cgst + itc.sgst + itc.igst);
  const atRisk = sum(badBills, (p) => p.cgst + p.sgst + p.igst);
  const turnover = sum(sales, (s) => s.taxable);
  const interState = sales.filter((s) => s.buyerState !== input.state);

  const issues: Issue[] = [
    ...badBills.map((p) => ({
      kind: "BAD_SUPPLIER_GSTIN" as const, amount: round2(p.cgst + p.sgst + p.igst),
      text: `${p.supplierName} bill ${p.billNo}: GSTIN ${p.supplierGstin || "(missing)"} failed the check — tax credit at risk`,
      textHi: `${p.supplierName} का बिल ${p.billNo}: GSTIN ${p.supplierGstin || "(नहीं)"} गलत — टैक्स क्रेडिट अटका`,
    })),
    ...sales.filter((s) => s.buyerGstin && !validateGstin(s.buyerGstin).valid).map((s) => ({
      kind: "BAD_BUYER_GSTIN" as const, amount: round2(s.cgst + s.sgst + s.igst),
      text: `Invoice ${s.number}: buyer GSTIN looks wrong`, textHi: `बिल ${s.number}: ख़रीदार का GSTIN गलत लगता है`,
    })),
    ...(scheme === "REGULAR"
      ? sales.filter((s) => s.buyerGstin && s.hsn.replace(/\D/g, "").length < 4).map((s) => ({
          kind: "MISSING_HSN" as const, amount: 0,
          text: `Invoice ${s.number}: B2B invoices need at least a 4-digit HSN`, textHi: `बिल ${s.number}: B2B बिल पर कम से कम 4 अंकों का HSN चाहिए`,
        }))
      : []),
  ];

  const base = {
    period: { kind: period.kind, key: period.key, label: period.label },
    scheme,
    sales: {
      count: sales.length, taxable: turnover, b2b: sales.filter((s) => s.buyerGstin).length,
      b2c: sales.filter((s) => !s.buyerGstin).length, interState: interState.length,
    },
    purchases: { count: purchases.length, taxable: sum(purchases, (p) => p.taxable) },
    fyTurnover: input.fyTurnover,
  };

  if (scheme === "REGULAR") {
    return {
      ...base, issues,
      outputTax: { ...outputTax, total: outputTotal },
      itc: { ...itc, total: itcTotal, atRisk, okBills: okBills.length, badBills: badBills.length },
      net: { payable: round2(Math.max(0, outputTotal - itcTotal)), carryForward: round2(Math.max(0, itcTotal - outputTotal)) },
      filing: period.kind === "MONTH"
        ? { en: "GSTR-1 by the 11th and GSTR-3B by the 20th of next month (monthly filers).", hi: "GSTR-1 अगले महीने की 11 तारीख़ तक, GSTR-3B 20 तक (मासिक)।" }
        : { en: "Quarterly (QRMP): GSTR-1 by the 13th, GSTR-3B by the 22nd/24th after the quarter.", hi: "तिमाही (QRMP): GSTR-1 13 तक, GSTR-3B 22/24 तक।" },
    };
  }

  if (scheme === "COMPOSITION") {
    const tax = round2((turnover * COMPOSITION_RATE) / 100);
    if (input.fyTurnover >= COMPOSITION_LIMIT * WATCH_SHARE) {
      issues.push({
        kind: "NEAR_LIMIT", amount: input.fyTurnover,
        text: `Turnover this year is ${inr(input.fyTurnover)}; the composition limit is ${inr(COMPOSITION_LIMIT)}. Talk to your CA about moving to regular GST.`,
        textHi: `इस साल की बिक्री ${inr(input.fyTurnover)} है; कंपोज़िशन की सीमा ${inr(COMPOSITION_LIMIT)} है। रेगुलर GST के बारे में CA से बात करें।`,
      });
    }
    return {
      ...base, issues,
      composition: { rate: COMPOSITION_RATE, tax, cgst: round2(tax / 2), sgst: round2(tax / 2), limit: COMPOSITION_LIMIT },
      filing: { en: "CMP-08 by the 18th after each quarter; GSTR-4 once a year.", hi: "हर तिमाही के बाद 18 तारीख़ तक CMP-08; साल में एक बार GSTR-4।" },
    };
  }

  // UNREGISTERED
  const threshold = SPECIAL_STATES.has(input.state) ? SPECIAL_THRESHOLD : GOODS_THRESHOLD;
  if (interState.length) {
    issues.push({
      kind: "INTERSTATE_UNREGISTERED", amount: sum(interState, (s) => s.taxable),
      text: "You sold to another state. Most sellers need GST registration for that (some handicraft goods are exempt but need an e-way bill). Check with a CA.",
      textHi: "आपने दूसरे राज्य में माल बेचा। इसके लिए आमतौर पर GST ज़रूरी है (कुछ हस्तशिल्प को छूट है, पर ई-वे बिल चाहिए)। CA से पूछें।",
    });
  }
  if (input.fyTurnover >= threshold * WATCH_SHARE) {
    issues.push({
      kind: "NEAR_LIMIT", amount: input.fyTurnover,
      text: `Turnover this year is ${inr(input.fyTurnover)}; registration is required above ${inr(threshold)}.`,
      textHi: `इस साल की बिक्री ${inr(input.fyTurnover)} है; ${inr(threshold)} से ऊपर GST लेना ज़रूरी है।`,
    });
  }
  return {
    ...base, issues,
    registration: { threshold, mustRegister: input.fyTurnover >= threshold || interState.length > 0 },
    filing: { en: "No GST returns while unregistered. Keep bills; they become your records if you register.", hi: "GST नहीं लिया है तो रिटर्न नहीं। बिल संभालकर रखें।" },
  };
}

export type GstSummary = ReturnType<typeof gstSummary>;
