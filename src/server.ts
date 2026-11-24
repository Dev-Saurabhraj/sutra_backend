import { loadEnv } from "./config/env.js";
import { createLogger } from "./core/logger.js";
import { buildContainer } from "./container.js";
import { createApp } from "./app.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.isDev);
const container = buildContainer(env, logger);
const app = createApp(container);

const server = app.listen(env.PORT, () => {
  logger.info(`Sutra API on http://localhost:${env.PORT} (${env.NODE_ENV}, AI: ${env.aiEnabled ? "Claude + rules" : "rules only"})`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await container.prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
