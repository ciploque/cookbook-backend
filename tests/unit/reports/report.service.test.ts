import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/database', () => ({
  prisma: {
    recipe: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    report: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../../../src/config/database';
import { createRecipeReport, listMyReports } from '../../../src/modules/reports/report.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockReporter = { id: 'reporter-uuid' };

// The recipe belongs to someone other than the reporter — the self-report guard
// compares these two authProviderIds.
const mockRecipe = {
  id: 'recipe-uuid',
  author: { authProviderId: 'user_author' },
};

const mockReport = {
  id: 'report-uuid',
  targetType: 'recipe',
  topic: 'spam',
  message: 'looks like an ad',
  status: 'pending',
  reporterId: 'reporter-uuid',
  recipeId: 'recipe-uuid',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  recipe: {
    id: 'recipe-uuid',
    slug: 'pasta-carbonara',
    title: 'Pasta Carbonara',
    coverImageUrl: null,
  },
};

beforeEach(() => vi.clearAllMocks());

// ─── createRecipeReport() ─────────────────────────────────────────────────────

describe('createRecipeReport()', () => {
  it('creates and returns the report', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockReporter as never);
    vi.mocked(prisma.report.create).mockResolvedValue(mockReport as never);

    const result = await createRecipeReport('user_reporter', 'recipe-uuid', {
      topic: 'spam',
      message: 'looks like an ad',
    });

    expect(prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetType: 'recipe',
          topic: 'spam',
          message: 'looks like an ad',
          reporterId: 'reporter-uuid',
          recipeId: 'recipe-uuid',
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 'report-uuid',
      targetType: 'recipe',
      topic: 'spam',
      status: 'pending',
    });
    expect(result.recipe).toMatchObject({ id: 'recipe-uuid', title: 'Pasta Carbonara' });
  });

  it('throws RECIPE_NOT_FOUND when the recipe does not exist', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(
      createRecipeReport('user_reporter', 'missing-id', { topic: 'spam' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'RECIPE_NOT_FOUND' });

    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when reporting your own recipe', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);

    // Same authProviderId as the recipe's author.
    await expect(
      createRecipeReport('user_author', 'recipe-uuid', { topic: 'spam' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    // The guard fires before the reporter is even resolved.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it('throws USER_NOT_FOUND when the reporter has no provisioned row', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      createRecipeReport('user_ghost', 'recipe-uuid', { topic: 'spam' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });

    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it('throws CONFLICT when the user has already reported the recipe', async () => {
    const { Prisma } = await import('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });

    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockReporter as never);
    vi.mocked(prisma.report.create).mockRejectedValue(p2002);

    await expect(
      createRecipeReport('user_reporter', 'recipe-uuid', { topic: 'spam' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('re-throws an unexpected create error untouched', async () => {
    const boom = new Error('connection lost');
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockReporter as never);
    vi.mocked(prisma.report.create).mockRejectedValue(boom);

    await expect(
      createRecipeReport('user_reporter', 'recipe-uuid', { topic: 'spam' }),
    ).rejects.toThrow('connection lost');
  });
});

// ─── listMyReports() ──────────────────────────────────────────────────────────

describe('listMyReports()', () => {
  it('returns the paginated reports filed by the authenticated user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockReporter as never);
    vi.mocked(prisma.report.count).mockResolvedValue(2);
    vi.mocked(prisma.report.findMany).mockResolvedValue([mockReport] as never);

    const result = await listMyReports('user_reporter', { page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'report-uuid', topic: 'spam' });
    expect(result.meta).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  it('scopes the query to the resolved reporter id', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockReporter as never);
    vi.mocked(prisma.report.count).mockResolvedValue(0);
    vi.mocked(prisma.report.findMany).mockResolvedValue([] as never);

    await listMyReports('user_reporter', { page: 2, limit: 10 });

    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reporterId: 'reporter-uuid' },
        skip: 10,
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(prisma.report.count).toHaveBeenCalledWith({
      where: { reporterId: 'reporter-uuid' },
    });
  });

  it('throws USER_NOT_FOUND when the user has no provisioned row', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(listMyReports('user_ghost', { page: 1, limit: 20 })).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });

    expect(prisma.report.findMany).not.toHaveBeenCalled();
  });
});
