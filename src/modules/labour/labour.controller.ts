import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { LabourService } from "./labour.service.js";

const WorkerIdParam = z.object({ workerId: z.string().min(1).max(40) });
const AddWorkerBody = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).optional(),
  wageType: z.enum(["DAILY", "PIECE", "MONTHLY"]),
  rate: z.number().positive().max(10_000_000),
  payCycle: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("WEEKLY"),
});
const AttendanceBody = z.object({
  marks: z.array(z.object({ workerId: z.string().min(1).max(40), units: z.number().min(0).max(1) })).min(1).max(200),
});
const PieceBody = z.object({ qty: z.number().positive().max(100_000) });
const AdvanceBody = z.object({ amount: z.number().positive().max(10_000_000), mode: z.enum(["CASH", "UPI", "BANK"]) });
const PayBody = z.object({ mode: z.enum(["CASH", "UPI", "BANK"]), cash: z.number().positive().max(10_000_000).optional() });

export function labourRouter(labour: LabourService): Router {
  const r = Router();

  r.get("/", async (req, res) => {
    res.json(await labour.team(producerIdOf(req)));
  });

  r.post("/workers", async (req, res) => {
    const body = parse(AddWorkerBody, req.body);
    const worker = await labour.addWorker(producerIdOf(req), body);
    res.status(201).json({ worker });
  });

  r.post("/attendance", async (req, res) => {
    const { marks } = parse(AttendanceBody, req.body);
    res.json(await labour.attendance(producerIdOf(req), marks));
  });

  r.post("/workers/:workerId/piece", async (req, res) => {
    const { workerId } = parse(WorkerIdParam, req.params);
    const { qty } = parse(PieceBody, req.body);
    await labour.piece(producerIdOf(req), workerId, qty);
    res.status(201).json({ ok: true });
  });

  r.get("/workers/:workerId/pay-preview", async (req, res) => {
    const { workerId } = parse(WorkerIdParam, req.params);
    res.json(await labour.payPreview(producerIdOf(req), workerId));
  });

  r.post("/workers/:workerId/pay", async (req, res) => {
    const { workerId } = parse(WorkerIdParam, req.params);
    const { mode, cash } = parse(PayBody, req.body);
    res.json(await labour.pay(producerIdOf(req), workerId, mode, cash));
  });

  r.post("/workers/:workerId/advance", async (req, res) => {
    const { workerId } = parse(WorkerIdParam, req.params);
    const { amount, mode } = parse(AdvanceBody, req.body);
    await labour.advance(producerIdOf(req), workerId, amount, mode);
    res.status(201).json({ ok: true });
  });

  r.get("/workers/:workerId/history", async (req, res) => {
    const { workerId } = parse(WorkerIdParam, req.params);
    res.json(await labour.history(producerIdOf(req), workerId));
  });

  r.get("/workers/:workerId/slip", async (req, res) => {
    const { workerId } = parse(WorkerIdParam, req.params);
    res.json(await labour.slip(producerIdOf(req), workerId));
  });

  return r;
}
