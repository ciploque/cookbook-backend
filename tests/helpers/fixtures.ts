import { PrismaClient } from '@prisma/client';

export function buildUser(overrides: Partial<Parameters<PrismaClient['user']['create']>[0]['data']> = {}) {
  return {
    keycloakId: `kc-${Math.random().toString(36).slice(2)}`,
    displayName: 'Test User',
    ...overrides,
  };
}

export function buildRecipe(authorId: string, overrides: Record<string, unknown> = {}) {
  return {
    slug: `test-recipe-${Math.random().toString(36).slice(2)}`,
    title: 'Test Recipe',
    description: 'A test recipe description',
    category: 'test',
    authorId,
    ...overrides,
  };
}
