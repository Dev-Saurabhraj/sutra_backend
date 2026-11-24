import type { VoiceAction } from "../../../ai/voice-parser.js";
import type { ActionResult, ActionView, ExecuteContext, PreviewContext, VoiceActionHandler, VoiceCatalog } from "./types.js";

/** "5 kilo resham aaya" → raw material up. (Bills with GST come through Snap-a-bill in Phase 2.) */
export class PurchaseHandler implements VoiceActionHandler {
  readonly kind = "PURCHASE" as const;

  isValid(a: VoiceAction, catalog: VoiceCatalog): boolean {
    return a.qty > 0 && catalog.materials.has(a.materialId);
  }

  async describe(a: VoiceAction, { catalog }: PreviewContext): Promise<ActionView> {
    const m = catalog.materials.get(a.materialId)!;
    return {
      label: `Bought ${a.qty} ${m.unit} ${m.name}`,
      labelHi: `${a.qty} ${m.unit} ${m.nameHi} आया`,
      effect: "Tip: snap the bill too, so the GST credit is recorded",
      effectHi: "बिल की फ़ोटो भी लें, ताकि GST क्रेडिट मिले",
    };
  }

  async execute(a: VoiceAction, { repos, producer, catalog, inventory }: ExecuteContext): Promise<ActionResult> {
    const m = catalog.materials.get(a.materialId)!;
    // No rate in a voice note, so this is a stock movement only; the bill photo adds the GST purchase.
    await inventory.stockInIn(repos, producer, { materialId: m.id, qty: a.qty, source: "VOICE" });
    return { text: `Stock +${a.qty} ${m.unit} ${m.name}`, textHi: `${a.qty} ${m.unit} ${m.nameHi} जुड़ा` };
  }
}
