import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { VoiceService } from "./voice.service.js";

const PreviewBody = z.object({ transcript: z.string().trim().min(2).max(500) });
const IdParam = z.object({ id: z.string().min(1).max(40) });

export function voiceRouter(voice: VoiceService): Router {
  const r = Router();

  r.post("/preview", async (req, res) => {
    const { transcript } = parse(PreviewBody, req.body);
    res.json(await voice.preview(producerIdOf(req), transcript));
  });

  r.post("/:id/confirm", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.status(201).json(await voice.confirm(producerIdOf(req), id));
  });

  return r;
}
