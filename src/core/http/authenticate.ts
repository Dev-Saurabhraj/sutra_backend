import type { Request, RequestHandler } from "express";
import { AppError } from "../errors.js";
import type { TokenService } from "../../modules/auth/token.service.js";

export type AuthContext = { userId: string; producerId: string | null; role: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Verifies the Bearer access token and puts the caller on `req.auth`. */
export function authenticate(tokens: TokenService): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return next(AppError.unauthorized());
    const claims = tokens.verifyAccess(token);
    req.auth = { userId: claims.sub, producerId: claims.pid, role: claims.role };
    next();
  };
}

/** The producer the caller acts for. Every producer query is scoped by this (RULES A7). */
export function producerIdOf(req: Request): string {
  const pid = req.auth?.producerId;
  if (!pid) throw AppError.forbidden("This account is not a producer account");
  return pid;
}

export function userIdOf(req: Request): string {
  const uid = req.auth?.userId;
  if (!uid) throw AppError.unauthorized();
  return uid;
}
