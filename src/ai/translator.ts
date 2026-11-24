import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Logger } from "../core/logger.js";
import { CLAUDE_MODEL } from "./claude-voice-parser.js";

export type Lang = "hi" | "en";

/** Strategy: translate a business message. Returns null when it can't (the original is then shown as is). */
export interface Translator {
  translate(text: string, to: Lang): Promise<string | null>;
}

/** Offline: no translation; the app shows the original and says it wasn't translated. */
export class NoTranslator implements Translator {
  async translate(): Promise<string | null> {
    return null;
  }
}

const Out = z.object({ text: z.string() });

export class ClaudeTranslator implements Translator {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly logger: Logger,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
  }

  async translate(text: string, to: Lang): Promise<string | null> {
    try {
      const res = await this.client.beta.messages.parse({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(Out) },
        system:
          to === "hi"
            ? "Translate the business message into simple, polite spoken Hindi in Devanagari, as a small-town producer would say it. Keep numbers, dates and product names exactly."
            : "Translate the business message into clear, polite English for a boutique or retail buyer. Keep numbers, dates and product names exactly.",
        messages: [{ role: "user", content: [{ type: "text", text }] }],
      });
      if (res.stop_reason === "refusal") return null;
      return res.parsed_output?.text ?? null;
    } catch (err) {
      this.logger.warn({ err: err instanceof Anthropic.APIError ? err.status : String(err) }, "translation failed");
      return null;
    }
  }
}
