import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/database', () => ({
  prisma: {
    recipe: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../src/modules/tags/tag.service', () => ({
  upsertTags: vi.fn(),
}));

vi.mock('../../../src/utils/slugify', () => ({
  generateRecipeSlug: vi.fn(() => 'pasta-carbonara-abcd'),
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, '-')),
}));

vi.mock('../../../src/modules/recipes/recipe.search', () => ({
  indexRecipe: vi.fn(),
  updateIndexedRecipe: vi.fn(),
  deleteIndexedRecipe: vi.fn(),
  searchRecipesViaMeili: vi.fn(),
}));

import { prisma } from '../../../src/config/database';
import {
  deleteIndexedRecipe,
  indexRecipe,
  searchRecipesViaMeili,
  updateIndexedRecipe,
} from '../../../src/modules/recipes/recipe.search';
import { upsertTags } from '../../../src/modules/tags/tag.service';
import {
  getRecipeById,
  getRecipeByUsernameAndSlug,
  getRecipeAuthorKeycloakId,
  createRecipe,
  deleteRecipe,
  listRecipes,
  patchRecipe,
} from '../../../src/modules/recipes/recipe.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockAuthor = {
  id: 'author-uuid',
  keycloakId: 'kc-author',
  username: 'joao',
  displayName: 'João',
  avatarUrl: null,
};

const mockRecipeFull = {
  id: 'recipe-uuid',
  slug: 'pasta-carbonara-abcd',
  title: 'Pasta Carbonara',
  description: 'Classic Roman pasta dish',
  category: 'pasta',
  coverImageUrl: null,
  imageUrls: [],
  prepTimeMinutes: null,
  servings: null,
  difficulty: null,
  authorId: 'author-uuid',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  author: { id: 'author-uuid', username: 'joao', displayName: 'João', avatarUrl: null },
  ingredients: [{ id: 'ing-1', recipeId: 'recipe-uuid', name: 'Spaghetti', quantity: '400g', unit: null, notes: null, order: 0 }],
  steps: [{ id: 'step-1', recipeId: 'recipe-uuid', order: 1, instruction: 'Boil pasta', imageUrl: null }],
  recipeTags: [{ tag: { id: 'tag-1', name: 'italian', slug: 'italian' } }],
};

const mockRecipeListItem = {
  ...mockRecipeFull,
  description: 'Classic Roman pasta dish',
  author: { id: 'author-uuid', username: 'joao', displayName: 'João' },
};

beforeEach(() => vi.clearAllMocks());

// ─── getRecipeById ────────────────────────────────────────────────────────────

describe('getRecipeById()', () => {
  it('returns formatted recipe with tags array', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);

    const result = await getRecipeById('recipe-uuid');

    expect(result).toHaveProperty('tags', ['italian']);
    expect(result).not.toHaveProperty('recipeTags');
  });

  it('throws RECIPE_NOT_FOUND (404) when recipe does not exist', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(getRecipeById('missing-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });
  });
});

// ─── getRecipeByUsernameAndSlug ───────────────────────────────────────────────

describe('getRecipeByUsernameAndSlug()', () => {
  it('finds recipe by author username and slug', async () => {
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue(mockRecipeFull as never);

    const result = await getRecipeByUsernameAndSlug('joao', 'pasta-carbonara-abcd');

    expect(prisma.recipe.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'pasta-carbonara-abcd', author: { username: 'joao' } },
      }),
    );
    expect(result).toHaveProperty('slug', 'pasta-carbonara-abcd');
  });

  it('throws RECIPE_NOT_FOUND when no match', async () => {
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue(null);

    await expect(getRecipeByUsernameAndSlug('joao', 'wrong-slug')).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });
  });

  it('throws RECIPE_NOT_FOUND when username does not match', async () => {
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue(null);

    await expect(getRecipeByUsernameAndSlug('wrong-user', 'pasta-carbonara-abcd')).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });
  });
});

// ─── getRecipeAuthorKeycloakId ────────────────────────────────────────────────

describe('getRecipeAuthorKeycloakId()', () => {
  it('returns the keycloakId of the recipe author', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      author: { keycloakId: 'kc-author' },
    } as never);

    const result = await getRecipeAuthorKeycloakId('recipe-uuid');
    expect(result).toBe('kc-author');
  });

  it('returns null when recipe does not exist', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    const result = await getRecipeAuthorKeycloakId('missing-id');
    expect(result).toBeNull();
  });
});

// ─── createRecipe ─────────────────────────────────────────────────────────────

describe('createRecipe()', () => {
  it('throws USER_NOT_FOUND when author does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      createRecipe('kc-unknown', {
        title: 'Test', description: 'desc', category: 'cat',
        tags: [], ingredients: [], steps: [],
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });

    expect(prisma.recipe.create).not.toHaveBeenCalled();
  });

  it('creates recipe with generated slug and upserted tags', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(upsertTags).mockResolvedValue([{ id: 'tag-1', name: 'italian', slug: 'italian' }]);
    vi.mocked(prisma.recipe.create).mockResolvedValue(mockRecipeFull as never);

    const result = await createRecipe('kc-author', {
      title: 'Pasta Carbonara',
      description: 'Classic Roman pasta dish',
      category: 'pasta',
      tags: ['italian'],
      ingredients: [{ name: 'Spaghetti', quantity: '400g' }],
      steps: [{ order: 1, instruction: 'Boil pasta' }],
    });

    expect(upsertTags).toHaveBeenCalledWith(['italian']);
    expect(prisma.recipe.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'pasta-carbonara-abcd',
          authorId: 'author-uuid',
        }),
      }),
    );
    expect(result).toHaveProperty('tags', ['italian']);
    expect(indexRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'recipe-uuid',
        title: 'Pasta Carbonara',
        authorId: 'author-uuid',
        tags: ['italian'],
      }),
    );
  });

  it('assigns order indices to ingredients in array order', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(upsertTags).mockResolvedValue([]);
    vi.mocked(prisma.recipe.create).mockResolvedValue({ ...mockRecipeFull, recipeTags: [] } as never);

    await createRecipe('kc-author', {
      title: 'Test',
      description: 'desc',
      category: 'cat',
      tags: [],
      ingredients: [
        { name: 'Flour', quantity: '200g' },
        { name: 'Eggs', quantity: '2' },
      ],
      steps: [],
    });

    const createCall = vi.mocked(prisma.recipe.create).mock.calls[0][0];
    expect(createCall.data.ingredients.create[0]).toMatchObject({ name: 'Flour', order: 0 });
    expect(createCall.data.ingredients.create[1]).toMatchObject({ name: 'Eggs', order: 1 });
  });
});

// ─── deleteRecipe ─────────────────────────────────────────────────────────────

describe('deleteRecipe()', () => {
  it('deletes the recipe when it exists', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    vi.mocked(prisma.recipe.delete).mockResolvedValue(mockRecipeFull as never);

    await deleteRecipe('recipe-uuid');

    expect(prisma.recipe.delete).toHaveBeenCalledWith({ where: { id: 'recipe-uuid' } });
    expect(deleteIndexedRecipe).toHaveBeenCalledWith('recipe-uuid');
  });

  it('throws RECIPE_NOT_FOUND before attempting delete', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(deleteRecipe('missing-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });

    expect(prisma.recipe.delete).not.toHaveBeenCalled();
    expect(deleteIndexedRecipe).not.toHaveBeenCalled();
  });
});

// ─── patchRecipe ──────────────────────────────────────────────────────────────

describe('patchRecipe()', () => {
  it('calls updateIndexedRecipe after a successful patch', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    vi.mocked(upsertTags).mockResolvedValue([{ id: 'tag-1', name: 'italian', slug: 'italian' }]);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        recipeIngredient: { deleteMany: vi.fn() },
        recipeStep: { deleteMany: vi.fn() },
        recipeTag: { deleteMany: vi.fn() },
        recipe: { update: vi.fn().mockResolvedValue(mockRecipeFull) },
      } as never),
    );

    await patchRecipe('recipe-uuid', { title: 'Updated Title', tags: ['italian'] });

    expect(updateIndexedRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'recipe-uuid' }),
    );
  });

  it('throws RECIPE_NOT_FOUND and does not call updateIndexedRecipe', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(patchRecipe('missing-id', {})).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });

    expect(updateIndexedRecipe).not.toHaveBeenCalled();
  });
});

// ─── listRecipes ──────────────────────────────────────────────────────────────

describe('listRecipes()', () => {
  it('returns paginated results with correct meta', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(45);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([mockRecipeListItem] as never);

    const result = await listRecipes({
      page: 2, limit: 20, sortBy: 'createdAt', order: 'desc',
    });

    expect(result.meta).toMatchObject({
      page: 2, limit: 20, total: 45, totalPages: 3,
      hasNextPage: true, hasPrevPage: true,
    });
    expect(result.data).toHaveLength(1);
  });

  it('truncates description to 200 characters', async () => {
    const longDesc = 'a'.repeat(300);
    vi.mocked(prisma.recipe.count).mockResolvedValue(1);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      { ...mockRecipeListItem, description: longDesc, recipeTags: [] },
    ] as never);

    const result = await listRecipes({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' });

    expect(result.data[0].description).toHaveLength(200);
  });

  it('maps recipeTags to a flat tags array', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(1);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([mockRecipeListItem] as never);

    const result = await listRecipes({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' });

    expect(result.data[0]).toHaveProperty('tags', ['italian']);
    expect(result.data[0]).not.toHaveProperty('recipeTags');
  });

  it('filters by tag slugs when tags query param is provided', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(0);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([]);

    await listRecipes({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc', tags: 'italian,pasta' });

    const whereArg = vi.mocked(prisma.recipe.count).mock.calls[0][0]?.where;
    expect(whereArg).toHaveProperty('AND');
  });

  it('delegates to searchRecipesViaMeili when q is provided', async () => {
    const query = { q: 'carbonara', page: 1, limit: 20, sortBy: 'createdAt' as const, order: 'desc' as const };
    vi.mocked(searchRecipesViaMeili).mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false },
    });

    await listRecipes(query);

    expect(searchRecipesViaMeili).toHaveBeenCalledWith(query);
    expect(prisma.recipe.count).not.toHaveBeenCalled();
  });
});
