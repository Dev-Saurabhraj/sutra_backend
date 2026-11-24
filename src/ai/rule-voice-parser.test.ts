import { describe, expect, it } from "vitest";
import { RuleVoiceParser } from "./rule-voice-parser.js";
import type { VoiceContext } from "./voice-parser.js";

const ctx: VoiceContext = {
  products: [
    { id: "saree", name: "Chanderi Silk-Cotton Saree: Asharfi Buti", nameHi: "चंदेरी सिल्क-कॉटन साड़ी" },
    { id: "dupatta", name: "Chanderi Dupatta", nameHi: "चंदेरी दुपट्टा" },
  ],
  materials: [],
};
const parser = new RuleVoiceParser();

describe("RuleVoiceParser", () => {
  it("parses the demo sentence into produce + sale with city", async () => {
    const r = await parser.parse("aaj 6 saree bani, 4 Jaipur bheji", ctx);
    expect(r?.parser).toBe("rules");
    expect(r?.actions).toEqual([
      { kind: "PRODUCE", productId: "saree", materialId: "", qty: 6, amount: 0, party: "" },
      { kind: "SALE", productId: "saree", materialId: "", qty: 4, amount: 0, party: "Jaipur" },
    ]);
    expect(r?.replyHi).toContain("Jaipur");
  });

  it("understands Devanagari and picks the named product", async () => {
    const r = await parser.parse("आज 10 दुपट्टे बने", ctx);
    expect(r?.actions[0]).toMatchObject({ kind: "PRODUCE", productId: "dupatta", qty: 10 });
  });

  it("understands Hindi number words and Hindi cities", async () => {
    const r = await parser.parse("teen saree बनी और do भोपाल भेजी", ctx);
    expect(r?.actions.map((a) => [a.kind, a.qty, a.party])).toEqual([
      ["PRODUCE", 3, ""],
      ["SALE", 2, "Bhopal"],
    ]);
  });

  it("records payments", async () => {
    const r = await parser.parse("Jaipur se 5000 rupaye mile", ctx);
    expect(r?.actions[0]).toMatchObject({ kind: "PAYMENT_RECEIVED", amount: 5000, party: "Jaipur" });
  });

  it("returns null when nothing is understood", async () => {
    expect(await parser.parse("namaste kaise ho", ctx)).toBeNull();
  });
});
