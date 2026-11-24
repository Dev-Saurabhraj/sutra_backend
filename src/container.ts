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
import { LabourService } from "./modules/labour/labour.service.js";
import { InventoryService } from "./modules/inventory/inventory.service.js";
import { OnboardingService } from "./modules/onboarding/onboarding.service.js";
import { InvoicePdfRenderer } from "./modules/invoices/invoice-pdf.js";
import { BillService } from "./modules/bills/bill.service.js";
import { FallbackBillReader, type BillReader } from "./modules/bills/bill-reader.js";
import { ClaudeBillReader } from "./modules/bills/claude-bill-reader.js";
import { SampleBillReader } from "./modules/bills/sample-bills.js";
import { GstService } from "./modules/gst/gst.service.js";
import { GstRepository } from "./modules/gst/gst.repository.js";
import { LocalFileStore, type FileStore } from "./core/file-store.js";
import { ClaudeTranslator, NoTranslator, type Translator } from "./ai/translator.js";
import { ClaudeStoryWriter, TemplateStoryWriter, type StoryWriter } from "./ai/story-writer.js";
import { OrderService } from "./modules/orders/order.service.js";
import { CatalogService } from "./modules/catalog/catalog.service.js";
import { SharpImageCleaner } from "./modules/catalog/image-cleaner.js";
import { QuoteService } from "./modules/quotes/quote.service.js";
import { CapacityService } from "./modules/capacity/capacity.service.js";
import { MarketService } from "./modules/market/market.service.js";
import { PriceWatch } from "./modules/stock/price-watch.js";
import { ClusterRepository } from "./modules/cluster/cluster.repository.js";
import { ClusterService } from "./modules/cluster/cluster.service.js";
import { CloudWhatsAppSender, LogWhatsAppSender, WhatsAppBot, type WhatsAppSender } from "./modules/whatsapp/whatsapp.js";
import { PrivacyService } from "./modules/privacy/privacy.service.js";

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
  labour: LabourService;
  inventory: InventoryService;
  onboarding: OnboardingService;
  bills: BillService;
  gst: GstService;
  orders: OrderService;
  catalog: CatalogService;
  capacity: CapacityService;
  market: MarketService;
  prices: PriceWatch;
  cluster: ClusterService;
  whatsapp: WhatsAppBot;
  privacy: PrivacyService;
  uploadsDir: string;
};

export function buildContainer(env: Env, logger: Logger, clock: Clock = systemClock, uploadsDir = "uploads"): Container {
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
  const invoices = new InvoiceService(repos.invoices, repos.producers, new InvoicePdfRenderer());
  const labour = new LabourService(repos, uow, clock);
  const prices = new PriceWatch(prisma);
  const inventory = new InventoryService(repos, uow, invoices, labour, stock, bus, clock, prices);
  const voice = new VoiceService(repos, uow, voiceParser, VoiceActionRegistry.withDefaults(), inventory, bus, clock);
  const khata = new KhataService(repos.khata, repos.producers, clock);
  const alerts = new AlertService(repos.alerts);
  const gst = new GstService(new GstRepository(prisma), repos, clock);
  const home = new HomeService(repos, stock, labour, inventory, gst, clock);
  const billReader: BillReader = new FallbackBillReader(
    env.aiEnabled ? [new ClaudeBillReader(env.ANTHROPIC_API_KEY, logger), new SampleBillReader(() => clock.now())] : [new SampleBillReader(() => clock.now())],
  );
  const files: FileStore = new LocalFileStore(uploadsDir);
  const bills = new BillService(repos, uow, billReader, files, clock, env.aiEnabled, prices);
  const translator: Translator = env.aiEnabled ? new ClaudeTranslator(env.ANTHROPIC_API_KEY, logger) : new NoTranslator();
  const storyWriter: StoryWriter = env.aiEnabled ? new ClaudeStoryWriter(env.ANTHROPIC_API_KEY, logger) : new TemplateStoryWriter();
  const quotes = new QuoteService(repos, clock);
  const orders = new OrderService(repos, uow, inventory, translator, quotes, files, clock);
  const capacity = new CapacityService(repos, quotes, clock);
  const market = new MarketService(repos, uow, quotes, invoices, translator, files, clock);
  const cluster = new ClusterService(new ClusterRepository(prisma), repos, uow, quotes, gst, clock);
  const waSender: WhatsAppSender = env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_TOKEN
    ? new CloudWhatsAppSender(env.WHATSAPP_PHONE_NUMBER_ID, env.WHATSAPP_TOKEN, logger)
    : new LogWhatsAppSender(logger);
  const whatsapp = new WhatsAppBot(repos, voice, waSender);
  const privacy = new PrivacyService(prisma, clock);
  const catalog = new CatalogService(repos, storyWriter, new SharpImageCleaner(), files);
  const onboarding = new OnboardingService(repos, uow, auth, clock);

  registerLowStockWatcher(bus, stock, repos.alerts);

  return { env, logger, prisma, repos, uow, tokens, auth, stock, invoices, voice, khata, alerts, home, labour, inventory, onboarding, bills, gst, orders, catalog, capacity, market, prices, cluster, whatsapp, privacy, uploadsDir };
}
