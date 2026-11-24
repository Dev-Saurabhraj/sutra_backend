import express, { Router } from "express";
import { AppError } from "../../core/errors.js";
import { signatureValid, textMessages, type WhatsAppBot } from "./whatsapp.js";

export type WhatsAppConfig = { verifyToken: string; appSecret: string; allowUnsigned: boolean };

/** Webhook for the WhatsApp Cloud API. Public (Meta calls it), so it checks Meta's signature instead of a login. */
export function whatsappRouter(bot: WhatsAppBot, cfg: WhatsAppConfig): Router {
  const r = Router();

  // Meta's one-time verification handshake
  r.get("/", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && cfg.verifyToken && req.query["hub.verify_token"] === cfg.verifyToken) {
      res.type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
      return;
    }
    res.status(403).end();
  });

  r.post("/", express.raw({ type: "application/json", limit: "256kb" }), async (req, res) => {
    const raw = req.body as Buffer;
    const signed = cfg.appSecret ? signatureValid(raw, req.header("x-hub-signature-256"), cfg.appSecret) : false;
    if (!signed && !cfg.allowUnsigned) throw AppError.unauthorized("Bad webhook signature");
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      throw AppError.badRequest("BAD_JSON", "Body is not JSON");
    }
    const replies = [];
    for (const m of textMessages(payload)) replies.push({ to: m.from, reply: await bot.handle(m) });
    // Meta only needs a 200; the replies are returned too so the flow can be tried with curl in development.
    res.json({ ok: true, replies });
  });

  return r;
}
