// Invoice finance (X8). Pure: which unpaid invoices could be paid early through TReDS, and roughly what it costs.
// TReDS (RBI-licensed: RXIL, M1xchange, Invoicemart) discounts invoices of MSME sellers raised on registered
// buyers; the buyer must also be on the platform. The rate is set by financiers' bids: the cost here is an estimate.

import { round2 } from "../../shared/money.js";

export const ASSUMED_ANNUAL_RATE = 0.11;
const DAY = 86_400_000;

export type OpenInvoice = { id: string; party: string; invoiceNo: string | null; amount: number; dueDate: Date | null; buyerGstin: string | null };

export type EarlyPayRow = OpenInvoice & {
  fit: "LIKELY" | "CHECK" | "NO";
  reasonEn: string;
  reasonHi: string;
  daysEarly: number;
  estCost: number;
  youGet: number;
};

export function earlyPay(invoices: OpenInvoice[], msme: boolean, now: Date, rate = ASSUMED_ANNUAL_RATE): EarlyPayRow[] {
  return invoices.map((i) => {
    const daysEarly = i.dueDate ? Math.max(0, Math.ceil((i.dueDate.getTime() - now.getTime()) / DAY)) : 30;
    const estCost = round2((i.amount * rate * daysEarly) / 365);
    const base = { ...i, daysEarly, estCost, youGet: round2(i.amount - estCost) };
    if (!msme) return { ...base, fit: "NO" as const, reasonEn: "TReDS is for MSMEs: register on Udyam first", reasonHi: "TReDS MSME के लिए है: पहले उद्यम रजिस्ट्रेशन करें" };
    if (!i.invoiceNo) return { ...base, fit: "NO" as const, reasonEn: "Needs a GST invoice", reasonHi: "GST बिल होना चाहिए" };
    if (!i.buyerGstin) return { ...base, fit: "NO" as const, reasonEn: "Only invoices on registered business buyers", reasonHi: "सिर्फ़ GST वाले कारोबारी ख़रीदार के बिल" };
    if (daysEarly === 0) return { ...base, fit: "CHECK" as const, reasonEn: "Already due: ask the buyer to pay (MSME 45-day rule)", reasonHi: "देय हो चुका: ख़रीदार से भुगतान माँगें (MSME 45 दिन नियम)" };
    return { ...base, fit: "CHECK" as const, reasonEn: "Possible if the buyer is on a TReDS platform", reasonHi: "अगर ख़रीदार TReDS पर है तो हो सकता है" };
  });
}

export const TREDS_PLATFORMS = [
  { name: "RXIL", link: "https://www.rxil.in" },
  { name: "M1xchange", link: "https://www.m1xchange.com" },
  { name: "Invoicemart", link: "https://www.invoicemart.com" },
];
