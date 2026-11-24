import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseActions } from "../../ai/rule-voice-parser.js";
import { rateChange } from "../stock/price-watch.js";
import { signatureValid, textMessages } from "./whatsapp.js";

describe("karigar wages by voice (P23)", () => {
  const ctx = {
    products: [{ id: "p1", name: "Silk-cotton saree", nameHi: "साड़ी" }],
    materials: [],
    workers: [{ id: "w1", name: "Salim Ansari" }, { id: "w2", name: "Meena Bai" }],
  };

  it("a karigar's name plus diye is a wage payment", () => {
    expect(parseActions("salim ko 2000 diye", ctx)).toEqual([{ kind: "WAGE_PAID", productId: "", materialId: "", qty: 0, amount: 2000, party: "Salim Ansari" }]);
  });

  it("a supplier payment stays a khata payment", () => {
    expect(parseActions("surat wale ko 8000 rupaye diye", ctx)[0]!.kind).toBe("PAYMENT_MADE");
  });

  it("wages and production in one sentence", () => {
    const kinds = parseActions("aaj 6 saree bani, meena ko 500 diye", ctx).map((a) => a.kind);
    expect(kinds).toEqual(["PRODUCE", "WAGE_PAID"]);
  });
});

describe("supplier price watch (P25)", () => {
  it("measures the rise in percent", () => {
    expect(rateChange(9200, 9800)).toEqual({ from: 9200, to: 9800, pct: 6.5 });
    expect(rateChange(0, 100)).toBeNull();
  });
});

describe("WhatsApp webhook (P28)", () => {
  const payload = {
    entry: [{ changes: [{ value: { messages: [
      { from: "919800000001", type: "text", text: { body: "aaj 6 saree bani" } },
      { from: "919800000001", type: "image" },
    ] } }] }],
  };

  it("reads text messages only, with the sender in E.164", () => {
    expect(textMessages(payload)).toEqual([{ from: "+919800000001", text: "aaj 6 saree bani" }]);
    expect(textMessages({})).toEqual([]);
  });

  it("accepts only Meta's signature", () => {
    const body = Buffer.from(JSON.stringify(payload));
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(signatureValid(body, sig, "app-secret")).toBe(true);
    expect(signatureValid(body, sig, "other-secret")).toBe(false);
    expect(signatureValid(body, undefined, "app-secret")).toBe(false);
  });
});
