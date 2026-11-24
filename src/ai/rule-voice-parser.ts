// Offline parser for common Hindi / Hinglish phrasing, e.g. "aaj 6 saree bani, 4 Jaipur bheji".
// Ported from thread/src/lib/ai.ts (fallbackVoice) and made industry-neutral.
import type { VoiceAction, VoiceContext, VoiceParse, VoiceParser } from "./voice-parser.js";

const PRODUCE = /(bani|bane|banayi|banaye|banaya|taiyaar|tayyar|बनी|बने|बना|बनाई|बनाए|बनीं|तैयार|made|produced)/;
const SALE = /(bheji|bheje|bheja|bechi|beche|becha|भेजी|भेजे|भेजा|भेजीं|बेची|बेचे|बेचा|sold|sent)/;
const PAY_IN = /(paise mile|paisa mila|mile|मिले|मिला|received)/;
const PAY_OUT = /(paise diye|diye|दिए|दिये|paid)/;

const EN_CITIES = ["jaipur", "bengaluru", "bangalore", "mumbai", "delhi", "indore", "pune", "bhopal", "surat", "lucknow", "kolkata", "chennai", "hyderabad"];
const HI_CITIES: Record<string, string> = {
  जयपुर: "Jaipur", बेंगलुरु: "Bengaluru", मुंबई: "Mumbai", दिल्ली: "Delhi", इंदौर: "Indore",
  पुणे: "Pune", भोपाल: "Bhopal", सूरत: "Surat", लखनऊ: "Lucknow", कोलकाता: "Kolkata",
};

/** Hindi number words people actually say in short notes. */
const HI_NUMBERS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chah: 6, saat: 7, aath: 8, nau: 9, das: 10,
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
};

export class RuleVoiceParser implements VoiceParser {
  async parse(transcript: string, ctx: VoiceContext): Promise<VoiceParse | null> {
    const actions = parseActions(transcript, ctx);
    if (!actions.length) return null;
    return { actions, replyHi: replyHi(actions, ctx), parser: "rules" };
  }
}

/** A worker whose first name is spoken in this part ("salim ko 2000 diye"). */
function workerIn(part: string, ctx: VoiceContext) {
  return (ctx.workers ?? []).find((w) => {
    const first = w.name.replace(/^(mohd\.?|md\.?)\s*/i, "").split(/\s+/)[0]?.toLowerCase();
    return !!first && first.length >= 3 && new RegExp(`(^|\\s)${first}(\\s|$)`).test(part);
  });
}

export function parseActions(transcript: string, ctx: VoiceContext): VoiceAction[] {
  const text = transcript.toLowerCase();
  const actions: VoiceAction[] = [];
  for (const part of text.split(/,|और|\baur\b|\bthen\b|।/)) {
    const qty = firstNumber(part);
    if (!qty) continue;
    const party = cityIn(part);
    if (PAY_IN.test(part) && /(₹|rs|rupay|rupaye|रुपये|रुपए|paise|पैसे)/.test(part)) {
      actions.push({ kind: "PAYMENT_RECEIVED", productId: "", materialId: "", qty: 0, amount: qty, party });
      continue;
    }
    if (PAY_OUT.test(part)) {
      // "Salim ko 2000 diye": a karigar named → wages (no "rupees" needed: a name plus "diye" is clear enough)
      const worker = workerIn(part, ctx);
      if (worker) {
        actions.push({ kind: "WAGE_PAID", productId: "", materialId: "", qty: 0, amount: qty, party: worker.name });
        continue;
      }
    }
    if (PAY_OUT.test(part) && /(₹|rs|rupay|rupaye|रुपये|रुपए|paise|पैसे)/.test(part)) {
      actions.push({ kind: "PAYMENT_MADE", productId: "", materialId: "", qty: 0, amount: qty, party });
      continue;
    }
    const product = matchProduct(part, ctx);
    if (!product) continue;
    if (PRODUCE.test(part)) actions.push({ kind: "PRODUCE", productId: product.id, materialId: "", qty, amount: 0, party: "" });
    else if (SALE.test(part)) actions.push({ kind: "SALE", productId: product.id, materialId: "", qty, amount: 0, party });
  }
  return actions;
}

function firstNumber(part: string): number {
  const digits = part.match(/(\d+(?:\.\d+)?)/);
  if (digits?.[1]) return Number(digits[1]);
  for (const word of part.split(/\s+/)) {
    const n = HI_NUMBERS[word];
    if (n) return n;
  }
  return 0;
}

function cityIn(part: string): string {
  const en = EN_CITIES.find((c) => new RegExp(`\\b${c}\\b`).test(part));
  if (en) return en.charAt(0).toUpperCase() + en.slice(1);
  const hi = Object.keys(HI_CITIES).find((c) => part.includes(c));
  return hi ? (HI_CITIES[hi] ?? "") : "";
}

/** Match the product named in the fragment; otherwise the producer's first (main) product. */
function matchProduct(part: string, ctx: VoiceContext) {
  const words = part.split(/[\s,]+/).filter((w) => w.length >= 3);
  const scored = ctx.products
    .map((p) => {
      const hay = `${p.name} ${p.nameHi}`.toLowerCase();
      const score = words.filter((w) => hay.includes(w) || hay.includes(stem(w))).length;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best && best.score > 0) return best.p;
  return ctx.products[0];
}

/** "dupatte" → "dupatt", "sarees" → "saree": tolerate plural endings. */
const stem = (w: string) => w.replace(/(e|on|en|s|ें|े|ों|ियाँ|ियां)$/u, "");

function replyHi(actions: VoiceAction[], ctx: VoiceContext): string {
  const parts = actions.map((a) => {
    const name = ctx.products.find((p) => p.id === a.productId)?.nameHi ?? "";
    switch (a.kind) {
      case "PRODUCE":
        return `${a.qty} ${name} बनीं`;
      case "SALE":
        return `${a.qty} ${name} ${a.party ? a.party + " " : ""}भेजीं`;
      case "PAYMENT_RECEIVED":
        return `₹${a.amount} मिले`;
      case "PAYMENT_MADE":
        return `₹${a.amount} दिए`;
      case "PURCHASE":
        return `${a.qty} माल आया`;
      case "WAGE_PAID":
        return `${a.party} को ₹${a.amount} मज़दूरी दी`;
    }
  });
  return `ठीक है, लिख लिया: ${parts.join(", ")}।`;
}
