import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_BASE_PATH: z.string().default('/api'),

  DATABASE_URL: z.string().url(),

  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_AUDIENCE: z.string().optional(),

  ALLOWED_ORIGINS: z.string().min(1),

  TRUSTED_IMAGE_DOMAINS: z.string().default(''),

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

export const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());

export const trustedImageDomains = env.TRUSTED_IMAGE_DOMAINS
  ? env.TRUSTED_IMAGE_DOMAINS.split(',').map((s) => s.trim())
  : [];

export const keycloakJwksUri = `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/certs`;
export const keycloakIssuer = `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}`;
