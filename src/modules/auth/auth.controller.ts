import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { parse } from "../../core/http/validate.js";
import type { AuthService } from "./auth.service.js";

const PhoneBody = z.object({ phone: z.string().min(10).max(20) });
const VerifyBody = PhoneBody.extend({ code: z.string().regex(/^\d{6}$/, "Code is 6 digits") });
const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

export function authRouter(auth: AuthService, limiter: RequestHandler): Router {
  const r = Router();
  r.use(limiter);

  r.post("/otp/request", async (req, res) => {
    const { phone } = parse(PhoneBody, req.body);
    res.status(202).json(await auth.requestOtp(phone));
  });

  r.post("/otp/verify", async (req, res) => {
    const { phone, code } = parse(VerifyBody, req.body);
    res.json(await auth.verifyOtp(phone, code));
  });

  r.post("/refresh", async (req, res) => {
    const { refreshToken } = parse(RefreshBody, req.body);
    res.json(await auth.refresh(refreshToken));
  });

  r.post("/logout", async (req, res) => {
    const { refreshToken } = parse(RefreshBody, req.body);
    await auth.logout(refreshToken);
    res.status(204).end();
  });

  return r;
}
