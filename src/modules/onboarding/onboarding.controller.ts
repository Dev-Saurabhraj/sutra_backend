import { Router } from "express";
import { userIdOf } from "../../core/http/authenticate.js";
import { parse } from "../../core/http/validate.js";
import { BuyerOnboardingInput, OnboardingInput, type OnboardingService } from "./onboarding.service.js";

export function onboardingRouter(onboarding: OnboardingService): Router {
  const r = Router();

  r.get("/industries", (_req, res) => {
    res.json({ industries: onboarding.industries() });
  });

  /** Returns a fresh session: the new access token carries the producer id. */
  r.post("/onboarding", async (req, res) => {
    res.status(201).json(await onboarding.complete(userIdOf(req), parse(OnboardingInput, req.body)));
  });

  r.post("/onboarding/buyer", async (req, res) => {
    res.status(201).json(await onboarding.completeBuyer(userIdOf(req), parse(BuyerOnboardingInput, req.body)));
  });

  return r;
}
