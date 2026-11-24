import { describe, expect, it } from "vitest";
import { earlyPay } from "../finance/early-pay.js";
import { ondcCatalog, productIssues } from "./ondc.js";

const seller = { id: "s", businessName: "Kushwaha Handloom", city: "Chanderi", state: "Madhya Pradesh", phone: "+919800000001", gstin: "23RJVPK5073P1ZY", industryKey: "handloom", upiId: null };
const good = { id: "p", name: "Saree", category: "Silk-Cotton Saree", story: "Woven on a pit loom with hand-inserted butis; light and sheer.", price: 3070, mrp: 6000, hsn: "5007", gstRate: 5, stock: 24, imageUrl: "/media/catalog/x.jpg", published: true };

describe("ONDC catalog (X8)", () => {
  it("a complete product has no blocking issues", () => {
    expect(productIssues(good, seller).filter((i) => i.blocking)).toEqual([]);
  });

  it("flags what seller apps reject", () => {
    const fields = productIssues({ ...good, imageUrl: null, story: "Saree", mrp: 100 }, { ...seller, gstin: null }).map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(["image", "description", "mrp", "gstin"]));
  });

  it("builds a Beckn catalog in the fashion domain for handloom", () => {
    const c = ondcCatalog(seller, [good], "https://api.example.in");
    expect(c.context.domain).toBe("ONDC:RET12");
    const item = c["bpp/providers"][0]!.items[0]!;
    expect(item.descriptor.images[0]).toBe("https://api.example.in/media/catalog/x.jpg");
    expect(item.price).toEqual({ currency: "INR", value: "3070.00", maximum_value: "6000.00" });
  });
});

describe("early payment through TReDS (X8)", () => {
  const now = new Date("2026-11-24T00:00:00Z");
  const inv = { id: "k", party: "Kaveri Boutique", invoiceNo: "KH/26-27/0015", amount: 100_000, dueDate: new Date("2026-12-24T00:00:00Z"), buyerGstin: "29HWXFK1391W1ZE" };

  it("estimates the discount for the days paid early", () => {
    const [r] = earlyPay([inv], true, now, 0.11);
    expect(r!.fit).toBe("CHECK");
    expect(r!.daysEarly).toBe(30);
    expect(r!.estCost).toBeCloseTo(904.11, 1);
    expect(r!.youGet).toBeCloseTo(99095.89, 1);
  });

  it("needs MSME registration and a business buyer", () => {
    expect(earlyPay([inv], false, now)[0]!.fit).toBe("NO");
    expect(earlyPay([{ ...inv, buyerGstin: null }], true, now)[0]!.fit).toBe("NO");
  });
});
