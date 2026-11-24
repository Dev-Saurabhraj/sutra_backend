import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Logger } from "../../core/logger.js";
import { CLAUDE_MODEL } from "../../ai/claude-voice-parser.js";
import { BillSchema, type BillImage, type BillRead, type BillReader, type MaterialHint } from "./bill-reader.js";
import { sampleImage } from "./sample-bills.js";

const SYSTEM =
  "You read Indian supplier tax invoices (often photographed on a phone, sometimes partly handwritten) for a small manufacturer's bookkeeping. " +
  "Extract the fields exactly as printed. Amounts are in rupees. If a value is hard to read, give your best reading of what is printed; never invent values that are not on the bill. " +
  "Match each line item to one of the producer's materials only when it is clearly the same material.";

/** Claude reads the photo with structured output. Failures return null so the chain can fall back. */
export class ClaudeBillReader implements BillReader {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly logger: Logger,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  }

  async read(input: { image: BillImage | null; sampleKey: string | null }, materials: MaterialHint[]): Promise<BillRead | null> {
    const image = input.image ?? (input.sampleKey ? await sampleImage(input.sampleKey) : null);
    if (!image) return null;
    try {
      const res = await this.client.beta.messages.parse({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // money is involved: a little more care than the voice parser
        output_config: { effort: "medium", format: betaZodOutputFormat(BillSchema) },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
              { type: "text", text: `The producer's materials:\n${materials.map((m) => `- ${m.id}: ${m.name} (${m.unit})`).join("\n")}\n\nExtract this bill.` },
            ],
          },
        ],
      });
      if (res.stop_reason === "refusal" || !res.parsed_output) return null;
      return { bill: res.parsed_output, parser: `ai:${res.model}` };
    } catch (err) {
      if (err instanceof Anthropic.APIError) this.logger.warn({ status: err.status }, "bill reader API error");
      else this.logger.warn({ err }, "bill reader failed");
      return null;
    }
  }
}
