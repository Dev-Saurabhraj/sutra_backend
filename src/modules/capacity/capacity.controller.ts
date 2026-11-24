import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { CapacityService } from "./capacity.service.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").transform((s) => new Date(`${s}T00:00:00.000Z`));
const NewEvent = z.object({
  kind: z.enum(["HOLIDAY", "FESTIVAL", "WEDDING", "POWER_CUT", "ABSENCE", "REPAIR", "OTHER"]),
  startsOn: day,
  endsOn: day,
  machinesOff: z.number().int().min(1).max(10_000).optional(),
  note: z.string().trim().max(120).optional(),
});
const IdParam = z.object({ id: z.string().min(1).max(40) });

export function capacityRouter(capacity: CapacityService): Router {
  const r = Router();
  r.get("/", async (req, res) => res.json(await capacity.calendar(producerIdOf(req))));
  r.post("/", async (req, res) => res.status(201).json(await capacity.add(producerIdOf(req), parse(NewEvent, req.body))));
  r.delete("/:id", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await capacity.remove(producerIdOf(req), id));
  });
  return r;
}
