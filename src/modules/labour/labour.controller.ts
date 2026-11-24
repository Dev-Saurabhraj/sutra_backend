import { Router } from "express";
import { z } from "zod";
import { producerIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import type { LabourService } from "./labour.service.js";

const IdParam = z.object({ id: z.string().min(1).max(40) });
const Mode = z.enum(["CASH", "UPI", "BANK"]).default("CASH");

export const WorkerInput = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).optional().nullable(),
  skill: z.string().trim().max(40).optional().nullable(),
  wageType: z.enum(["DAILY", "PIECE", "MONTHLY"]),
  rate: z.number().positive().max(1_000_000),
  productId: z.string().max(40).optional().nullable(),
  payCycle: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("WEEKLY"),
});
const WorkerPatch = WorkerInput.partial().extend({ active: z.boolean().optional() });
const Attendance = z.object({
  date: z.coerce.date().optional(),
  marks: z.array(z.object({ workerId: z.string().min(1).max(40), units: z.union([z.literal(0), z.literal(0.5), z.literal(1)]) })).min(1).max(200),
});
const Piece = z.object({ qty: z.number().positive().max(100_000), productId: z.string().max(40).optional(), rate: z.number().positive().optional(), note: z.string().max(200).optional() });
const Pay = z.object({ mode: Mode, cash: z.number().nonnegative().optional() });
const Advance = z.object({ amount: z.number().positive().max(10_000_000), mode: Mode, note: z.string().max(200).optional() });

export function labourRouter(labour: LabourService): Router {
  const r = Router();

  r.get("/", async (req, res) => res.json(await labour.summary(producerIdOf(req))));
  r.post("/workers", async (req, res) => res.status(201).json(await labour.addWorker(producerIdOf(req), parse(WorkerInput, req.body))));
  r.patch("/workers/:id", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await labour.updateWorker(producerIdOf(req), id, parse(WorkerPatch, req.body)));
  });
  r.post("/attendance", async (req, res) => {
    const { marks, date } = parse(Attendance, req.body);
    res.json(await labour.markAttendance(producerIdOf(req), marks, date));
  });
  r.post("/workers/:id/piece", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.status(201).json(await labour.recordPieceWork(producerIdOf(req), { ...parse(Piece, req.body), workerId: id }));
  });
  r.get("/workers/:id/pay-preview", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await labour.payPreview(producerIdOf(req), id));
  });
  r.post("/workers/:id/pay", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.status(201).json(await labour.pay(producerIdOf(req), id, parse(Pay, req.body)));
  });
  r.post("/workers/:id/advance", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.status(201).json(await labour.giveAdvance(producerIdOf(req), id, parse(Advance, req.body)));
  });
  r.get("/workers/:id/history", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await labour.history(producerIdOf(req), id));
  });
  r.get("/workers/:id/slip", async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json(await labour.slip(producerIdOf(req), id));
  });

  return r;
}
