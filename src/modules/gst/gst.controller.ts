import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { GstService } from "./gst.service.js";

const PeriodQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
});

export function gstRouter(gst: GstService): Router {
  const r = Router();

  r.get("/periods", (_req, res) => res.json(gst.periods()));

  r.get("/summary", async (req, res) => {
    res.json(await gst.summary(producerIdOf(req), parse(PeriodQuery, req.query)));
  });

  r.get("/export.csv", async (req, res) => {
    const file = await gst.csv(producerIdOf(req), parse(PeriodQuery, req.query));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(`﻿${file.body}`); // BOM so Excel opens Hindi names correctly
  });

  r.get("/gstr1.json", async (req, res) => {
    const file = await gst.gstr1(producerIdOf(req), parse(PeriodQuery, req.query));
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.json(file.body);
  });

  // X7: GSTR-2B as downloaded from the GST portal (JSON), or the demo sample
  r.get("/2b/sample", async (req, res) => res.json(await gst.sample2b(producerIdOf(req))));
  r.post("/2b/reconcile", async (req, res) => {
    const { data } = parse(z.object({ data: z.unknown() }), req.body);
    res.json(await gst.reconcile(producerIdOf(req), data));
  });

  return r;
}
