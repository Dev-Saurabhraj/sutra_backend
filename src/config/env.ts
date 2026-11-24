import { z } from "zod";

/** Validated configuration. The process fails fast on a bad or missing variable. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGINS: z.string().default("*"),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  DEV_OTP: z.string().regex(/^\d{6}$/).optional().or(z.literal("")),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  SUTRA_AI: z.string().optional().default(""),
  // WhatsApp Cloud API (P28). Without a number id + token, replies are logged instead of sent.
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default(""),
  WHATSAPP_APP_SECRET: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_TOKEN: z.string().optional().default(""),
});

export type Env = z.infer<typeof EnvSchema> & {
  isDev: boolean;
  aiEnabled: boolean;
  corsOrigins: string[] | "*";
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" && env.CORS_ORIGINS.trim() === "*") {
    throw new Error("CORS_ORIGINS must list explicit origins in production");
  }
  return {
    ...env,
    isDev: env.NODE_ENV === "development",
    aiEnabled: env.ANTHROPIC_API_KEY.length > 0 && env.SUTRA_AI !== "off",
    corsOrigins: env.CORS_ORIGINS.trim() === "*" ? "*" : env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  };
}
