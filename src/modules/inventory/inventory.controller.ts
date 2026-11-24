import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { InventoryService } from "./inventory.service.js";

const Id = z.string().min(1).max(40);
const IdParam = z.object({ id: Id });
const Qty = z.number().positive().max(1_000_000);
const Money = z.number().nonnegative().max(100_000_000);

export const MaterialInput = z.object({
  name: z.string().trim().min(1).max(80),
  nameHi: z.string().trim().max(80).optional(),
  unit: z.string().trim().min(1).max(12),
  hsn: z.string().trim().max(8).optional(),
  gstRate: z.number().min(0).max(28).optional(),
  costPerUnit: Money,
  stock: z.number().min(0).max(1_000_000).default(0),
  supplierId: Id.optional(),
});
export const ProductInput = z.object({
  name: z.string().trim().min(1).max(80),
  nameHi: z.string().trim().max(80).optional(),
  category: z.string().trim().max(40).optional(),
  price: Money,
  hsn: z.string().trim().max(8).optional(),
  gstRate: z.number().min(0).max(28).optional(),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  unitsPerMachinePerWeek: z.number().positive().max(10_000).optional(),
  recipe: z.array(z.object({ materialId: Id, qtyPerUnit: z.number().positive().max(10_000) })).max(20).default([]),
});
const SupplierInput = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).default(""),
  city: z.string().trim().max(40).default(""),
  state: z.string().trim().max(60).default(""),
  gstin: z.string().trim().max(15).optional(),
  leadTimeDays: z.number().int().min(0).max(120).default(7),
});
const ClientInput = z.object({
  name: z.string().trim().min(1).max(80),
  business: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(20).default(""),
  city: z.string().trim().max(40).default(""),
  state: z.string().trim().max(60).optional(),
  gstin: z.string().trim().max(15).optional(),
});
const StockIn = z.object({ qty: Qty, rate: Money.optional(), supplierId: Id.optional(), billNo: z.string().max(30).optional() });
const Produce = z.object({ qty: z.number().int().positive().max(100_000), workerId: Id.optional() });
const Sell = z.object({
  qty: z.number().int().positive().max(100_000),
  rate: Money.optional(),
  clientId: Id.optional(),
  walkIn: z.object({ name: z.string().trim().max(80).default(""), city: z.string().trim().max(40).default("") }).optional(),
});
const Adjust = z.object({ actual: z.number().min(0).max(1_000_000), reason: z.string().max(120).optional() });
const MovementQuery = z.object({ materialId: Id.optional(), productId: Id.optional(), limit: z.coerce.number().int().min(1).max(100).default(40) });

export function inventoryRouter(inventory: InventoryService): Router {
  const r = Router();

  r.get("/flow", async (req, res) => res.json(await inventory.flow(producerIdOf(req))));
  r.get("/movements", async (req, res) => {
    const { limit, ...filter } = parse(MovementQuery, req.query);
    res.json({ movements: await inventory.movements(producerIdOf(req), filter, limit) });
  });

  r.get("/suppliers", async (req, res) => res.json({ suppliers: await inventory.suppliers(producerIdOf(req)) }));
  r.post("/suppliers", async (req, res) => res.status(201).json(await inventory.addSupplier(producerIdOf(req), parse(SupplierInput, req.body))));
  r.get("/clients", async (req, res) => res.json({ clients: await inventory.clients(producerIdOf(req)) }));
  r.post("/clients", async (req, res) => res.status(201).json(await inventory.addClient(producerIdOf(req), parse(ClientInput, req.body))));

  r.post("/materials", async (req, res) => res.status(201).json(await inventory.addMaterial(producerIdOf(req), parse(MaterialInput, req.body))));
  r.post("/materials/:id/stock-in", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.status(201).json(await inventory.stockIn(producerIdOf(req), { ...parse(StockIn, req.body), materialId: id }));
  });
  r.post("/materials/:id/adjust", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await inventory.adjust(producerIdOf(req), { ...parse(Adjust, req.body), materialId: id }));
  });

  r.post("/products", async (req, res) => res.status(201).json(await inventory.addProduct(producerIdOf(req), parse(ProductInput, req.body))));
  r.post("/products/:id/produce", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.status(201).json(await inventory.produce(producerIdOf(req), { ...parse(Produce, req.body), productId: id }));
  });
  r.post("/products/:id/sell", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.status(201).json(await inventory.sell(producerIdOf(req), { ...parse(Sell, req.body), productId: id }));
  });
  r.post("/products/:id/adjust", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await inventory.adjust(producerIdOf(req), { ...parse(Adjust, req.body), productId: id }));
  });

  return r;
}
