import type { VoiceAction } from "../../../ai/voice-parser.js";
import type { ActionResult, ActionView, ExecuteContext, PreviewContext, VoiceActionHandler, VoiceCatalog } from "./types.js";

/** "aaj 6 saree bani" → finished stock up, raw material down by recipe. */
export class ProduceHandler implements VoiceActionHandler {
  readonly kind = "PRODUCE" as const;

  isValid(a: VoiceAction, catalog: VoiceCatalog): boolean {
    return a.qty > 0 && Number.isInteger(a.qty) && catalog.products.has(a.productId);
  }

  async describe(a: VoiceAction, { catalog, producer }: PreviewContext): Promise<ActionView> {
    const p = catalog.products.get(a.productId)!;
    return {
      label: `Made ${a.qty} × ${p.name}`,
      labelHi: `${a.qty} ${p.nameHi} बनीं`,
      effect: `Raw material will be reduced by the recipe`,
      effectHi: `${producer.industry.key === "handloom" ? "धागा" : "कच्चा माल"} रेसिपी के हिसाब से घटेगा`,
    };
  }

  async execute(a: VoiceAction, { repos, producer, inventory }: ExecuteContext): Promise<ActionResult> {
    const { product, consumedMaterialIds } = await inventory.produceIn(repos, producer, { productId: a.productId, qty: a.qty, source: "VOICE" });
    return {
      text: `Stock +${a.qty} ${product.name}; raw material used up`,
      textHi: `${a.qty} ${product.nameHi} स्टॉक में जुड़ीं, कच्चा माल घटाया`,
      consumedMaterialIds,
    };
  }
}
