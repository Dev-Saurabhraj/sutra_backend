import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { CatalogService } from "./catalog.service.js";

const IdParam = z.object({ id: z.string().min(1).max(40) });
const Photo = z.object({
  base64: z.string().min(100).max(11_500_000, "Photo is too large (max 8 MB)"),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
});
const DraftBody = z.object({ note: z.string().trim().max(600).default(""), photo: Photo.optional() });
const UpdateBody = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    story: z.string().trim().max(1200).optional(),
    price: z.number().positive().max(10_000_000).optional(),
    published: z.boolean().optional(),
    acceptBelowCost: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== "acceptBelowCost"), "Nothing to change");

export function catalogRouter(catalog: CatalogService): Router {
  const r = Router();

  r.get("/", async (req, res) => res.json(await catalog.list(producerIdOf(req))));

  r.post("/:id/draft", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await catalog.draft(producerIdOf(req), id, parse(DraftBody, req.body ?? {})));
  });

  r.patch("/:id", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await catalog.update(producerIdOf(req), id, parse(UpdateBody, req.body)));
  });

  return r;
}
