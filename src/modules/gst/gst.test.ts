import { describe, expect, it } from "vitest";
import { makeGstin } from "../../shared/gst/gstin.js";
import { numberToIndianWords, rupeesInWords } from "../../shared/money-words.js";
import { checkBill } from "../bills/bill-checks.js";
import { gstCsv, gstr1Json } from "./gst-export.js";
import { currentQuarterKey, monthPeriod, quarterPeriod } from "./gst-period.js";
import { gstSummary, type PurchaseRow, type SaleRow } from "./gst-summary.js";

const MP = "Madhya Pradesh";
const goodSupplier = makeGstin("Gujarat", "AAMFM4821Q");
const buyerGstin = makeGstin("Rajasthan", "AABCN1234F");
const at = new Date("2026-11-10T06:00:00Z");

const sale = (o: Partial<SaleRow> = {}): SaleRow => ({
  number: "KH/26-27/0001", kind: "TAX", buyerName: "Neel Textiles", buyerGstin, buyerState: "Rajasthan", hsn: "5007", gstRate: 5,
  taxable: 10000, cgst: 0, sgst: 0, igst: 500, total: 10500, issuedAt: at, ...o,
});
const purchase = (o: Partial<PurchaseRow> = {}): PurchaseRow => ({
  billNo: "MZW/1", supplierName: "Mahalaxmi Zari Works", supplierGstin: goodSupplier, gstinValid: true,
  taxable: 4000, cgst: 0, sgst: 0, igst: 200, total: 4200, billDate: at, ...o,
});

describe("amount in words (Indian system)", () => {
  it("uses thousand, lakh and crore", () => {
    expect(numberToIndianWords(12894)).toBe("Twelve Thousand Eight Hundred Ninety-Four");
    expect(numberToIndianWords(1_24_600)).toBe("One Lakh Twenty-Four Thousand Six Hundred");
    expect(numberToIndianWords(2_05_00_017)).toBe("Two Crore Five Lakh Seventeen");
  });
  it("adds paise and 'Only'", () => {
    expect(rupeesInWords(12894.5)).toBe("Rupees Twelve Thousand Eight Hundred Ninety-Four and Fifty Paise Only");
    expect(rupeesInWords(0)).toBe("Rupees Zero Only");
  });
});

describe("GST periods (IST, financial-year quarters)", () => {
  it("quarter 3 of FY 2026-27 is Oct–Dec 2026", () => {
    const q = quarterPeriod("2026-Q3");
    expect(q.from.toISOString()).toBe("2026-09-30T18:30:00.000Z"); // 1 Oct 00:00 IST
    expect(q.to.toISOString()).toBe("2026-12-31T18:30:00.000Z");
    expect(quarterPeriod("2026-Q4").from.toISOString()).toBe("2026-12-31T18:30:00.000Z"); // Jan–Mar 2027
  });
  it("months and the current quarter", () => {
    expect(monthPeriod("2026-11").label).toBe("Nov 2026");
    expect(currentQuarterKey(new Date("2027-02-10T00:00:00Z"))).toBe("2026-Q4");
  });
});

describe("GST summary", () => {
  const period = monthPeriod("2026-11");

  it("regular: output tax minus valid input credit; a bad supplier GSTIN puts credit at risk", () => {
    const bad = purchase({ billNo: "SGY/1193", supplierGstin: "24AAPFG5512M1Z0", gstinValid: false, igst: 150, total: 3150 });
    const s = gstSummary({ scheme: "REGULAR", state: MP, period, sales: [sale()], purchases: [purchase(), bad], fyTurnover: 10000 });
    if (!("net" in s)) throw new Error("expected regular summary");
    expect(s.outputTax.total).toBe(500);
    expect(s.itc.total).toBe(200);
    expect(s.itc.atRisk).toBe(150);
    expect(s.net.payable).toBe(300);
    expect(s.issues.map((i) => i.kind)).toEqual(["BAD_SUPPLIER_GSTIN"]);
  });

  it("regular: flags B2B invoices without a 4-digit HSN", () => {
    const s = gstSummary({ scheme: "REGULAR", state: MP, period, sales: [sale({ hsn: "" })], purchases: [], fyTurnover: 0 });
    expect(s.issues.some((i) => i.kind === "MISSING_HSN")).toBe(true);
  });

  it("composition: 1% of turnover, split CGST/SGST", () => {
    const s = gstSummary({ scheme: "COMPOSITION", state: MP, period, sales: [sale({ kind: "BILL_OF_SUPPLY", buyerState: MP, igst: 0, total: 10000 })], purchases: [], fyTurnover: 10000 });
    if (!("composition" in s)) throw new Error("expected composition summary");
    expect(s.composition).toMatchObject({ tax: 100, cgst: 50, sgst: 50 });
  });

  it("unregistered: warns about inter-state sales and the registration threshold", () => {
    const s = gstSummary({ scheme: "UNREGISTERED", state: MP, period, sales: [sale({ kind: "BILL_OF_SUPPLY", buyerGstin: null, igst: 0 })], purchases: [], fyTurnover: 35_00_000 });
    if (!("registration" in s)) throw new Error("expected unregistered summary");
    expect(s.registration.mustRegister).toBe(true);
    expect(s.issues.map((i) => i.kind).sort()).toEqual(["INTERSTATE_UNREGISTERED", "NEAR_LIMIT"]);
  });
});

describe("exports for the CA", () => {
  it("CSV escapes commas and lists both sides", () => {
    const csv = gstCsv({ business: "Kushwaha Handloom", gstin: null, period: "Nov 2026" }, [sale({ buyerName: "Kaveri Boutique, Bengaluru" })], [purchase()]);
    expect(csv).toContain('"Kaveri Boutique, Bengaluru"');
    expect(csv).toContain("PURCHASES");
  });
  it("GSTR-1 JSON groups B2B by buyer GSTIN and B2C by place of supply", () => {
    const j = gstr1Json("23AAAAA0000A1Z5", "112026", [sale(), sale({ number: "KH/26-27/0002", buyerGstin: null, buyerState: MP, igst: 0, cgst: 250, sgst: 250 })]);
    expect(j.b2b).toHaveLength(1);
    expect(j.b2cs[0]).toMatchObject({ pos: "23", rt: 5, txval: 10000, sply_ty: "INTRA" });
  });
});

describe("bill checks", () => {
  it("catches arithmetic that doesn't add up and an invalid GSTIN", () => {
    const bill = {
      supplierName: "X", supplierGstin: "24AAPFG5512M1Z0", billNo: "1", billDate: "2026-11-24",
      items: [{ description: "silk", materialId: "", hsn: "5004", qty: 3, unit: "kg", rate: 5650 }],
      taxable: 16950, cgst: 0, sgst: 0, igst: 847.5, total: 17900,
    };
    const c = checkBill(bill);
    expect(c.mathOk).toBe(false); // 16950 + 847.5 ≠ 17900
    expect(c.itcAtRisk).toBe(true);
    expect(c.unmatchedItems).toBe(1);
    expect(checkBill({ ...bill, total: 17797.5, supplierGstin: goodSupplier }).mathOk).toBe(true);
  });
});
