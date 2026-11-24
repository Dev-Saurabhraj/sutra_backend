import { createHmac, timingSafeEqual } from "node:crypto";
import type { Logger } from "../../core/logger.js";
import type { Repositories } from "../../data/unit-of-work.js";
import type { VoiceService } from "../voice/voice.service.js";

/** Strategy: how a reply reaches the maker's WhatsApp. */
export interface WhatsAppSender {
  send(toE164: string, text: string): Promise<void>;
}

/** No WhatsApp Business number configured: the reply is logged (and returned by the webhook for testing). */
export class LogWhatsAppSender implements WhatsAppSender {
  constructor(private readonly logger: Logger) {}
  async send(to: string, text: string): Promise<void> {
    this.logger.info({ to: to.slice(0, 5) + "…", text }, "whatsapp reply (not sent: no WhatsApp number configured)");
  }
}

/** WhatsApp Cloud API (Meta). Needs a WhatsApp Business number id and a permanent access token. */
export class CloudWhatsAppSender implements WhatsAppSender {
  constructor(
    private readonly phoneNumberId: string,
    private readonly token: string,
    private readonly logger: Logger,
  ) {}

  async send(to: string, text: string): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "text", text: { body: text } }),
    });
    if (!res.ok) this.logger.warn({ status: res.status }, "whatsapp send failed");
  }
}

/** Meta signs every webhook call with the app secret (X-Hub-Signature-256). */
export function signatureValid(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const YES = /^\s*(haan|ha|haa|han|yes|y|ok|okay|हाँ|हां|हा|ठीक)\s*[.!]*\s*$/i;
const NO = /^\s*(nahi|nahin|no|n|cancel|नहीं|ना)\s*[.!]*\s*$/i;

export type IncomingText = { from: string; text: string };

/** Pulls text messages out of a WhatsApp Cloud API webhook payload. */
export function textMessages(payload: unknown): IncomingText[] {
  const out: IncomingText[] = [];
  const entries = (payload as { entry?: { changes?: { value?: { messages?: { from?: string; type?: string; text?: { body?: string } }[] } }[] }[] })?.entry ?? [];
  for (const e of entries) for (const c of e.changes ?? []) for (const m of c.value?.messages ?? []) {
    if (m.type === "text" && m.from && m.text?.body) out.push({ from: `+${m.from.replace(/^\+/, "")}`, text: m.text.body.slice(0, 500) });
  }
  return out;
}

/**
 * P28: the same voice flow inside WhatsApp. A maker types (or dictates) "aaj 6 saree bani, 4 Jaipur bheji";
 * Sutra replies with what it understood; "haan" saves it, "nahi" drops it. Nothing is saved without the "haan".
 */
export class WhatsAppBot {
  /** Last preview per maker, waiting for "haan". */
  private readonly pending = new Map<string, { entryId: string; at: number }>();
  private static readonly PENDING_MS = 30 * 60_000;

  constructor(
    private readonly repos: Repositories,
    private readonly voice: VoiceService,
    private readonly sender: WhatsAppSender,
  ) {}

  async handle(msg: IncomingText): Promise<string> {
    const reply = await this.answer(msg);
    await this.sender.send(msg.from, reply);
    return reply;
  }

  private async answer({ from, text }: IncomingText): Promise<string> {
    const user = await this.repos.auth.findUserByPhone(from);
    if (!user?.producerId) {
      return "Namaste! Yeh number Sutra par kisi karobar se juda nahi hai. Pehle Sutra app mein login karein. / यह नंबर Sutra पर किसी कारोबार से जुड़ा नहीं है।";
    }
    const producerId = user.producerId;
    const waiting = this.pending.get(producerId);
    const fresh = waiting && Date.now() - waiting.at < WhatsAppBot.PENDING_MS ? waiting : undefined;

    if (YES.test(text)) {
      if (!fresh) return "Abhi koi entry save karne ko nahi hai. Bolkar ya likhkar bhejein: \"aaj 6 saree bani\". / अभी सेव करने को कुछ नहीं है।";
      this.pending.delete(producerId);
      const { results } = await this.voice.confirm(producerId, fresh.entryId);
      return `✅ ${results.map((r) => r.textHi).join("\n✅ ")}`;
    }
    if (NO.test(text)) {
      this.pending.delete(producerId);
      return "ठीक है, कुछ सेव नहीं किया।";
    }
    try {
      const p = await this.voice.preview(producerId, text);
      if (!p.canSave) return `⚠️ ${p.actions.map((a) => a.blocked?.hi ?? a.labelHi).join("\n")}`;
      this.pending.set(producerId, { entryId: p.entryId, at: Date.now() });
      const lines = p.actions.map((a) => `• ${a.labelHi}${a.effectHi ? ` (${a.effectHi})` : ""}${a.warningHi ? ` ⚠️ ${a.warningHi}` : ""}`);
      return `${lines.join("\n")}\n\nसेव करें? "हाँ" लिखें, या "नहीं"।`;
    } catch {
      return "समझ नहीं आया। ऐसे लिखें: \"aaj 6 saree bani, 4 Jaipur bheji\" या \"Salim ko 2000 diye\"।";
    }
  }
}
