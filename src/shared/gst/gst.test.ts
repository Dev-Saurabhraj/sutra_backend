import { describe, expect, it } from "vitest";
import { makeGstin, validateGstin } from "./gstin.js";
import { decideSaleDocument, splitTax } from "./tax.js";
import { businessPrefix, financialYear, invoiceNumber } from "./financial-year.js";

describe("GSTIN", () => {
  it("accepts a valid GSTIN and finds the state", () => {
    const g = makeGstin("Madhya Pradesh", "AABCB7310K");
    expect(validateGstin(g)).toEqual({ valid: true, state: "Madhya Pradesh" });
  });

  it("catches a one-character typo through the check digit", () => {
    const g = makeGstin("Gujarat", "AAPFG5512M");
    const typo = g.slice(0, 9) + (g[9] === "3" ? "8" : "3") + g.slice(10);
    expect(validateGstin(typo).valid).toBe(false);
    expect(validateGstin(typo).reason).toMatch(/Check digit/);
  });

  it("rejects wrong length and format", () => {
    expect(validateGstin("23ABC").valid).toBe(false);
    expect(validateGstin("ZZABCDE1234F1Z5").valid).toBe(false);
  });
});

describe("tax split", () => {
  it("splits intra-state into CGST + SGST", () => {
    expect(splitTax(10000, 5, "Madhya Pradesh", "Madhya Pradesh")).toEqual({ taxable: 10000, cgst: 250, sgst: 250, igst: 0, total: 10500 });
  });
  it("charges IGST inter-state", () => {
    expect(splitTax(10000, 5, "Madhya Pradesh", "Rajasthan")).toEqual({ taxable: 10000, cgst: 0, sgst: 0, igst: 500, total: 10500 });
  });
});

describe("sale document rules", () => {
  it("regular dealers issue tax invoices anywhere", () => {
    expect(decideSaleDocument("REGULAR", "Madhya Pradesh", "Karnataka")).toEqual({ allowed: true, document: "TAX", chargesTax: true });
  });
  it("composition dealers issue a bill of supply within the state", () => {
    expect(decideSaleDocument("COMPOSITION", "Madhya Pradesh", "Madhya Pradesh")).toEqual({ allowed: true, document: "BILL_OF_SUPPLY", chargesTax: false });
  });
  it("composition dealers cannot sell to another state", () => {
    const d = decideSaleDocument("COMPOSITION", "Madhya Pradesh", "Rajasthan");
    expect(d.allowed).toBe(false);
  });
  it("unregistered sellers never charge tax", () => {
    expect(decideSaleDocument("UNREGISTERED", "Madhya Pradesh", "Rajasthan")).toMatchObject({ document: "BILL_OF_SUPPLY", chargesTax: false });
  });
});

describe("invoice numbering", () => {
  it("uses the Indian financial year (April–March, IST)", () => {
    expect(financialYear(new Date("2026-11-24T10:00:00Z")).label).toBe("2026-27");
    expect(financialYear(new Date("2027-03-31T18:00:00Z")).label).toBe("2026-27"); // 31 Mar 23:30 IST
    expect(financialYear(new Date("2027-03-31T19:00:00Z")).label).toBe("2027-28"); // 1 Apr 00:30 IST
  });
  it("builds short, unique-per-series numbers within 16 characters", () => {
    expect(businessPrefix("Kushwaha Handloom")).toBe("KH");
    expect(invoiceNumber("KH", "TAX", "26-27", 7)).toBe("KH/26-27/0007");
    expect(invoiceNumber("RWC", "PROFORMA", "26-27", 12)).toBe("RWC/P26-27/0012");
    expect(invoiceNumber("RWC", "BILL_OF_SUPPLY", "26-27", 9999).length).toBeLessThanOrEqual(16);
  });
});
