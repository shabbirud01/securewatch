import 'dotenv/config';
import cron from 'node-cron';
import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated once, at
 * startup. A missing or malformed value stops the process immediately with a clear
 * message, instead of surfacing hours later as a confusing runtime error (for
 * example the first time a scheduled scan runs).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection string'),

  // API server. 127.0.0.1 = reachable from this machine only; Docker sets 0.0.0.0.
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

  // Scanning
  SCAN_CRON: z
    .string()
    .default('0 */6 * * *') // at minute 0 of every 6th hour
    .refine((expression) => cron.validate(expression), 'must be a valid cron expression, e.g. "0 */6 * * *"'),
  SCAN_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  SCAN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  // Off by default, so user-supplied hostnames can't be used to reach internal networks (SSRF).
  ALLOW_PRIVATE_TARGETS: z.stringbool().default(false),

  // Alert emails. Without SMTP_HOST, development mode uses a throwaway Ethereal inbox.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  // true: TLS from the first byte (port 465). false: plain start upgraded with STARTTLS (port 587).
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  ALERT_EMAIL_TO: z.string().optional(), // one address, or several separated by commas
  ALERT_EMAIL_FROM: z.string().default('SecureWatch <alerts@securewatch.local>'),
  // Where the dashboard runs; alert emails link to it.
  DASHBOARD_URL: z
    .url()
    .default('http://localhost:5173')
    .transform((url) => url.replace(/\/+$/, '')),
}).refine((env) => !env.SMTP_HOST || env.ALERT_EMAIL_TO, {
  error: 'is required when SMTP_HOST is set',
  path: ['ALERT_EMAIL_TO'],
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const config = parsed.data;
