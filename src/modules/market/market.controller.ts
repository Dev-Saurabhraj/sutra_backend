import { Router } from "express";
import { z } from "zod";
import { buyerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { MarketService } from "./market.service.js";

const id = z.string().min(1).max(40);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").transform((s) => new Date(`${s}T12:00:00.000Z`));
const BrowseQuery = z.object({
  q: z.string().trim().max(60).optional(),
  industry: z.string().max(20).optional(),
  cluster: z.string().max(40).optional(),
  category: z.string().max(60).optional(),
  maxPrice: z.coerce.number().positive().optional(),
});
const QuoteBody = z.object({ productId: id, qty: z.number().int().min(1).max(100_000), wantedBy: day });
const RequestBody = QuoteBody.extend({ note: z.string().trim().max(1000).optional(), split: z.boolean().default(false) });
const CodeParam = z.object({ code: z.string().regex(/^SUT-\d{3,8}$/) });
const Message = z.object({ text: z.string().trim().min(1).max(1000) });

/**
 * Buyer-facing routes. Browsing and quotes work for any logged-in account (a maker can look at the market too);
 * requests, orders and documents need a buyer account and are scoped to it.
 */
export function marketRouter(market: MarketService): Router {
  const r = Router();

  r.get("/products", async (req, res) => res.json(await market.browse(parse(BrowseQuery, req.query))));
  r.get("/products/:id", async (req, res) => res.json(await market.product(parse(z.object({ id }), req.params).id)));
  r.get("/makers/:slug", async (req, res) => res.json(await market.maker(parse(z.object({ slug: z.string().min(1).max(60) }), req.params).slug)));

  r.post("/quote", async (req, res) => {
    const body = parse(QuoteBody, req.body);
    const buyerState = req.auth?.buyerId ? ((await market.buyerState(req.auth.buyerId)) ?? null) : null;
    res.json(await market.quote(body, buyerState));
  });

  r.post("/requests", async (req, res) => res.status(201).json(await market.request(buyerIdOf(req), parse(RequestBody, req.body))));

  r.get("/orders", async (req, res) => res.json(await market.orders(buyerIdOf(req))));
  r.get("/orders/:code", async (req, res) => res.json(await market.order(buyerIdOf(req), parse(CodeParam, req.params).code)));
  r.post("/orders/:code/messages", async (req, res) => {
    const { code } = parse(CodeParam, req.params);
    res.status(201).json(await market.message(buyerIdOf(req), code, parse(Message, req.body).text));
  });
  r.get("/orders/:code/dispatch-photo", async (req, res) => {
    const photo = await market.dispatchPhoto(buyerIdOf(req), parse(CodeParam, req.params).code);
    res.type(photo.mediaType).set("Cache-Control", "private, max-age=86400").send(photo.bytes);
  });
  r.get("/invoices/:id/pdf", async (req, res) => {
    const file = await market.invoicePdf(buyerIdOf(req), parse(z.object({ id }), req.params).id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
    res.send(file.bytes);
  });

  return r;
}
