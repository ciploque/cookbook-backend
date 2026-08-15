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
    $executeRaw: vi.fn(),
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

vi.mock('../../../src/modules/storage/storage.service', () => ({
  storeImage: vi.fn(),
  deleteImage: vi.fn(),
}));

import { Prisma } from '@prisma/client';
import { prisma } from '../../../src/config/database';
import {
  deleteIndexedRecipe,
  indexRecipe,
  searchRecipesViaMeili,
  updateIndexedRecipe,
} from '../../../src/modules/recipes/recipe.search';
import { upsertTags } from '../../../src/modules/tags/tag.service';
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
  patchRecipe,
  removeGalleryImages,
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
  category: 'pasta',
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
        tags: [], ingredients: [], steps: [],
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });

    expect(prisma.recipe.create).not.toHaveBeenCalled();
  });

  it('creates recipe with generated slug and upserted tags', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(upsertTags).mockResolvedValue([{ id: 'tag-1', name: 'italian', slug: 'italian' }]);
    vi.mocked(prisma.recipe.create).mockResolvedValue(mockRecipeFull as never);

    const result = await createRecipe('user_author', {
      title: 'Pasta Carbonara',
      description: 'Classic Roman pasta dish',
      authorNote: 'A family favorite',
      category: 'pasta',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      tags: ['italian'],
      ingredients: [{ name: 'Spaghetti', quantity: 400 }],
      steps: [{ order: 1, instruction: 'Boil pasta' }],
    });

    expect(upsertTags).toHaveBeenCalledWith(['italian']);
    expect(prisma.recipe.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'pasta-carbonara-abcd',
          authorId: 'author-uuid',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          authorNote: 'A family favorite',
        }),
      }),
    );
    expect(result).toHaveProperty('tags', ['italian']);
    expect(indexRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'recipe-uuid',
        title: 'Pasta Carbonara',
        authorId: 'author-uuid',
        authorNote: 'A family favorite',
        tags: ['italian'],
      }),
    );
  });

  it('assigns order indices to ingredients in array order', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(upsertTags).mockResolvedValue([]);
    vi.mocked(prisma.recipe.create).mockResolvedValue({ ...mockRecipeFull, recipeTags: [] } as never);

    await createRecipe('user_author', {
      title: 'Test',
      description: 'desc',
      category: 'cat',
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
        tags: [], ingredients: [], steps: [],
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
        tags: [], ingredients: [], steps: [],
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
        recipe: { update: updateMock },
      } as never),
    );

    await patchRecipe('recipe-uuid', { title: 'Updated Title' });

    const updateData = updateMock.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('authorNote');
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

  it('filters by category with a plain equality match (not mode: insensitive)', async () => {
    vi.mocked(prisma.recipe.count).mockResolvedValue(0);
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([]);

    await listRecipes({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc', category: 'pasta' });

    const whereArg = vi.mocked(prisma.recipe.count).mock.calls[0][0]?.where;
    expect(whereArg).toMatchObject({ category: 'pasta' });
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
