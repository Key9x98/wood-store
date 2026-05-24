import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SECRET_ENCRYPTION_KEY: z
    .string()
    .length(64, 'SECRET_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
    .regex(/^[0-9a-f]+$/i, 'SECRET_ENCRYPTION_KEY must be hex'),
  SERVER_IP: z.string().ip(),
  ADMIN_EMAIL: z.string().email(),
  CLOUDFLARE_API_TOKEN: z.string().min(1),
  CLOUDFLARE_ZONE_ID: z.string().min(1),

  DNS_PROVIDER: z.enum(['cloudflare', 'mock']).default('cloudflare'),

  TEMPLATES_DIR: z.string().default('/var/lib/cms/templates'),
  TEMPLATES_STAGING_DIR: z.string().default('/var/lib/cms/staging'),

  // Codebase git repo (wood-store-frontend). Template import clones it here if
  // missing, drops the theme into <CODEBASE_DIR>/wp-content/themes/<slug>, then
  // commits + pushes to GIT_URLS on branch GIT_BRANCH.
  GIT_URLS: z.string().default(''),
  GIT_BRANCH: z.string().default('main'),
  CODEBASE_DIR: z.string().default('/var/www/html/codebase'),

  // Privileged MySQL account used to create per-site WordPress databases/users.
  // Needs global CREATE / CREATE USER / GRANT OPTION — distinct from DATABASE_URL.
  PROVISION_DB_HOST: z.string().default('127.0.0.1'),
  PROVISION_DB_PORT: z.coerce.number().int().positive().default(3306),
  PROVISION_DB_ADMIN_USER: z.string().default(''),
  PROVISION_DB_ADMIN_PASSWORD: z.string().default(''),

  // Pristine WordPress core copied into each new site at provision step C.
  WP_CORE_DIR: z.string().default(''),

  // Skip provision step I (Let's Encrypt) — for local/dev where the domain
  // has no public DNS. Step J smoke-tests over http instead of https.
  PROVISION_SKIP_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Comma-separated allowed CORS origins, or '*' for any (dev only).
  CORS_ORIGINS: z.string().default('*'),
  // Toggle /metrics (Prometheus exposition). Default on.
  METRICS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Auth endpoints rate limit per IP per window.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof schema>;
