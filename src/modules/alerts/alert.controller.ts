import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { AlertService } from "./alert.service.js";

const ListQuery = z.object({ unread: z.enum(["true", "false"]).default("false") });
const IdParam = z.object({ id: z.string().min(1).max(40) });

export function alertRouter(alerts: AlertService): Router {
  const r = Router();

  r.get("/", async (req, res) => {
    const { unread } = parse(ListQuery, req.query);
    res.json({ alerts: await alerts.list(producerIdOf(req), unread === "true") });
  });

  r.post("/read-all", async (req, res) => {
    res.json({ updated: await alerts.markAllRead(producerIdOf(req)) });
  });

  r.post("/:id/read", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json({ updated: await alerts.markRead(producerIdOf(req), id) });
  });

  return r;
}
