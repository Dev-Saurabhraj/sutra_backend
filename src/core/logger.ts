import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: { paths: ["req.headers.authorization", "*.refreshToken", "*.accessToken", "*.code"], censor: "[redacted]" },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
  });
}
