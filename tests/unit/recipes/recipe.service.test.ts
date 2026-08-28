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
    // Read by resolveViewerState() on the two detail GETs — not a cross-module import,
    // both hang off relations declared on Recipe itself.
    review: {
      findFirst: vi.fn(),
    },
    collectionRecipe: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    recipeCategory: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../../../src/modules/tags/tag.service', () => ({
  upsertTags: vi.fn(),
}));

// Categories are curated: the service resolves slugs against the Category table and throws
// 422 on an unknown one, so it's stubbed here the same way tag upsert is.
vi.mock('../../../src/modules/categories/category.service', () => ({
  resolveCategories: vi.fn(),
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

vi.mock('../../../src/modules/storage/storage.service', () => ({
  storeImage: vi.fn(),
  deleteImage: vi.fn(),
}));

import { Prisma } from '@prisma/client';
import { prisma } from '../../../src/config/database';
import { ApiError } from '../../../src/utils/ApiError';
import {
  deleteIndexedRecipe,
  indexRecipe,
  searchRecipesViaMeili,
  updateIndexedRecipe,
} from '../../../src/modules/recipes/recipe.search';
import { upsertTags } from '../../../src/modules/tags/tag.service';
import { resolveCategories } from '../../../src/modules/categories/category.service';
import { deleteImage, storeImage } from '../../../src/modules/storage/storage.service';
import {
  addGalleryImages,
  deleteCoverImage,
  getRecipeById,
  getRecipeByUsernameAndSlug,
  getRecipeAuthorId,
  createRecipe,
  deleteRecipe,
  listRecipes,
  listRecipesByUser,
  patchRecipe,
  removeGalleryImages,
  updateRecipe,
  uploadCoverImage,
} from '../../../src/modules/recipes/recipe.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockAuthor = {
  id: 'author-uuid',
  authProviderId: 'user_author',
  username: 'joao',
  displayName: 'João',
  avatarUrl: null,
};

const mockRecipeFull = {
  id: 'recipe-uuid',
  slug: 'pasta-carbonara-abcd',
  title: 'Pasta Carbonara',
  description: 'Classic Roman pasta dish',
  authorNote: 'A family favorite',
  coverImageUrl: null,
  imageUrls: [],
  videoUrl: null,
  prepTimeMinutes: null,
  servings: null,
  difficulty: null,
  authorId: 'author-uuid',
  averageRating: null,
  reviewCount: 0,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  author: { id: 'author-uuid', username: 'joao', displayName: 'João', avatarUrl: null },
  ingredients: [{ id: 'ing-1', recipeId: 'recipe-uuid', name: 'Spaghetti', quantity: 400, unit: null, notes: null, order: 0 }],
  steps: [{ id: 'step-1', recipeId: 'recipe-uuid', order: 1, instruction: 'Boil pasta', imageUrl: null }],
  recipeTags: [{ tag: { id: 'tag-1', name: 'italian', slug: 'italian' } }],
  recipeCategories: [{ category: { id: 'cat-1', name: 'Pasta', slug: 'pasta' } }],
};

const mockRecipeListItem = {
  ...mockRecipeFull,
  description: 'Classic Roman pasta dish',
  author: { id: 'author-uuid', username: 'joao', displayName: 'João' },
};

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets calls but not implementations, and every write path awaits this —
  // an unset mock resolves to undefined and blows up on `.map`. Re-established per test so a
  // case that makes it throw (unknown category) can't leak into the next one.
  vi.mocked(resolveCategories).mockResolvedValue([]);
});

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

  it('returns false viewer state without querying when the caller is anonymous', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);

    const result = await getRecipeById('recipe-uuid');

    expect(result).toMatchObject({ hasReviewed: false, isSavedInCollection: false });
    expect(prisma.review.findFirst).not.toHaveBeenCalled();
    expect(prisma.collectionRecipe.findFirst).not.toHaveBeenCalled();
  });

  it('returns both flags true when the viewer reviewed and saved the recipe', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    vi.mocked(prisma.review.findFirst).mockResolvedValue({ id: 'review-uuid' } as never);
    vi.mocked(prisma.collectionRecipe.findFirst).mockResolvedValue({
      recipeId: 'recipe-uuid',
    } as never);

    const result = await getRecipeById('recipe-uuid', 'user_viewer');

    expect(result).toMatchObject({ hasReviewed: true, isSavedInCollection: true });
  });

  it('returns both flags false when the viewer has neither reviewed nor saved', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    vi.mocked(prisma.review.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.collectionRecipe.findFirst).mockResolvedValue(null);

    const result = await getRecipeById('recipe-uuid', 'user_viewer');

    expect(result).toMatchObject({ hasReviewed: false, isSavedInCollection: false });
  });

  it('scopes both viewer lookups by recipe id and the caller authProviderId', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    vi.mocked(prisma.review.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.collectionRecipe.findFirst).mockResolvedValue(null);

    await getRecipeById('recipe-uuid', 'user_viewer');

    expect(prisma.review.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipeId: 'recipe-uuid', author: { authProviderId: 'user_viewer' } },
      }),
    );
    // Owned collections only — a followed collection is not "saved".
    expect(prisma.collectionRecipe.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          recipeId: 'recipe-uuid',
          collection: { owner: { authProviderId: 'user_viewer' } },
        },
      }),
    );
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

  it('carries the same viewer state as getRecipeById', async () => {
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue(mockRecipeFull as never);
    vi.mocked(prisma.review.findFirst).mockResolvedValue({ id: 'review-uuid' } as never);
    vi.mocked(prisma.collectionRecipe.findFirst).mockResolvedValue(null);

    const result = await getRecipeByUsernameAndSlug('joao', 'pasta-carbonara-abcd', 'user_viewer');

    expect(result).toMatchObject({ hasReviewed: true, isSavedInCollection: false });
  });

  it('returns false viewer state for an anonymous caller', async () => {
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue(mockRecipeFull as never);

    const result = await getRecipeByUsernameAndSlug('joao', 'pasta-carbonara-abcd');

    expect(result).toMatchObject({ hasReviewed: false, isSavedInCollection: false });
    expect(prisma.review.findFirst).not.toHaveBeenCalled();
    expect(prisma.collectionRecipe.findFirst).not.toHaveBeenCalled();
  });
});

// ─── getRecipeAuthorId ────────────────────────────────────────────────────────

describe('getRecipeAuthorId()', () => {
  it('returns the authProviderId of the recipe author', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      author: { authProviderId: 'user_author' },
    } as never);

    const result = await getRecipeAuthorId('recipe-uuid');
    expect(result).toBe('user_author');
  });

  it('returns null when recipe does not exist', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    const result = await getRecipeAuthorId('missing-id');
    expect(result).toBeNull();
  });
});

// ─── createRecipe ─────────────────────────────────────────────────────────────

describe('createRecipe()', () => {
  it('throws USER_NOT_FOUND when author does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      createRecipe('user_unknown', {
        title: 'Test', description: 'desc',
        tags: [], categories: [], ingredients: [], steps: [],
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });

    expect(prisma.recipe.create).not.toHaveBeenCalled();
  });

  it('creates recipe with generated slug, upserted tags and resolved categories', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(upsertTags).mockResolvedValue([{ id: 'tag-1', name: 'italian', slug: 'italian' }]);
    vi.mocked(resolveCategories).mockResolvedValue([
      { id: 'cat-1', name: 'Pasta', slug: 'pasta' },
    ]);
    vi.mocked(prisma.recipe.create).mockResolvedValue(mockRecipeFull as never);

    const result = await createRecipe('user_author', {
      title: 'Pasta Carbonara',
      description: 'Classic Roman pasta dish',
      authorNote: 'A family favorite',
      categories: ['pasta'],
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      tags: ['italian'],
      ingredients: [{ name: 'Spaghetti', quantity: 400 }],
      steps: [{ order: 1, instruction: 'Boil pasta' }],
    });

    expect(upsertTags).toHaveBeenCalledWith(['italian']);
    expect(resolveCategories).toHaveBeenCalledWith(['pasta']);
    expect(prisma.recipe.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'pasta-carbonara-abcd',
          authorId: 'author-uuid',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          authorNote: 'A family favorite',
          // Linked through the join table, by resolved row id — never a raw string.
          recipeCategories: { create: [{ categoryId: 'cat-1' }] },
        }),
      }),
    );
    expect(result).toHaveProperty('tags', ['italian']);
    expect(result).toHaveProperty('categories', ['pasta']);
    expect(indexRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'recipe-uuid',
        title: 'Pasta Carbonara',
        authorId: 'author-uuid',
        authorNote: 'A family favorite',
        tags: ['italian'],
        categories: ['pasta'],
      }),
    );
  });

  it('rejects an unknown category with 422 before writing anything', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(upsertTags).mockResolvedValue([]);
    vi.mocked(resolveCategories).mockRejectedValue(
      ApiError.validation({ categories: ['Unknown category: nope'] }),
    );

    await expect(
      createRecipe('user_author', {
        title: 'Test', description: 'desc',
        tags: [], categories: ['nope'], ingredients: [], steps: [],
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });

    // Resolved before the create, so a bad slug leaves no half-written recipe behind.
    expect(prisma.recipe.create).not.toHaveBeenCalled();
    expect(indexRecipe).not.toHaveBeenCalled();
  });

  it('assigns order indices to ingredients in array order', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(upsertTags).mockResolvedValue([]);
    vi.mocked(prisma.recipe.create).mockResolvedValue({ ...mockRecipeFull, recipeTags: [] } as never);

    await createRecipe('user_author', {
      title: 'Test',
      description: 'desc',
      categories: [],
      tags: [],
      ingredients: [
        { name: 'Flour', quantity: 200 },
        { name: 'Eggs', quantity: 2 },
      ],
      steps: [],
    });

    const createCall = vi.mocked(prisma.recipe.create).mock.calls[0][0];
    const created = createCall.data.ingredients?.create as { name: string; order: number }[];
    expect(created[0]).toMatchObject({ name: 'Flour', order: 0 });
    expect(created[1]).toMatchObject({ name: 'Eggs', order: 1 });
  });

  it('throws CONFLICT (409) when the [authorId, slug] unique constraint is violated', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(upsertTags).mockResolvedValue([]);
    vi.mocked(prisma.recipe.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['authorId', 'slug'] },
      }),
    );

    await expect(
      createRecipe('user_author', {
        title: 'Pasta Carbonara', description: 'desc',
        tags: [], categories: [], ingredients: [], steps: [],
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    expect(indexRecipe).not.toHaveBeenCalled();
  });

  it('re-throws unexpected errors from prisma.recipe.create', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(upsertTags).mockResolvedValue([]);
    vi.mocked(prisma.recipe.create).mockRejectedValue(new Error('DB connection lost'));

    await expect(
      createRecipe('user_author', {
        title: 'Test', description: 'desc',
        tags: [], categories: [], ingredients: [], steps: [],
      }),
    ).rejects.toThrow('DB connection lost');
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

  it('cleans up the cover and gallery R2 objects after deleting', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      ...mockRecipeFull,
      coverImageUrl: '/recipes/recipe-uuid/cover/old.jpg',
      imageUrls: ['/recipes/recipe-uuid/gallery/a.jpg', '/recipes/recipe-uuid/gallery/b.jpg'],
    } as never);
    vi.mocked(prisma.recipe.delete).mockResolvedValue(mockRecipeFull as never);

    await deleteRecipe('recipe-uuid');

    expect(deleteImage).toHaveBeenCalledWith('/recipes/recipe-uuid/cover/old.jpg');
    expect(deleteImage).toHaveBeenCalledWith('/recipes/recipe-uuid/gallery/a.jpg');
    expect(deleteImage).toHaveBeenCalledWith('/recipes/recipe-uuid/gallery/b.jpg');
  });
});

// ─── updateRecipe ─────────────────────────────────────────────────────────────

// PUT is a full replace: children are wiped and recreated inside one transaction. These
// mocks expose the individual tx delegates so the replace can be asserted step by step.
function mockUpdateTransaction() {
  const ingredientDeleteMany = vi.fn();
  const stepDeleteMany = vi.fn();
  const tagDeleteMany = vi.fn();
  const categoryDeleteMany = vi.fn();
  const update = vi.fn().mockResolvedValue(mockRecipeFull);

  vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
    fn({
      recipeIngredient: { deleteMany: ingredientDeleteMany },
      recipeStep: { deleteMany: stepDeleteMany },
      recipeTag: { deleteMany: tagDeleteMany },
      recipeCategory: { deleteMany: categoryDeleteMany },
      recipe: { update },
    } as never),
  );

  return { ingredientDeleteMany, stepDeleteMany, tagDeleteMany, categoryDeleteMany, update };
}

const updateInput = {
  title: 'Updated Carbonara',
  tags: ['italian'],
  categories: [],
  ingredients: [{ name: 'Guanciale' }, { name: 'Pecorino' }],
  steps: [{ order: 1, instruction: 'Render the guanciale' }],
};

describe('updateRecipe()', () => {
  it('wipes ingredients, steps and tags before recreating them, all in one transaction', async () => {
    vi.mocked(upsertTags).mockResolvedValue([{ id: 'tag-1', name: 'italian', slug: 'italian' }]);
    const tx = mockUpdateTransaction();

    await updateRecipe('recipe-uuid', updateInput);

    // A PUT that only appended would leave the previous ingredients/steps/tags/categories behind.
    expect(tx.ingredientDeleteMany).toHaveBeenCalledWith({ where: { recipeId: 'recipe-uuid' } });
    expect(tx.stepDeleteMany).toHaveBeenCalledWith({ where: { recipeId: 'recipe-uuid' } });
    expect(tx.tagDeleteMany).toHaveBeenCalledWith({ where: { recipeId: 'recipe-uuid' } });
    expect(tx.categoryDeleteMany).toHaveBeenCalledWith({ where: { recipeId: 'recipe-uuid' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('recreates ingredients with order re-assigned from array position', async () => {
    vi.mocked(upsertTags).mockResolvedValue([]);
    const tx = mockUpdateTransaction();

    await updateRecipe('recipe-uuid', updateInput);

    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'recipe-uuid' },
        data: expect.objectContaining({
          ingredients: {
            create: [
              { name: 'Guanciale', order: 0 },
              { name: 'Pecorino', order: 1 },
            ],
          },
        }),
      }),
    );
  });

  it('links the upserted tag rows rather than the raw tag strings', async () => {
    vi.mocked(upsertTags).mockResolvedValue([
      { id: 'tag-1', name: 'italian', slug: 'italian' },
      { id: 'tag-2', name: 'pasta', slug: 'pasta' },
    ]);
    const tx = mockUpdateTransaction();

    await updateRecipe('recipe-uuid', { ...updateInput, tags: ['italian', 'pasta'] });

    expect(upsertTags).toHaveBeenCalledWith(['italian', 'pasta']);
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipeTags: { create: [{ tagId: 'tag-1' }, { tagId: 'tag-2' }] },
        }),
      }),
    );
  });

  it('links the resolved category rows and rejects an unknown slug before the transaction', async () => {
    vi.mocked(upsertTags).mockResolvedValue([]);
    vi.mocked(resolveCategories).mockResolvedValue([
      { id: 'cat-1', name: 'Pasta', slug: 'pasta' },
    ]);
    const tx = mockUpdateTransaction();

    await updateRecipe('recipe-uuid', { ...updateInput, categories: ['pasta'] });

    expect(resolveCategories).toHaveBeenCalledWith(['pasta']);
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipeCategories: { create: [{ categoryId: 'cat-1' }] },
        }),
      }),
    );

    vi.mocked(resolveCategories).mockRejectedValue(
      ApiError.validation({ categories: ['Unknown category: nope'] }),
    );
    vi.mocked(prisma.$transaction).mockClear();

    await expect(
      updateRecipe('recipe-uuid', { ...updateInput, categories: ['nope'] }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('never writes slug — it is immutable even when the title changes', async () => {
    vi.mocked(upsertTags).mockResolvedValue([]);
    const tx = mockUpdateTransaction();

    await updateRecipe('recipe-uuid', updateInput);

    expect(tx.update.mock.calls[0][0].data).not.toHaveProperty('slug');
  });

  it('does not let a PUT body overwrite the server-managed image fields', async () => {
    vi.mocked(upsertTags).mockResolvedValue([]);
    const tx = mockUpdateTransaction();

    await updateRecipe('recipe-uuid', {
      ...updateInput,
      coverImageUrl: '/attacker/controlled.jpg',
      imageUrls: ['/attacker/controlled.jpg'],
    } as never);

    const data = tx.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('coverImageUrl');
    expect(data).not.toHaveProperty('imageUrls');
  });

  it('syncs the replaced recipe to Meilisearch with its flattened tags', async () => {
    vi.mocked(upsertTags).mockResolvedValue([{ id: 'tag-1', name: 'italian', slug: 'italian' }]);
    mockUpdateTransaction();

    const result = await updateRecipe('recipe-uuid', updateInput);

    expect(updateIndexedRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'recipe-uuid', tags: ['italian'] }),
    );
    expect(result.tags).toEqual(['italian']);
    expect(result).not.toHaveProperty('recipeTags');
  });

  it('does not touch the search index when the transaction fails', async () => {
    vi.mocked(upsertTags).mockResolvedValue([]);
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error('deadlock'));

    await expect(updateRecipe('recipe-uuid', updateInput)).rejects.toThrow('deadlock');

    expect(updateIndexedRecipe).not.toHaveBeenCalled();
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

  it('passes videoUrl through to the update data when provided', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    const updateMock = vi.fn().mockResolvedValue(mockRecipeFull);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        recipeIngredient: { deleteMany: vi.fn() },
        recipeStep: { deleteMany: vi.fn() },
        recipeTag: { deleteMany: vi.fn() },
        recipeCategory: { deleteMany: vi.fn() },
        recipe: { update: updateMock },
      } as never),
    );

    await patchRecipe('recipe-uuid', { videoUrl: 'https://vimeo.com/12345' });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ videoUrl: 'https://vimeo.com/12345' }) }),
    );
  });

  it('omits videoUrl from the update data when not provided', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    const updateMock = vi.fn().mockResolvedValue(mockRecipeFull);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        recipeIngredient: { deleteMany: vi.fn() },
        recipeStep: { deleteMany: vi.fn() },
        recipeTag: { deleteMany: vi.fn() },
        recipeCategory: { deleteMany: vi.fn() },
        recipe: { update: updateMock },
      } as never),
    );

    await patchRecipe('recipe-uuid', { title: 'Updated Title' });

    const updateData = updateMock.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('videoUrl');
  });

  it('passes authorNote through to the update data when provided', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    const updateMock = vi.fn().mockResolvedValue(mockRecipeFull);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        recipeIngredient: { deleteMany: vi.fn() },
        recipeStep: { deleteMany: vi.fn() },
        recipeTag: { deleteMany: vi.fn() },
        recipeCategory: { deleteMany: vi.fn() },
        recipe: { update: updateMock },
      } as never),
    );

    await patchRecipe('recipe-uuid', { authorNote: 'Updated note' });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ authorNote: 'Updated note' }) }),
    );
  });

  it('omits authorNote from the update data when not provided', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    const updateMock = vi.fn().mockResolvedValue(mockRecipeFull);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        recipeIngredient: { deleteMany: vi.fn() },
        recipeStep: { deleteMany: vi.fn() },
        recipeTag: { deleteMany: vi.fn() },
        recipeCategory: { deleteMany: vi.fn() },
        recipe: { update: updateMock },
      } as never),
    );

    await patchRecipe('recipe-uuid', { title: 'Updated Title' });

    const updateData = updateMock.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('authorNote');
  });

  // The difference between PATCH and PUT lives entirely in these three guards: a section the
  // body omits must survive untouched, so its deleteMany must not run.
  it('only wipes the child rows the body actually replaces', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    const tx = mockUpdateTransaction();

    await patchRecipe('recipe-uuid', { ingredients: [{ name: 'Guanciale' }] });

    expect(tx.ingredientDeleteMany).toHaveBeenCalledWith({ where: { recipeId: 'recipe-uuid' } });
    expect(tx.stepDeleteMany).not.toHaveBeenCalled();
    expect(tx.tagDeleteMany).not.toHaveBeenCalled();
    expect(tx.categoryDeleteMany).not.toHaveBeenCalled();
    expect(upsertTags).not.toHaveBeenCalled();
    expect(resolveCategories).not.toHaveBeenCalled();
  });

  it('leaves every child section alone when the body is metadata only', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    const tx = mockUpdateTransaction();

    await patchRecipe('recipe-uuid', { title: 'Updated Title' });

    expect(tx.ingredientDeleteMany).not.toHaveBeenCalled();
    expect(tx.stepDeleteMany).not.toHaveBeenCalled();
    expect(tx.tagDeleteMany).not.toHaveBeenCalled();
    expect(tx.categoryDeleteMany).not.toHaveBeenCalled();
    const data = tx.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('ingredients');
    expect(data).not.toHaveProperty('steps');
    expect(data).not.toHaveProperty('recipeTags');
    expect(data).not.toHaveProperty('recipeCategories');
  });

  // `tags: []` is a real instruction ("remove all tags"), not an absent field — the
  // `!== undefined` check is what keeps those two apart.
  it('clears all tags when the body passes an empty tags array', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    vi.mocked(upsertTags).mockResolvedValue([]);
    const tx = mockUpdateTransaction();

    await patchRecipe('recipe-uuid', { tags: [] });

    expect(tx.tagDeleteMany).toHaveBeenCalledWith({ where: { recipeId: 'recipe-uuid' } });
    expect(tx.update.mock.calls[0][0].data.recipeTags).toEqual({ create: [] });
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

  it('maps recipeCategories to a flat categories array', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(1);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([mockRecipeListItem] as never);

    const result = await listRecipes({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' });

    expect(result.data[0]).toHaveProperty('categories', ['pasta']);
    expect(result.data[0]).not.toHaveProperty('recipeCategories');
  });

  it('filters by tag slugs when tags query param is provided', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(0);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([]);

    await listRecipes({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc', tags: 'italian,pasta' });

    const whereArg = vi.mocked(prisma.recipe.count).mock.calls[0][0]?.where;
    expect(whereArg).toHaveProperty('AND');
  });

  it('filters by category through the join table on the unique slug', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(0);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([]);

    await listRecipes({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc', category: 'pasta' });

    const whereArg = vi.mocked(prisma.recipe.count).mock.calls[0][0]?.where;
    // `some`, not an equality on the recipe row: a recipe can carry several categories and
    // matches if the filtered slug is among them.
    expect(whereArg).toMatchObject({
      recipeCategories: { some: { category: { slug: 'pasta' } } },
    });
  });

  it('filters by minRating when provided', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(0);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([]);

    await listRecipes({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc', minRating: 4 });

    const whereArg = vi.mocked(prisma.recipe.count).mock.calls[0][0]?.where;
    expect(whereArg).toMatchObject({ averageRating: { gte: 4 } });
  });

  it('sorts by averageRating when sortBy=averageRating', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(0);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([]);

    await listRecipes({ page: 1, limit: 20, sortBy: 'averageRating', order: 'desc' });

    expect(prisma.recipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { averageRating: 'desc' } }),
    );
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

  // ─── isSavedInCollection (viewer state) ───────────────────────────────────

  it('sets isSavedInCollection: false for every item and issues no query when anonymous', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(1);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([mockRecipeListItem] as never);

    const result = await listRecipes({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' });

    expect(result.data[0]).toHaveProperty('isSavedInCollection', false);
    expect(prisma.collectionRecipe.findMany).not.toHaveBeenCalled();
  });

  it('issues no query when the page has zero items, even with a viewer', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(0);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([]);

    const result = await listRecipes(
      { page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' },
      'user_viewer',
    );

    expect(result.data).toEqual([]);
    expect(prisma.collectionRecipe.findMany).not.toHaveBeenCalled();
  });

  it('marks saved items true via one batched query scoped to the viewer', async () => {
    const otherItem = { ...mockRecipeListItem, id: 'recipe-uuid-2' };
    vi.mocked(prisma.recipe.count).mockResolvedValue(2);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([mockRecipeListItem, otherItem] as never);
    vi.mocked(prisma.collectionRecipe.findMany).mockResolvedValue([
      { recipeId: 'recipe-uuid' },
    ] as never);

    const result = await listRecipes(
      { page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' },
      'user_viewer',
    );

    expect(result.data.find((r) => r.id === 'recipe-uuid')).toHaveProperty(
      'isSavedInCollection',
      true,
    );
    expect(result.data.find((r) => r.id === 'recipe-uuid-2')).toHaveProperty(
      'isSavedInCollection',
      false,
    );
    expect(prisma.collectionRecipe.findMany).toHaveBeenCalledWith({
      where: {
        recipeId: { in: ['recipe-uuid', 'recipe-uuid-2'] },
        collection: { owner: { authProviderId: 'user_viewer' } },
      },
      select: { recipeId: true },
      distinct: ['recipeId'],
    });
  });

  it('attaches isSavedInCollection to Meilisearch results too', async () => {
    const query = { q: 'carbonara', page: 1, limit: 20, sortBy: 'createdAt' as const, order: 'desc' as const };
    vi.mocked(searchRecipesViaMeili).mockResolvedValue({
      data: [{ ...mockRecipeListItem, id: 'recipe-uuid' } as never],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false },
    });
    vi.mocked(prisma.collectionRecipe.findMany).mockResolvedValue([
      { recipeId: 'recipe-uuid' },
    ] as never);

    const result = await listRecipes(query, 'user_viewer');

    expect(result.data[0]).toHaveProperty('isSavedInCollection', true);
  });
});

// ─── listRecipesByUser ────────────────────────────────────────────────────────

describe('listRecipesByUser()', () => {
  it('scopes the listing to the user in the path', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(0);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([]);

    await listRecipesByUser('author-uuid', {
      page: 1, limit: 20, sortBy: 'createdAt', order: 'desc',
    });

    const whereArg = vi.mocked(prisma.recipe.count).mock.calls[0][0]?.where;
    expect(whereArg).toMatchObject({ authorId: 'author-uuid' });
  });

  // The path segment is the authority here — a query string can't redirect the listing
  // at someone else's recipes.
  it('overrides an authorId supplied in the query string', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(0);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([]);

    await listRecipesByUser('author-uuid', {
      page: 1, limit: 20, sortBy: 'createdAt', order: 'desc', authorId: 'someone-else-uuid',
    });

    const whereArg = vi.mocked(prisma.recipe.count).mock.calls[0][0]?.where;
    expect(whereArg).toMatchObject({ authorId: 'author-uuid' });
  });

  it('keeps the other filters and routes to Meilisearch when q is present', async () => {
    vi.mocked(searchRecipesViaMeili).mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false },
    });

    await listRecipesByUser('author-uuid', {
      q: 'carbonara', page: 1, limit: 20, sortBy: 'createdAt', order: 'desc', category: 'pasta',
    });

    expect(searchRecipesViaMeili).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'carbonara', category: 'pasta', authorId: 'author-uuid' }),
    );
  });

  it('forwards the viewer sub through to listRecipes for isSavedInCollection', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(1);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([mockRecipeListItem] as never);
    vi.mocked(prisma.collectionRecipe.findMany).mockResolvedValue([
      { recipeId: 'recipe-uuid' },
    ] as never);

    const result = await listRecipesByUser(
      'author-uuid',
      { page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' },
      'user_viewer',
    );

    expect(result.data[0]).toHaveProperty('isSavedInCollection', true);
    expect(prisma.collectionRecipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ collection: { owner: { authProviderId: 'user_viewer' } } }),
      }),
    );
  });
});

// ─── uploadCoverImage ─────────────────────────────────────────────────────────

describe('uploadCoverImage()', () => {
  it('throws RECIPE_NOT_FOUND when recipe does not exist', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(uploadCoverImage('missing-id', Buffer.from('x'))).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });
    expect(storeImage).not.toHaveBeenCalled();
  });

  it('stores the image, deletes the old cover, and updates the recipe', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      ...mockRecipeFull,
      coverImageUrl: '/recipes/recipe-uuid/cover/old.jpg',
    } as never);
    vi.mocked(storeImage).mockResolvedValue('/recipes/recipe-uuid/cover/new.jpg');
    vi.mocked(prisma.recipe.update).mockResolvedValue({
      ...mockRecipeFull,
      coverImageUrl: '/recipes/recipe-uuid/cover/new.jpg',
    } as never);

    const buffer = Buffer.from('fake-image-bytes');
    const result = await uploadCoverImage('recipe-uuid', buffer);

    expect(storeImage).toHaveBeenCalledWith(buffer, 'recipes/recipe-uuid/cover');
    expect(deleteImage).toHaveBeenCalledWith('/recipes/recipe-uuid/cover/old.jpg');
    expect(prisma.recipe.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'recipe-uuid' },
        data: { coverImageUrl: '/recipes/recipe-uuid/cover/new.jpg' },
      }),
    );
    expect(result.coverImageUrl).toBe('/recipes/recipe-uuid/cover/new.jpg');
    expect(updateIndexedRecipe).toHaveBeenCalled();
  });

  it('does not attempt to delete a previous cover when there was none', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipeFull as never);
    vi.mocked(storeImage).mockResolvedValue('/recipes/recipe-uuid/cover/new.jpg');
    vi.mocked(prisma.recipe.update).mockResolvedValue(mockRecipeFull as never);

    await uploadCoverImage('recipe-uuid', Buffer.from('x'));

    expect(deleteImage).not.toHaveBeenCalled();
  });
});

// ─── deleteCoverImage ─────────────────────────────────────────────────────────

describe('deleteCoverImage()', () => {
  it('throws RECIPE_NOT_FOUND when recipe does not exist', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(deleteCoverImage('missing-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });
  });

  it('clears the cover and deletes the R2 object', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      ...mockRecipeFull,
      coverImageUrl: '/recipes/recipe-uuid/cover/old.jpg',
    } as never);
    vi.mocked(prisma.recipe.update).mockResolvedValue(mockRecipeFull as never);

    await deleteCoverImage('recipe-uuid');

    expect(deleteImage).toHaveBeenCalledWith('/recipes/recipe-uuid/cover/old.jpg');
    expect(prisma.recipe.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { coverImageUrl: null } }),
    );
  });
});

// ─── addGalleryImages ─────────────────────────────────────────────────────────

describe('addGalleryImages()', () => {
  it('throws RECIPE_NOT_FOUND when recipe does not exist', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(addGalleryImages('missing-id', [Buffer.from('x')])).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });
  });

  it('stores keys then appends them via an atomic guarded UPDATE', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      ...mockRecipeFull,
      imageUrls: ['/recipes/recipe-uuid/gallery/a.jpg'],
    } as never);
    vi.mocked(storeImage).mockResolvedValueOnce('/recipes/recipe-uuid/gallery/b.jpg');
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);

    await addGalleryImages('recipe-uuid', [Buffer.from('x')]);

    expect(storeImage).toHaveBeenCalledWith(Buffer.from('x'), 'recipes/recipe-uuid/gallery');
    // Append is the atomic raw UPDATE, not a read-then-update via recipe.update.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.recipe.update).not.toHaveBeenCalled();
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it('rejects (fast path) without storing when the gallery would exceed 10 images', async () => {
    const existingKeys = Array.from({ length: 9 }, (_, i) => `/recipes/recipe-uuid/gallery/${i}.jpg`);
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      ...mockRecipeFull,
      imageUrls: existingKeys,
    } as never);

    await expect(
      addGalleryImages('recipe-uuid', [Buffer.from('a'), Buffer.from('b')]),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });

    expect(storeImage).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('allows exactly reaching the 10-image cap', async () => {
    const existingKeys = Array.from({ length: 9 }, (_, i) => `/recipes/recipe-uuid/gallery/${i}.jpg`);
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      ...mockRecipeFull,
      imageUrls: existingKeys,
    } as never);
    vi.mocked(storeImage).mockResolvedValue('/recipes/recipe-uuid/gallery/new.jpg');
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);

    await addGalleryImages('recipe-uuid', [Buffer.from('x')]);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('cleans up stored objects and 422s when the atomic guard loses the race', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      ...mockRecipeFull,
      imageUrls: ['/recipes/recipe-uuid/gallery/a.jpg'],
    } as never);
    vi.mocked(storeImage).mockResolvedValueOnce('/recipes/recipe-uuid/gallery/b.jpg');
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as never); // concurrent upload won the cap

    await expect(addGalleryImages('recipe-uuid', [Buffer.from('x')])).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });

    // Orphan cleanup: the just-stored object is deleted from R2.
    expect(deleteImage).toHaveBeenCalledWith('/recipes/recipe-uuid/gallery/b.jpg');
  });

  it('deletes every stored object when a multi-file upload loses the race', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      ...mockRecipeFull,
      imageUrls: [],
    } as never);
    vi.mocked(storeImage)
      .mockResolvedValueOnce('/recipes/recipe-uuid/gallery/b.jpg')
      .mockResolvedValueOnce('/recipes/recipe-uuid/gallery/c.jpg');
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as never);

    await expect(
      addGalleryImages('recipe-uuid', [Buffer.from('x'), Buffer.from('y')]),
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(deleteImage).toHaveBeenCalledWith('/recipes/recipe-uuid/gallery/b.jpg');
    expect(deleteImage).toHaveBeenCalledWith('/recipes/recipe-uuid/gallery/c.jpg');
    expect(deleteImage).toHaveBeenCalledTimes(2);
  });

  // The append succeeded, so the objects are legitimately referenced — the recipe only
  // disappears here if it was deleted mid-request, and that must surface as a 404, not a crash.
  it('throws RECIPE_NOT_FOUND when the recipe vanishes before the post-append re-fetch', async () => {
    vi.mocked(prisma.recipe.findUnique)
      .mockResolvedValueOnce({ ...mockRecipeFull, imageUrls: [] } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(storeImage).mockResolvedValue('/recipes/recipe-uuid/gallery/b.jpg');
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);

    await expect(addGalleryImages('recipe-uuid', [Buffer.from('x')])).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });

    expect(updateIndexedRecipe).not.toHaveBeenCalled();
  });
});

// ─── removeGalleryImages ──────────────────────────────────────────────────────

describe('removeGalleryImages()', () => {
  it('throws RECIPE_NOT_FOUND when recipe does not exist', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(removeGalleryImages('missing-id', ['a.jpg'])).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });
  });

  it('removes only the given paths and deletes their R2 objects', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      ...mockRecipeFull,
      imageUrls: [
        '/recipes/recipe-uuid/gallery/a.jpg',
        '/recipes/recipe-uuid/gallery/b.jpg',
        '/recipes/recipe-uuid/gallery/c.jpg',
      ],
    } as never);
    vi.mocked(prisma.recipe.update).mockResolvedValue(mockRecipeFull as never);

    await removeGalleryImages('recipe-uuid', ['/recipes/recipe-uuid/gallery/b.jpg']);

    expect(deleteImage).toHaveBeenCalledWith('/recipes/recipe-uuid/gallery/b.jpg');
    expect(deleteImage).not.toHaveBeenCalledWith('/recipes/recipe-uuid/gallery/a.jpg');
    expect(prisma.recipe.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          imageUrls: ['/recipes/recipe-uuid/gallery/a.jpg', '/recipes/recipe-uuid/gallery/c.jpg'],
        },
      }),
    );
  });
});
