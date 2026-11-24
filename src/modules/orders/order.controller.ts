import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { OrderService } from "./order.service.js";

const CodeParam = z.object({ code: z.string().regex(/^SUT-\d{3,8}$/, "Order code looks like SUT-1042") });
const ListQuery = z.object({ tab: z.enum(["new", "active", "done"]).default("new") });
const Respond = z.object({ accept: z.boolean() });
const Dispatch = z.object({
  transporter: z.string().trim().max(60).optional(),
  lrNumber: z.string().trim().max(40).optional(),
  photo: z.object({ base64: z.string().min(100).max(11_500_000), mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]) }).optional(),
});
const Message = z.object({ text: z.string().trim().min(1).max(1000) });

export function orderRouter(orders: OrderService): Router {
  const r = Router();

  r.get("/", async (req, res) => res.json(await orders.inbox(producerIdOf(req), parse(ListQuery, req.query).tab)));

  r.get("/:code", async (req, res) => {
    const { code } = parse(CodeParam, req.params);
    res.json(await orders.detail(producerIdOf(req), code));
  });

  r.post("/:code/respond", async (req, res) => {
    const { code } = parse(CodeParam, req.params);
    res.json(await orders.respond(producerIdOf(req), code, parse(Respond, req.body).accept));
  });

  r.post("/:code/dispatch", async (req, res) => {
    const { code } = parse(CodeParam, req.params);
    res.json(await orders.dispatch(producerIdOf(req), code, parse(Dispatch, req.body)));
  });

  r.get("/:code/dispatch-photo", async (req, res) => {
    const { code } = parse(CodeParam, req.params);
    const photo = await orders.dispatchPhoto(producerIdOf(req), code);
    res.type(photo.mediaType).set("Cache-Control", "private, max-age=86400").send(photo.bytes);
  });

  r.post("/:code/deliver", async (req, res) => {
    const { code } = parse(CodeParam, req.params);
    res.json(await orders.deliver(producerIdOf(req), code));
  });

  r.post("/:code/messages", async (req, res) => {
    const { code } = parse(CodeParam, req.params);
    res.status(201).json(await orders.message(producerIdOf(req), code, parse(Message, req.body).text));
  });

  return r;
}
