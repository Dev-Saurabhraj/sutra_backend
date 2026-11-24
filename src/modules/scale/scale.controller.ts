import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors.js";
import { producerIdOf, userIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { GstService } from "../gst/gst.service.js";
import type { ClusterService } from "../cluster/cluster.service.js";
import type { ScaleService } from "./scale.service.js";

const id = z.object({ id: z.string().min(1).max(40) });
const Month = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), quarter: z.string().regex(/^\d{4}-Q[1-4]$/).optional() });

/** Maker side: ONDC catalog, early payment, joining a cluster, giving a CA access. */
export function scaleRouter(scale: ScaleService): Router {
  const r = Router();
  r.get("/ondc/catalog", async (req, res) => res.json(await scale.ondc(producerIdOf(req))));
  r.get("/finance/early-pay", async (req, res) => res.json(await scale.earlyPay(producerIdOf(req))));
  r.get("/clusters", async (req, res) => res.json(await scale.clusters(producerIdOf(req))));
  r.post("/clusters/:id/join", async (req, res) => res.status(201).json(await scale.requestJoin(producerIdOf(req), parse(id, req.params).id)));
  r.get("/me/ca", async (req, res) => res.json(await scale.caAccessFor(producerIdOf(req))));
  r.post("/me/ca", async (req, res) => {
    const b = parse(z.object({ phone: z.string().min(10).max(20), name: z.string().trim().min(2).max(60) }), req.body);
    res.status(201).json(await scale.grantCa(producerIdOf(req), b.phone, b.name));
  });
  r.delete("/me/ca/:id", async (req, res) => res.json(await scale.revokeCa(producerIdOf(req), parse(id, req.params).id)));
  return r;
}

/** Cluster admin: approve makers who ask to join. */
export function clusterJoinRouter(scale: ScaleService, cluster: ClusterService): Router {
  const r = Router();
  r.get("/joins", async (req, res) => res.json({ joins: await scale.pendingJoins(await cluster.clusterOf(userIdOf(req))) }));
  r.post("/joins/:id", async (req, res) => {
    const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
    res.json({ joins: await scale.decideJoin(await cluster.clusterOf(userIdOf(req)), parse(id, req.params).id, approve) });
  });
  return r;
}

/** The CA portal: read-only, and only for makers who granted access. */
export function caRouter(scale: ScaleService, gst: GstService): Router {
  const r = Router();
  r.use((req, _res, next) => (req.auth?.role === "CA" ? next() : next(AppError.forbidden("This is the CA portal"))));
  r.get("/clients", async (req, res) => res.json(await scale.caClients(userIdOf(req), parse(Month, req.query).month)));
  r.get("/clients/:id/summary", async (req, res) => {
    const pid = await scale.caClient(userIdOf(req), parse(id, req.params).id);
    res.json(await gst.summary(pid, parse(Month, req.query)));
  });
  r.get("/clients/:id/export.csv", async (req, res) => {
    const pid = await scale.caClient(userIdOf(req), parse(id, req.params).id);
    const file = await gst.csv(pid, parse(Month, req.query));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(`﻿${file.body}`);
  });
  r.get("/clients/:id/gstr1.json", async (req, res) => {
    const pid = await scale.caClient(userIdOf(req), parse(id, req.params).id);
    const file = await gst.gstr1(pid, parse(Month, req.query));
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.json(file.body);
  });
  return r;
}
