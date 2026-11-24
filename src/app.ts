import path from "node:path";
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
import { orderRouter } from "./modules/orders/order.controller.js";
import { catalogRouter } from "./modules/catalog/catalog.controller.js";
import { CATALOG_FOLDER } from "./modules/catalog/catalog.service.js";

export function createApp(c: Container): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: c.env.corsOrigins === "*" ? true : c.env.corsOrigins }));
  // photos arrive as base64; only these routes accept a large body
  const bigJson = express.json({ limit: "12mb" });
  app.use("/api/v1/bills/scan", bigJson);
  app.use(/^\/api\/v1\/orders\/[^/]+\/dispatch$/, bigJson);
  app.use(/^\/api\/v1\/catalog\/[^/]+\/draft$/, bigJson);
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger: c.logger, autoLogging: { ignore: (req) => req.url === "/health" } }));

  app.get("/health", async (_req, res) => {
    await c.prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, ai: c.env.aiEnabled ? "claude+rules" : "rules" });
  });

  // Catalog photos are public (buyers browse without logging in); nothing else under uploads/ is.
  app.use(
    `/media/${CATALOG_FOLDER}`,
    (_req, res, next) => {
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      next();
    },
    express.static(path.join(c.uploadsDir, CATALOG_FOLDER), { maxAge: "30d", immutable: true, index: false, dotfiles: "deny" }),
  );

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
  secured.use("/orders", orderRouter(c.orders));
  secured.use("/catalog", catalogRouter(c.catalog));
  v1.use(secured);

  app.use("/api/v1", v1);
  app.use(notFoundHandler);
  app.use(errorHandler(c.logger));
  return app;
}
