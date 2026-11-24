import type { Repositories } from "../../../data/unit-of-work.js";
import type { VoiceAction, VoiceActionKind } from "../../../ai/voice-parser.js";
import type { InvoiceService } from "../../invoices/invoice.service.js";
import type { ProducerProfile } from "../../producers/producer.repository.js";

export type VoiceCatalog = {
  products: Map<string, { id: string; name: string; nameHi: string; stock: number }>;
  materials: Map<string, { id: string; name: string; nameHi: string; unit: string; stock: number }>;
};

export type ActionView = {
  label: string;
  labelHi: string;
  /** What will happen as a side effect, e.g. "A GST invoice will be created". */
  effect?: string;
  effectHi?: string;
  warning?: string;
  warningHi?: string;
  /** Set when the action cannot be saved (e.g. composition dealer selling to another state). */
  blocked?: { en: string; hi: string };
};

export type ActionResult = {
  text: string;
  textHi: string;
  invoice?: { id: string; number: string; kind: string };
  consumedMaterialIds?: string[];
};

export type PreviewContext = { repos: Repositories; producer: ProducerProfile; catalog: VoiceCatalog };
export type ExecuteContext = PreviewContext & { transcript: string; now: Date; invoices: InvoiceService };

/** Command: one handler per voice action kind (Open/Closed — add a kind by adding a handler). */
export interface VoiceActionHandler {
  readonly kind: VoiceActionKind;
  /** Is this action well-formed for this producer? (unknown product ids etc.) */
  isValid(action: VoiceAction, catalog: VoiceCatalog): boolean;
  describe(action: VoiceAction, ctx: PreviewContext): Promise<ActionView>;
  execute(action: VoiceAction, ctx: ExecuteContext): Promise<ActionResult>;
}
