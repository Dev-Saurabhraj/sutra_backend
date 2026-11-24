import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors.js";
import { producerIdOf, userIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import { CONSENT_VERSION, needsOnboarding, type AuthService } from "../auth/auth.service.js";
import type { Repositories } from "../../data/unit-of-work.js";
import type { HomeService } from "./home.service.js";

const ConsentBody = z.object({ version: z.string().min(1).max(40) });
const LanguageBody = z.object({ language: z.enum(["hi", "en"]) });

export function meRouter(repos: Repositories, auth: AuthService, home: HomeService): Router {
  const r = Router();

  r.get("/me", async (req, res) => {
    const user = await repos.auth.findUserById(userIdOf(req));
    if (!user) throw AppError.unauthorized();
    // From the database, not the token: the token may predate onboarding.
    const producer = user.producerId ? await repos.producers.findProfile(user.producerId) : null;
    const buyer = user.buyerId ? await repos.market.buyer(user.buyerId) : null;
    const cluster = user.role === "CLUSTER_ADMIN" && user.clusterId ? await repos.producers.clusterBrief(user.clusterId) : null;
    res.json({
      user: {
        id: user.id, phone: user.phone, role: user.role, language: user.language,
        needsConsent: user.consentVersion !== CONSENT_VERSION, needsOnboarding: needsOnboarding(user),
      },
      producer,
      buyer,
      cluster,
      consentVersion: CONSENT_VERSION,
    });
  });

  r.post("/me/consent", async (req, res) => {
    const { version } = parse(ConsentBody, req.body);
    await auth.recordConsent(userIdOf(req), version);
    res.status(204).end();
  });

  r.put("/me/language", async (req, res) => {
    const { language } = parse(LanguageBody, req.body);
    await repos.auth.setLanguage(userIdOf(req), language);
    if (req.auth?.producerId) await repos.producers.updateLanguage(req.auth.producerId, language);
    res.status(204).end();
  });

  r.get("/home", async (req, res) => {
    res.json(await home.today(producerIdOf(req)));
  });

  return r;
}
