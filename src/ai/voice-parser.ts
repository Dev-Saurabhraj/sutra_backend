import { z } from "zod";

export const VOICE_ACTION_KINDS = ["PRODUCE", "SALE", "PURCHASE", "PAYMENT_RECEIVED", "PAYMENT_MADE", "WAGE_PAID"] as const;
export type VoiceActionKind = (typeof VOICE_ACTION_KINDS)[number];

export const VoiceActionSchema = z.object({
  kind: z.enum(VOICE_ACTION_KINDS),
  productId: z.string().describe("for PRODUCE/SALE: id from the product list, else empty"),
  materialId: z.string().describe("for PURCHASE: id from the material list, else empty"),
  qty: z.number().describe("units or material quantity; 0 for payments"),
  amount: z.number().describe("rupees for payments; 0 otherwise"),
  party: z.string().describe("buyer, supplier or city mentioned; for WAGE_PAID the worker's name exactly as in the worker list; empty if none"),
});
export type VoiceAction = z.infer<typeof VoiceActionSchema>;

export const VoiceParseSchema = z.object({
  actions: z.array(VoiceActionSchema),
  replyHi: z.string().describe("one short confirmation sentence in simple Hindi (Devanagari) of what was recorded"),
});

export type VoiceContext = {
  products: { id: string; name: string; nameHi: string }[];
  materials: { id: string; name: string; nameHi: string; unit: string }[];
  /** Karigars, so "Salim ko 2000 diye" is a wage payment, not a supplier payment. */
  workers?: { id: string; name: string }[];
};

export type VoiceParse = z.infer<typeof VoiceParseSchema> & {
  /** Who understood it, for the audit trail: "ai:<model>" or "rules". */
  parser: string;
};

/** Strategy: turn a spoken business note into bookkeeping actions. Returns null when it can't. Never throws. */
export interface VoiceParser {
  parse(transcript: string, ctx: VoiceContext): Promise<VoiceParse | null>;
}

/** Chain of responsibility: try each parser in order until one understands the note. */
export class FallbackVoiceParser implements VoiceParser {
  constructor(private readonly chain: VoiceParser[]) {}

  async parse(transcript: string, ctx: VoiceContext): Promise<VoiceParse | null> {
    for (const parser of this.chain) {
      const result = await parser.parse(transcript, ctx);
      if (result && result.actions.length > 0) return result;
    }
    return null;
  }
}
