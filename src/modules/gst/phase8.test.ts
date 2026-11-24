import { describe, expect, it } from "vitest";
import { ewayBillFields, ewayBillNeed } from "../../shared/gst/eway-bill.js";
import { matchSchemes } from "../schemes/scheme-rules.js";
import { normInvoice, parse2b, reconcile } from "./gstr2b.js";

const from = { gstin: "23RJVPK5073P1ZY", name: "Kushwaha Handloom", state: "Madhya Pradesh", city: "Chanderi" };

describe("e-way bill (X6)", () => {
  it("needed above ₹50,000", () => {
    expect(ewayBillNeed({ value: 50_001, from, to: { gstin: null, name: "B", state: "Karnataka" }, handicraft: true }).required).toBe(true);
    expect(ewayBillNeed({ value: 50_000, from, to: { gstin: null, name: "B", state: "Karnataka" }, handicraft: true }).required).toBe(false);
  });

  it("handicraft from an unregistered seller to another state needs one at any value", () => {
    const r = ewayBillNeed({ value: 2_000, from: { ...from, gstin: null }, to: { gstin: null, name: "B", state: "Karnataka" }, handicraft: true });
    expect(r.required).toBe(true);
    expect(r.reasonEn).toMatch(/any value/);
  });

  it("prefills Part A and B", () => {
    const f = ewayBillFields({
      docType: "TAX", docNo: "KH/26-27/0015", docDate: new Date("2026-11-24T06:00:00Z"), value: 196633.5, taxable: 187270, cgst: 0, sgst: 0, igst: 9363.5,
      gstRate: 5, hsn: "5007", item: "Saree", qty: 61, from, to: { gstin: null, name: "Kaveri", state: "Karnataka" }, lrNumber: "VRL 1", vehicleNo: "MP07AB1234", handicraft: true,
    });
    expect(f.partA.docDate).toBe("24/11/2026");
    expect(f.partA.toGstin).toBe("URP");
    expect(f.partB.vehicleNo).toBe("MP07AB1234");
  });
});

describe("GSTR-2B reconciliation (X7)", () => {
  const twoB = {
    data: {
      docdata: {
        b2b: [
          { ctin: "24AAPFG5512M1Z0", trdnm: "Shree Ganesh", inv: [{ inum: "SGY/1193", dt: "22-11-2026", items: [{ txval: 16950, igst: 847.5 }] }] },
          { ctin: "23AAACM1111A1Z5", trdnm: "Mahalaxmi", inv: [{ inum: "MZ-0042", dt: "10-11-2026", items: [{ txval: 18000, cgst: 400, sgst: 400 }] }, { inum: "MZ-99", dt: "12-11-2026", items: [{ txval: 1000, cgst: 25, sgst: 25 }] }] },
        ],
      },
    },
  };
  const books = [
    { supplierGstin: "24AAPFG5512M1Z0", supplierName: "Shree Ganesh", billNo: "sgy 1193", billDate: new Date(), taxable: 16950, tax: 847.5 },
    { supplierGstin: "23AAACM1111A1Z5", supplierName: "Mahalaxmi", billNo: "MZ-42", billDate: new Date(), taxable: 18000, tax: 900 },
    { supplierGstin: "27AAACS2222B1Z1", supplierName: "Surat Silk", billNo: "SS/7", billDate: new Date(), taxable: 5000, tax: 250 },
    { supplierGstin: null, supplierName: "Local", billNo: "x", billDate: new Date(), taxable: 100, tax: 0 },
  ];

  it("reads the portal's b2b section", () => {
    const d = parse2b(twoB);
    expect(d).toHaveLength(3);
    expect(d[1]!.tax).toBe(800);
  });

  it("invoice numbers match whatever their punctuation", () => {
    expect(normInvoice("SGY/1193")).toBe(normInvoice("sgy 1193"));
    expect(normInvoice("MZ-0042")).toBe(normInvoice("MZ-42"));
  });

  it("finds matched, short-filed, unfiled and unknown bills", () => {
    const r = reconcile(books, parse2b(twoB));
    const by = Object.fromEntries(r.rows.map((x) => [x.invoiceNo, x.status]));
    expect(by["sgy 1193"]).toBe("MATCHED");
    expect(by["MZ-42"]).toBe("AMOUNT_DIFF"); // books ₹900, supplier filed ₹800
    expect(by["SS/7"]).toBe("NOT_IN_2B");
    expect(by["MZ-99"]).toBe("NOT_IN_BOOKS");
    expect(r.totals.itcAtRisk).toBe(250 + 100);
    expect(r.totals.itcConfirmed).toBe(847.5 + 800);
  });
});

describe("scheme matcher (C6)", () => {
  const base = { industryKey: "handloom", businessKind: "MAKER" as const, gstScheme: "REGULAR" as const, udyam: false, fyTurnover: 1_000_000, inCluster: true, marks: [], machines: 6 };

  it("a weaver without Udyam is pointed to Udyam and handloom credit first", () => {
    const likely = matchSchemes(base).filter((s) => s.fit === "LIKELY").map((s) => s.key);
    expect(likely).toContain("udyam");
    expect(likely).toContain("handloom-credit");
    expect(likely).not.toContain("pm-vishwakarma");
  });

  it("a potter may qualify for PM Vishwakarma", () => {
    expect(matchSchemes({ ...base, industryKey: "pottery" }).find((s) => s.key === "pm-vishwakarma")!.fit).toBe("LIKELY");
  });
});
