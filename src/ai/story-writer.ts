import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Logger } from "../core/logger.js";
import { CLAUDE_MODEL } from "./claude-voice-parser.js";

export const StorySchema = z.object({
  title: z.string().describe("short product title for a B2B catalog, English"),
  story: z.string().describe("55-80 word buyer-facing English description: craft, material, feel, use. No hype words."),
  tags: z.array(z.string()).describe("3-5 short tags"),
});
export type Story = z.infer<typeof StorySchema>;

export type StoryInput = {
  note: string;
  category: string;
  maker: string;
  place: string;
  industry: string;
  image?: { base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" };
};

/** Strategy: write an honest catalog entry for a product. Never throws. */
export interface StoryWriter {
  write(input: StoryInput): Promise<Story & { writer: string }>;
}

/** Offline: a plain, truthful template from what the maker told us. */
export class TemplateStoryWriter implements StoryWriter {
  async write(i: StoryInput): Promise<Story & { writer: string }> {
    // An English listing must not carry a Hindi note pasted in; the maker can add their own line in the editor.
    const note = /[ऀ-ॿ]/.test(i.note) ? "" : i.note.trim().replace(/[.\s]+$/, "");
    return {
      writer: "template",
      title: `${i.category} by ${i.maker}`,
      story:
        `Made by hand in ${i.place} by ${i.maker}. ${note ? `In the maker's words: ${note}. ` : ""}` +
        "Each piece is finished and checked before dispatch, so small variations are part of its character. " +
        "Available for bulk orders with a GST invoice.",
      tags: [i.category, i.place, i.industry, "handmade"].filter(Boolean),
    };
  }
}

/** Claude looks at the photo and the maker's note; the template is used if it can't. */
export class ClaudeStoryWriter implements StoryWriter {
  private readonly client: Anthropic;
  private readonly fallback = new TemplateStoryWriter();

  constructor(
    apiKey: string,
    private readonly logger: Logger,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  }

  async write(i: StoryInput): Promise<Story & { writer: string }> {
    try {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (i.image) content.push({ type: "image", source: { type: "base64", media_type: i.image.mediaType, data: i.image.base64 } });
      content.push({
        type: "text",
        text: `Category: ${i.category}\nIndustry: ${i.industry}\nMaker: ${i.maker}, ${i.place}\nMaker's note (may be Hindi): "${i.note}"\nWrite the catalog entry.`,
      });
      const res = await this.client.beta.messages.parse({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(StorySchema) },
        system:
          "You write honest, specific B2B catalog copy for Indian artisan products, for boutique and retail buyers. " +
          "Use only details from the note and the photo. Never invent awards, certifications, GI tags, ages, or numbers.",
        messages: [{ role: "user", content }],
      });
      if (res.stop_reason === "refusal" || !res.parsed_output) return this.fallback.write(i);
      return { ...res.parsed_output, writer: `ai:${res.model}` };
    } catch (err) {
      this.logger.warn({ err: err instanceof Anthropic.APIError ? err.status : String(err) }, "story writer failed; using template");
      return this.fallback.write(i);
    }
  }
}
