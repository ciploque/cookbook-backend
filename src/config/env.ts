import { z } from 'zod';
import { assertProductionOrigins } from './envGuards';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_BASE_PATH: z.string().default('/api'),
  // Number of trusted reverse-proxy hops for `app.set('trust proxy')`. Must match the real
  // deployment topology so rate limiting keys off the true client IP and not a spoofable
  // X-Forwarded-For. 0 = don't trust the header at all (app directly reachable).
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  DATABASE_URL: z.string().url(),

  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1),

  ALLOWED_ORIGINS: z.string().min(1),

  TRUSTED_IMAGE_DOMAINS: z.string().default(''),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),

  MEILISEARCH_URL: z.string().url().default('http://localhost:7700'),
  MEILISEARCH_API_KEY: z.string().default('masterkey'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

const originsError = assertProductionOrigins(env.NODE_ENV, env.ALLOWED_ORIGINS);
if (originsError) {
  console.error(originsError);
  process.exit(1);
}

export const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());

export const trustedImageDomains = env.TRUSTED_IMAGE_DOMAINS
  ? env.TRUSTED_IMAGE_DOMAINS.split(',').map((s) => s.trim())
  : [];
