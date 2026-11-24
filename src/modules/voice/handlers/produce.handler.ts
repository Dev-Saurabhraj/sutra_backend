import { AppError } from "../../../core/errors.js";
import type { VoiceAction } from "../../../ai/voice-parser.js";
import { round3 } from "../../../shared/money.js";
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

  async execute(a: VoiceAction, { repos, producer }: ExecuteContext): Promise<ActionResult> {
    const product = await repos.stock.product(producer.id, a.productId);
    if (!product) throw AppError.notFound("Product");
    await repos.stock.moveProduct({ producerId: producer.id, productId: product.id, kind: "PRODUCE", qty: a.qty, source: "VOICE" }, a.qty);
    for (const line of product.recipe) {
      const used = round3(line.qtyPerUnit * a.qty);
      await repos.stock.moveMaterial({ producerId: producer.id, materialId: line.materialId, kind: "CONSUME", qty: -used, source: "VOICE" });
    }
    return {
      text: `Stock +${a.qty} ${product.name}; raw material used up`,
      textHi: `${a.qty} ${product.nameHi} स्टॉक में जुड़ीं, कच्चा माल घटाया`,
      consumedMaterialIds: product.recipe.map((r) => r.materialId),
    };
  }
}
