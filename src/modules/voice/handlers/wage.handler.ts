import type { VoiceAction } from "../../../ai/voice-parser.js";
import type { Repositories } from "../../../data/unit-of-work.js";
import { inr, round2 } from "../../../shared/money.js";
import { balances, currentPeriod, settle } from "../../labour/wages.js";
import type { ActionResult, ActionView, ExecuteContext, PreviewContext, VoiceActionHandler } from "./types.js";

/**
 * P23: "Salim ko 2000 diye" → wages. The advance recovery follows the same lawful 50% cap as the pay screen;
 * cash beyond what is due is recorded as a new advance, so the ledger always adds up.
 */
export class WageHandler implements VoiceActionHandler {
  readonly kind = "WAGE_PAID" as const;

  isValid(a: VoiceAction): boolean {
    return a.amount > 0 && a.party.trim().length > 0;
  }

  async describe(a: VoiceAction, { repos, producer }: PreviewContext): Promise<ActionView> {
    const plan = await this.plan(repos, producer.id, a);
    if (!plan) return { label: `Wages ${inr(a.amount)} to ${a.party}`, labelHi: `${a.party} को ${inr(a.amount)}`, blocked: { en: "No karigar with this name", hi: "इस नाम का कारीगर नहीं मिला" } };
    const { w, wage, recovery, extraAdvance, dueAfter } = plan;
    const parts = [
      recovery > 0 ? `advance adjusted ${inr(recovery)}` : "",
      extraAdvance > 0 ? `${inr(extraAdvance)} more than due → new advance` : "",
      `still due ${inr(dueAfter)}`,
    ].filter(Boolean);
    const partsHi = [
      recovery > 0 ? `पेशगी कटी ${inr(recovery)}` : "",
      extraAdvance > 0 ? `${inr(extraAdvance)} ज़्यादा → नई पेशगी` : "",
      `बाकी ${inr(dueAfter)}`,
    ].filter(Boolean);
    return {
      label: `Wages to ${w.name}: ${inr(wage + extraAdvance)}`,
      labelHi: `${w.name} को मज़दूरी: ${inr(wage + extraAdvance)}`,
      effect: parts.join(" · "),
      effectHi: partsHi.join(" · "),
    };
  }

  async execute(a: VoiceAction, { repos, producer }: ExecuteContext): Promise<ActionResult> {
    const plan = await this.plan(repos, producer.id, a);
    if (!plan) return { text: "No karigar with this name", textHi: "इस नाम का कारीगर नहीं मिला" };
    const { w, wage, recovery, extraAdvance, dueAfter } = plan;
    const base = { producerId: producer.id, workerId: w.id, mode: "CASH" as const };
    if (recovery > 0) await repos.labour.addPayment({ ...base, kind: "RECOVERY", amount: recovery, note: "Advance adjusted from wages (voice)" });
    if (wage > 0) await repos.labour.addPayment({ ...base, kind: "WAGE", amount: wage, note: "Paid by voice" });
    if (extraAdvance > 0) await repos.labour.addPayment({ ...base, kind: "ADVANCE", amount: extraAdvance, note: "Paid more than due (voice)" });
    return {
      text: `${w.name}: ${inr(wage + extraAdvance)} paid, ${inr(dueAfter)} still due`,
      textHi: `${w.name}: ${inr(wage + extraAdvance)} दिए, ${inr(dueAfter)} बाकी`,
    };
  }

  private async plan(repos: Repositories, producerId: string, a: VoiceAction) {
    const name = a.party.trim().toLowerCase();
    const w = (await repos.labour.workers(producerId)).find((x) => x.name.toLowerCase() === name || x.name.toLowerCase().startsWith(name));
    if (!w) return null;
    const period = currentPeriod(w.payCycle, new Date());
    const [life, inPeriod] = await Promise.all([repos.labour.totals(producerId), repos.labour.totals(producerId, period.start)]);
    const l = life.get(w.id) ?? { earned: 0, wagePaid: 0, advanceGiven: 0, recovered: 0 };
    const { wageDue, advancePending } = balances(l);
    const due = Math.max(0, wageDue);
    const { recovery } = due > 0
      ? settle({ wageDue: due, advancePending, earnedThisPeriod: inPeriod.get(w.id)?.earned ?? 0, recoveredThisPeriod: inPeriod.get(w.id)?.recovered ?? 0 })
      : { recovery: 0 };
    const cashRoom = round2(Math.max(0, due - recovery));
    const wage = round2(Math.min(a.amount, cashRoom));
    const extraAdvance = round2(a.amount - wage);
    return { w, wage, recovery, extraAdvance, dueAfter: round2(Math.max(0, due - recovery - wage)) };
  }
}
