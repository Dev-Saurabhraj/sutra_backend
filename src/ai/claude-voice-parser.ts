import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Logger } from "../core/logger.js";
import { VoiceParseSchema, type VoiceContext, type VoiceParse, type VoiceParser } from "./voice-parser.js";

export const CLAUDE_MODEL = "claude-opus-5-5";

const SYSTEM =
  "You turn a small producer's spoken business note (Hindi, Hinglish or English) into bookkeeping actions. " +
  "'bani/banayi/taiyaar' means produced; 'bheji/bechi/di' to someone means sold; 'aaya/kharida' for material means purchased; " +
  "'paise mile' means payment received; 'paise diye' means payment made. " +
  "If the product type is not named, use the most likely product from the list. " +
  "Only record what was actually said. Never invent quantities, parties or amounts.";

/** Claude reads the note with structured output. Any failure returns null so the chain falls back to rules. */
export class ClaudeVoiceParser implements VoiceParser {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly logger: Logger,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
  }

  async parse(transcript: string, ctx: VoiceContext): Promise<VoiceParse | null> {
    try {
      const res = await this.client.beta.messages.parse({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(VoiceParseSchema) },
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: prompt(transcript, ctx) }] }],
      });
      if (res.stop_reason === "refusal" || !res.parsed_output) return null;
      return { ...res.parsed_output, parser: `ai:${res.model}` };
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) this.logger.warn("voice parser rate limited; using rules");
      else if (err instanceof Anthropic.APIError) this.logger.warn({ status: err.status }, "voice parser API error; using rules");
      else this.logger.warn({ err }, "voice parser failed; using rules");
      return null;
    }
  }
}

function prompt(transcript: string, ctx: VoiceContext): string {
  const products = ctx.products.map((p) => `- ${p.id}: ${p.name} / ${p.nameHi}`).join("\n");
  const materials = ctx.materials.map((m) => `- ${m.id}: ${m.name} / ${m.nameHi} (${m.unit})`).join("\n");
  const workers = (ctx.workers ?? []).map((w) => `- ${w.name}`).join("\n");
  return `Products:\n${products}\nMaterials:\n${materials}\nWorkers (money given to them is WAGE_PAID):\n${workers}\n\nVoice note: "${transcript}"`;
}
