import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { KhataService } from "./khata.service.js";

const ListQuery = z.object({ status: z.enum(["open", "settled"]).default("open") });
const IdParam = z.object({ id: z.string().min(1).max(40) });

export function khataRouter(khata: KhataService): Router {
  const r = Router();

  r.get("/", async (req, res) => {
    const { status } = parse(ListQuery, req.query);
    res.json(await khata.list(producerIdOf(req), status === "settled"));
  });

  r.get("/export.csv", async (req, res) => {
    const { status } = parse(ListQuery, req.query);
    const file = await khata.export(producerIdOf(req), status === "settled");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(`﻿${file.body}`); // BOM so Excel opens Hindi names correctly
  });

  r.post("/:id/settle", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    await khata.settle(producerIdOf(req), id);
    res.status(204).end();
  });

  r.get("/:id/reminder", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await khata.reminder(producerIdOf(req), id));
  });

  return r;
}
