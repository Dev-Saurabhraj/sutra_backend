// Composition root: the only place that knows concrete classes. Everything else depends on what it is given.
import type { PrismaClient } from "@prisma/client";
import type { Env } from "./config/env.js";
import { createPrisma } from "./core/db.js";
import type { Logger } from "./core/logger.js";
import { createRepositories, PrismaUnitOfWork, type Repositories, type UnitOfWork } from "./data/unit-of-work.js";
import { EventBus } from "./events/event-bus.js";
import { ClaudeVoiceParser } from "./ai/claude-voice-parser.js";
import { RuleVoiceParser } from "./ai/rule-voice-parser.js";
import { FallbackVoiceParser, type VoiceParser } from "./ai/voice-parser.js";
import { systemClock, type Clock } from "./shared/time.js";
import { TokenService } from "./modules/auth/token.service.js";
import { LogOtpSender } from "./modules/auth/otp-sender.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { StockService } from "./modules/stock/stock.service.js";
import { registerLowStockWatcher } from "./modules/stock/low-stock.watcher.js";
import { InvoiceService } from "./modules/invoices/invoice.service.js";
import { VoiceService } from "./modules/voice/voice.service.js";
import { VoiceActionRegistry } from "./modules/voice/voice.registry.js";
import { KhataService } from "./modules/khata/khata.service.js";
import { AlertService } from "./modules/alerts/alert.service.js";
import { HomeService } from "./modules/producers/home.service.js";

export type Container = {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  repos: Repositories;
  uow: UnitOfWork;
  tokens: TokenService;
  auth: AuthService;
  stock: StockService;
  invoices: InvoiceService;
  voice: VoiceService;
  khata: KhataService;
  alerts: AlertService;
  home: HomeService;
};

export function buildContainer(env: Env, logger: Logger, clock: Clock = systemClock): Container {
  const prisma = createPrisma(env.DATABASE_URL);
  const repos = createRepositories(prisma);
  const uow = new PrismaUnitOfWork(prisma);
  const bus = new EventBus(logger);

  const voiceParser: VoiceParser = new FallbackVoiceParser(
    env.aiEnabled ? [new ClaudeVoiceParser(env.ANTHROPIC_API_KEY, logger), new RuleVoiceParser()] : [new RuleVoiceParser()],
  );

  const tokens = new TokenService(env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET);
  const devOtp = env.isDev && env.DEV_OTP ? env.DEV_OTP : null;
  const auth = new AuthService(repos.auth, tokens, new LogOtpSender(logger), clock, devOtp);

  const stock = new StockService(repos, repos.producers, clock);
  const invoices = new InvoiceService(repos.invoices);
  const voice = new VoiceService(repos, uow, voiceParser, VoiceActionRegistry.withDefaults(), invoices, bus, clock);
  const khata = new KhataService(repos.khata, repos.producers, clock);
  const alerts = new AlertService(repos.alerts);
  const home = new HomeService(repos, stock, clock);

  registerLowStockWatcher(bus, stock, repos.alerts);

  return { env, logger, prisma, repos, uow, tokens, auth, stock, invoices, voice, khata, alerts, home };
}
