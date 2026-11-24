import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { StockService } from "./stock.service.js";

const IdParam = z.object({ id: z.string().min(1).max(40) });
const ReorderBody = z.object({ qty: z.number().positive().max(100_000) });

export function stockRouter(stock: StockService): Router {
  const r = Router();

  r.get("/materials", async (req, res) => {
    res.json({ materials: await stock.health(producerIdOf(req)) });
  });

  r.get("/products", async (req, res) => {
    res.json({ products: await stock.products(producerIdOf(req)) });
  });

  r.post("/materials/:id/reorder", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const { qty } = parse(ReorderBody, req.body);
    res.status(201).json(await stock.reorder(producerIdOf(req), id, qty));
  });

  return r;
}
