import type { VoiceActionKind } from "../../ai/voice-parser.js";
import type { VoiceActionHandler } from "./handlers/types.js";
import { ProduceHandler } from "./handlers/produce.handler.js";
import { SaleHandler } from "./handlers/sale.handler.js";
import { PurchaseHandler } from "./handlers/purchase.handler.js";
import { PaymentHandler } from "./handlers/payment.handler.js";

/** Registry of voice action handlers. To support a new kind, register a new handler here. */
export class VoiceActionRegistry {
  private readonly handlers = new Map<VoiceActionKind, VoiceActionHandler>();

  register(handler: VoiceActionHandler): this {
    this.handlers.set(handler.kind, handler);
    return this;
  }

  get(kind: VoiceActionKind): VoiceActionHandler | undefined {
    return this.handlers.get(kind);
  }

  static withDefaults(): VoiceActionRegistry {
    return new VoiceActionRegistry()
      .register(new ProduceHandler())
      .register(new SaleHandler())
      .register(new PurchaseHandler())
      .register(new PaymentHandler("PAYMENT_RECEIVED"))
      .register(new PaymentHandler("PAYMENT_MADE"));
  }
}
