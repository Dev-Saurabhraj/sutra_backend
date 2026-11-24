import express, { Router, type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { pinoHttp } from "pino-http";
import type { Container } from "./container.js";
import { authenticate } from "./core/http/authenticate.js";
import { errorHandler, notFoundHandler } from "./core/http/error-handler.js";
import { idempotent } from "./core/http/idempotency.js";
import { authRouter } from "./modules/auth/auth.controller.js";
import { meRouter } from "./modules/producers/producer.controller.js";
import { stockRouter } from "./modules/stock/stock.controller.js";
import { voiceRouter } from "./modules/voice/voice.controller.js";
import { khataRouter } from "./modules/khata/khata.controller.js";
import { alertRouter } from "./modules/alerts/alert.controller.js";
import { invoiceRouter } from "./modules/invoices/invoice.controller.js";
import { inventoryRouter } from "./modules/inventory/inventory.controller.js";
import { labourRouter } from "./modules/labour/labour.controller.js";
import { onboardingRouter } from "./modules/onboarding/onboarding.controller.js";
import { billRouter } from "./modules/bills/bill.controller.js";
import { gstRouter } from "./modules/gst/gst.controller.js";

export function createApp(c: Container): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: c.env.corsOrigins === "*" ? true : c.env.corsOrigins }));
  // bill photos arrive as base64; only that route accepts a large body
  app.use("/api/v1/bills/scan", express.json({ limit: "12mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger: c.logger, autoLogging: { ignore: (req) => req.url === "/health" } }));

  app.get("/health", async (_req, res) => {
    await c.prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, ai: c.env.aiEnabled ? "claude+rules" : "rules" });
  });

  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  const v1 = Router();
  v1.use("/auth", authRouter(c.auth, authLimiter));

  // Everything below needs a logged-in user.
  const secured = Router();
  secured.use(authenticate(c.tokens), idempotent(c.prisma));
  secured.use(meRouter(c.repos, c.auth, c.home));
  secured.use(onboardingRouter(c.onboarding));
  secured.use("/stock", stockRouter(c.stock));
  secured.use("/voice", voiceRouter(c.voice));
  secured.use("/khata", khataRouter(c.khata));
  secured.use("/alerts", alertRouter(c.alerts));
  secured.use("/invoices", invoiceRouter(c.invoices));
  secured.use("/inventory", inventoryRouter(c.inventory));
  secured.use("/labour", labourRouter(c.labour));
  secured.use("/bills", billRouter(c.bills));
  secured.use("/gst", gstRouter(c.gst));
  v1.use(secured);

  app.use("/api/v1", v1);
  app.use(notFoundHandler);
  app.use(errorHandler(c.logger));
  return app;
}
