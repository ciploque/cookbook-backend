import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { Application } from 'express';

vi.mock('../../../src/config/env', () => ({
  env: {
    NODE_ENV: 'development',
    API_BASE_PATH: '/api',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    PORT: 3000,
    LOG_LEVEL: 'info',
    MEILISEARCH_URL: 'http://localhost:7700',
    MEILISEARCH_API_KEY: 'masterkey',
  },
  allowedOrigins: ['http://localhost:3000'],
  trustedImageDomains: [],
  keycloakJwksUri: 'https://auth.example.com/realms/test/protocol/openid-connect/certs',
  keycloakIssuer: 'https://auth.example.com/realms/test',
}));

vi.mock('../../../src/config/database', () => ({
  prisma: { $queryRaw: vi.fn() },
}));

vi.mock('../../../src/config/keycloak', () => ({
  keycloakIssuer: 'https://auth.example.com/realms/test',
  keycloakJwksUri: 'https://auth.example.com/realms/test/protocol/openid-connect/certs',
  jwksClient: { getSigningKey: vi.fn() },
}));

// ── Route extraction helpers ──────────────────────────────────────────────────

type RouteEntry = { method: string; path: string };

function extractMountPath(layer: any): string {
  if (layer.regexp.fast_slash || layer.regexp.fast_star) return '';
  // Express regexp source for '/api/v1/users' is: ^\/api\/v1\/users\/?(?=\/|$)
  // 1. Strip leading '^', 2. Strip '\/?...' suffix, 3. Unescape '\/' → '/'
  return layer.regexp.source
    .slice(1)
    .replace(/\\\/\?.*$/, '')
    .replace(/\\\//g, '/');
}

function extractRoutes(app: Application): RouteEntry[] {
  const routes: RouteEntry[] = [];

  function processLayer(layer: any, prefix: string) {
    if (layer.route) {
      const routePath = prefix + (layer.route.path === '/' ? '' : layer.route.path);
      for (const [method, active] of Object.entries(layer.route.methods)) {
        if (active) {
          routes.push({ method: (method as string).toUpperCase(), path: routePath || '/' });
        }
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      const mountPath = extractMountPath(layer);
      for (const subLayer of layer.handle.stack) {
        processLayer(subLayer, prefix + mountPath);
      }
    }
  }

  const router = (app as any)._router;
  if (router?.stack) {
    for (const layer of router.stack) {
      processLayer(layer, '');
    }
  }

  return routes;
}

function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([^/]+)/g, '{$1}');
}

// ── Test ─────────────────────────────────────────────────────────────────────

describe('OpenAPI documentation coverage', () => {
  let appRoutes: RouteEntry[];
  let docPaths: Record<string, Record<string, unknown>>;

  beforeAll(async () => {
    const { createApp } = await import('../../../src/app');
    const { buildOpenApiDocument } = await import('../../../src/docs/openapi');
    appRoutes = extractRoutes(createApp());
    docPaths = (buildOpenApiDocument().paths ?? {}) as Record<string, Record<string, unknown>>;
  });

  it('every registered Express route has an entry in the OpenAPI spec', () => {
    const undocumented = appRoutes
      .filter(({ path }) => !path.startsWith('/api-docs')) // docs infrastructure routes
      .map(({ method, path }) => ({ method, path, openApiPath: toOpenApiPath(path) }))
      .filter(({ method, openApiPath }) => !docPaths[openApiPath]?.[method.toLowerCase()])
      .map(({ method, path }) => `${method} ${path}`);

    expect(undocumented).toEqual([]);
  });
});
