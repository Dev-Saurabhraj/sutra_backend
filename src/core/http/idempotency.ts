import type { PrismaClient, Prisma } from "@prisma/client";
import type { RequestHandler } from "express";
import { AppError } from "../errors.js";

const KEY = /^[A-Za-z0-9_-]{8,80}$/;

/**
 * Idempotency-Key support for mutating endpoints (RULES A4).
 * The first successful response is stored and replayed for retries with the same key.
 */
export function idempotent(prisma: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    const key = req.header("Idempotency-Key");
    const userId = req.auth?.userId;
    if (!key || !userId) return next();
    if (!KEY.test(key)) return next(AppError.badRequest("BAD_IDEMPOTENCY_KEY", "Idempotency-Key must be 8-80 letters, digits, - or _"));

    const route = `${req.method} ${req.baseUrl}${req.path}`;
    const existing = await prisma.idempotencyRecord.findUnique({ where: { userId_key: { userId, key } } });
    if (existing) {
      if (existing.route !== route) return next(AppError.conflict("IDEMPOTENCY_KEY_REUSED", "This key was used for a different request"));
      res.status(existing.statusCode).json(existing.response);
      return;
    }

    const send = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode < 300) {
        prisma.idempotencyRecord
          .create({ data: { userId, key, route, statusCode: res.statusCode, response: body as Prisma.InputJsonValue } })
          .catch(() => undefined); // a concurrent duplicate already stored it
      }
      return send(body);
    };
    next();
  };
}
