import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { AppError } from "../errors.js";
import type { Logger } from "../logger.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path}`));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const appError = toAppError(err);
    if (appError.status >= 500) logger.error({ err, path: req.path }, "unhandled error");
    res.status(appError.status).json({
      error: { code: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) },
    });
  };
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return AppError.notFound("Record");
    if (err.code === "P2002") return AppError.conflict("DUPLICATE", "This record already exists");
  }
  if (err instanceof SyntaxError && "body" in err) return AppError.badRequest("BAD_JSON", "Request body is not valid JSON");
  return new AppError(500, "INTERNAL", "Something went wrong on our side. Please try again.");
}
