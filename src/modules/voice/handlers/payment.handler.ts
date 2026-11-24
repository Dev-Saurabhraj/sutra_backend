import type { VoiceAction } from "../../../ai/voice-parser.js";
import { inr, round2 } from "../../../shared/money.js";
import type { ActionResult, ActionView, ExecuteContext, PreviewContext, VoiceActionHandler } from "./types.js";

/** "Jaipur se 5000 mile" / "Surat wale ko 8000 diye" → apply the payment to the oldest open khata entry. */
export class PaymentHandler implements VoiceActionHandler {
  constructor(readonly kind: "PAYMENT_RECEIVED" | "PAYMENT_MADE") {}

  private get direction() {
    return this.kind === "PAYMENT_RECEIVED" ? ("RECEIVE" as const) : ("PAY" as const);
  }

  isValid(a: VoiceAction): boolean {
    return a.amount > 0;
  }

  async describe(a: VoiceAction, { repos, producer }: PreviewContext): Promise<ActionView> {
    const entry = await repos.khata.oldestOpenForParty(producer.id, this.direction, a.party);
    const received = this.kind === "PAYMENT_RECEIVED";
    return {
      label: received ? `Received ${inr(a.amount)}${a.party ? ` from ${a.party}` : ""}` : `Paid ${inr(a.amount)}${a.party ? ` to ${a.party}` : ""}`,
      labelHi: received ? `${a.party ? a.party + " से " : ""}${inr(a.amount)} मिले` : `${a.party ? a.party + " को " : ""}${inr(a.amount)} दिए`,
      ...(entry
        ? { effect: `Khata: ${entry.party} (${inr(entry.amount)})`, effectHi: `खाता: ${entry.party} (${inr(entry.amount)})` }
        : { warning: "No open khata entry found for this party", warningHi: "खाते में इसका कोई बाकी नहीं मिला" }),
    };
  }

  async execute(a: VoiceAction, { repos, producer, now }: ExecuteContext): Promise<ActionResult> {
    const entry = await repos.khata.oldestOpenForParty(producer.id, this.direction, a.party);
    if (!entry) return { text: "Nothing to update in khata", textHi: "खाते में बदलने को कुछ नहीं था" };
    if (a.amount + 0.5 >= entry.amount) {
      await repos.khata.settle(producer.id, entry.id, now);
      return { text: `Khata settled: ${entry.party}`, textHi: `खाता चुकता: ${entry.party}` };
    }
    const left = round2(entry.amount - a.amount);
    await repos.khata.reduce(producer.id, entry.id, left, `${inr(a.amount)} paid on ${now.toISOString().slice(0, 10)}`);
    return { text: `Khata updated: ${inr(left)} still due from ${entry.party}`, textHi: `खाता अपडेट: ${entry.party} का ${inr(left)} बाकी` };
  }
}
