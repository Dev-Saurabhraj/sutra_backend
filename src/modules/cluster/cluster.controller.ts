import { Router } from "express";
import { z } from "zod";
import { userIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { ClusterService } from "./cluster.service.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").transform((s) => new Date(`${s}T12:00:00.000Z`));
const Bulk = z.object({
  category: z.string().trim().min(2).max(60),
  qty: z.number().int().min(1).max(1_000_000),
  wantedBy: day,
  buyer: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Cluster admins only; every route is scoped to the admin's own cluster. */
export function clusterRouter(cluster: ClusterService): Router {
  const r = Router();
  const cid = (req: Parameters<typeof userIdOf>[0]) => cluster.clusterOf(userIdOf(req));

  r.get("/", async (req, res) => res.json(await cluster.overview(await cid(req))));
  r.post("/split", async (req, res) => res.json(await cluster.split(await cid(req), parse(Bulk, req.body))));
  r.post("/split/send", async (req, res) => res.status(201).json(await cluster.sendSplit(await cid(req), parse(Bulk, req.body))));
  r.get("/group-buy", async (req, res) => res.json(await cluster.groupBuy(await cid(req))));
  r.get("/compliance", async (req, res) => res.json(await cluster.compliance(await cid(req))));
  r.get("/impact", async (req, res) => res.json(await cluster.impact(await cid(req))));
  return r;
}
