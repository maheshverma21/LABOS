import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Hops to trust for X-Forwarded-For, so req.ip is the visitor. Next.js passes the header on unchanged. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Where patients open report links; defaults to WEB_ORIGIN. Must be public for WhatsApp media. */
  PUBLIC_BASE_URL: z.url().optional(),
  /** Encrypts labs' saved API keys. Defaults to a key derived from JWT_ACCESS_SECRET. */
  SECRETS_KEY: z.string().min(32).optional(),
  AISENSY_API_URL: z.url().default("https://backend.aisensy.com/campaign/t1/api/v2"),
  /** The platform's shared AiSensy account, for labs without their own. */
  AISENSY_API_KEY: z.string().optional(),
  AISENSY_CAMPAIGN: z.string().optional(),
  /** Outgoing email, e.g. smtps://user:pass@smtp.hostinger.com:465 or AWS SES SMTP. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("LabOS <no-reply@localhost>"),
  /** Development and tests: write emails as files here instead of sending them. */
  MAIL_DIR: z.string().optional(),
  /** Platform admins must set up two-step sign-in. On by default in production. */
  ADMIN_MFA_REQUIRED: z.enum(["true", "false"]).optional(),
  /** Send sign-in cookies only over HTTPS. On by default in production; off for a single PC on a local network over plain http. */
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables. Check apps/api/.env against .env.example:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : isProd;
export const adminMfaRequired = env.ADMIN_MFA_REQUIRED ? env.ADMIN_MFA_REQUIRED === "true" : isProd;

/** Where people open the app from: links in emails and WhatsApp point here. */
export const publicBaseUrl = () => (env.PUBLIC_BASE_URL ?? env.WEB_ORIGIN).replace(/\/+$/, "");
