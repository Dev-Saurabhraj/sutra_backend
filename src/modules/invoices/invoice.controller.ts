import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { InvoiceService } from "./invoice.service.js";

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });
const IdParam = z.object({ id: z.string().min(1).max(40) });

export function invoiceRouter(invoices: InvoiceService): Router {
  const r = Router();

  r.get("/", async (req, res) => {
    const { limit } = parse(ListQuery, req.query);
    res.json({ invoices: await invoices.list(producerIdOf(req), limit) });
  });

  r.get("/:id", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await invoices.get(producerIdOf(req), id));
  });

  return r;
}
