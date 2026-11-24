import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { BillService } from "./bill.service.js";

/** ~8 MB photo as base64. */
const MAX_BASE64 = 11_500_000;

const ScanBody = z.union([
  z.object({
    image: z.object({
      base64: z.string().min(100).max(MAX_BASE64, "Photo is too large (max 8 MB)"),
      mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    }),
  }),
  z.object({ sampleKey: z.string().min(1).max(20) }),
]);
const ConfirmBody = z.object({ materialIds: z.array(z.string().max(40).nullable()).max(50).optional() });
const IdParam = z.object({ id: z.string().min(1).max(40) });

export function billRouter(bills: BillService): Router {
  const r = Router();

  r.get("/samples", (_req, res) => res.json(bills.samples()));

  r.post("/scan", async (req, res) => {
    res.json(await bills.scan(producerIdOf(req), parse(ScanBody, req.body)));
  });

  r.post("/:id/confirm", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const { materialIds } = parse(ConfirmBody, req.body ?? {});
    res.status(201).json(await bills.confirm(producerIdOf(req), id, materialIds));
  });

  return r;
}
