import './registry'; // must be first — extends Zod prototype before schemas are used
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  createRecipeSchema,
  updateRecipeSchema,
  patchRecipeSchema,
  recipeQuerySchema,
  removeGalleryImagesSchema,
} from '../modules/recipes/recipe.schema';
import { provisionUserSchema, updateUserSchema } from '../modules/users/user.schema';
import { createReviewSchema, reviewQuerySchema } from '../modules/reviews/review.schema';
import {
  createCollectionSchema,
  updateCollectionSchema,
  patchCollectionSchema,
  addRecipesSchema,
  removeRecipesSchema,
  collectionQuerySchema,
} from '../modules/collections/collection.schema';

const registry = new OpenAPIRegistry();

// ── Shared response schemas ──────────────────────────────────────────────────

const UserSchema = registry.register(
  'User',
  z.object({
    id: z.string().uuid(),
    keycloakId: z.string(),
    username: z.string(),
    displayName: z.string(),
    bio: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

const PublicUserSchema = registry.register(
  'PublicUser',
  z.object({
    id: z.string().uuid(),
    username: z.string(),
    displayName: z.string(),
    bio: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

const RecipeAuthorSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

const RecipeIngredientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  notes: z.string().nullable(),
  order: z.number().int(),
});

const RecipeStepSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int(),
  instruction: z.string(),
  imageUrl: z.string().nullable(),
});

const RecipeDetailSchema = registry.register(
  'RecipeDetail',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    authorNote: z.string().nullable(),
    category: z.string().nullable(),
    tags: z.array(z.string()),
    coverImageUrl: z.string().nullable(),
    imageUrls: z.array(z.string()),
    videoUrl: z.string().nullable(),
    prepTimeMinutes: z.number().int().nullable(),
    servings: z.number().int().nullable(),
    difficulty: z.number().int().nullable(),
    averageRating: z.number().nullable(),
    reviewCount: z.number().int(),
    author: RecipeAuthorSchema,
    ingredients: z.array(RecipeIngredientSchema),
    steps: z.array(RecipeStepSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

const RecipeListItemSchema = registry.register(
  'RecipeListItem',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    authorNote: z.string().nullable(),
    category: z.string().nullable(),
    tags: z.array(z.string()),
    coverImageUrl: z.string().nullable(),
    imageUrls: z.array(z.string()),
    videoUrl: z.string().nullable(),
    prepTimeMinutes: z.number().int().nullable(),
    difficulty: z.number().int().nullable(),
    averageRating: z.number().nullable(),
    reviewCount: z.number().int(),
    author: z.object({ id: z.string().uuid(), username: z.string(), displayName: z.string() }),
    createdAt: z.string().datetime(),
  }),
);

const PaginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});

const ErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().nullable(),
  }),
});

const ReviewAuthorSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

const ReviewSchema = registry.register(
  'Review',
  z.object({
    id: z.string().uuid(),
    recipeId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    content: z.string().nullable(),
    imageUrls: z.array(z.string()),
    author: ReviewAuthorSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

// ── Input schemas ─────────────────────────────────────────────────────────────

const CreateRecipeBody = registry.register('CreateRecipeBody', createRecipeSchema);
const UpdateRecipeBody = registry.register('UpdateRecipeBody', updateRecipeSchema);
const PatchRecipeBody = registry.register('PatchRecipeBody', patchRecipeSchema);
const RemoveGalleryImagesBody = registry.register(
  'RemoveGalleryImagesBody',
  removeGalleryImagesSchema,
);
const ProvisionUserBody = registry.register('ProvisionUserBody', provisionUserSchema);
const UpdateUserBody = registry.register('UpdateUserBody', updateUserSchema);
const CreateReviewBody = registry.register('CreateReviewBody', createReviewSchema);

const ReviewStatsSchema = registry.register(
  'ReviewStats',
  z.object({
    totalReviews: z.number().int(),
    ratingCounts: z.object({
      '1': z.number().int(),
      '2': z.number().int(),
      '3': z.number().int(),
      '4': z.number().int(),
      '5': z.number().int(),
    }),
    mediaCount: z.number().int(),
  }),
);

const CollectionRecipeItemSchema = z.object({
  recipeId: z.string().uuid(),
  order: z.number().int(),
  recipe: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    coverImageUrl: z.string().nullable(),
  }),
});

const CollectionOwnerSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

const CollectionSchema = registry.register(
  'Collection',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    isPublic: z.boolean(),
    owner: CollectionOwnerSchema,
    recipes: z.array(CollectionRecipeItemSchema),
    followerCount: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

const CreateCollectionBody = registry.register('CreateCollectionBody', createCollectionSchema);
const UpdateCollectionBody = registry.register('UpdateCollectionBody', updateCollectionSchema);
const PatchCollectionBody = registry.register('PatchCollectionBody', patchCollectionSchema);
const AddRecipesBody = registry.register('AddRecipesBody', addRecipesSchema);
const RemoveRecipesBody = registry.register('RemoveRecipesBody', removeRecipesSchema);

// ── Security scheme ───────────────────────────────────────────────────────────

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

// ── Health ────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  summary: 'Health check',
  responses: {
    200: {
      description: 'Service is healthy',
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('ok'), db: z.literal('connected') }),
        },
      },
    },
  },
});

// ── Users ─────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/v1/users/me',
  tags: ['Users'],
  summary: 'Provision user profile',
  description:
    'Creates a user row on first login. Idempotent — returns the existing user if already provisioned.',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: ProvisionUserBody } } },
  },
  responses: {
    201: {
      description: 'User created',
      content: {
        'application/json': { schema: z.object({ success: z.literal(true), data: UserSchema }) },
      },
    },
    200: {
      description: 'User already provisioned (idempotent)',
      content: {
        'application/json': { schema: z.object({ success: z.literal(true), data: UserSchema }) },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Username already taken',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/me',
  tags: ['Users'],
  summary: 'Get own profile',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Authenticated user profile',
      content: {
        'application/json': { schema: z.object({ success: z.literal(true), data: UserSchema }) },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/users/me',
  tags: ['Users'],
  summary: 'Update own profile',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: UpdateUserBody } } },
  },
  responses: {
    200: {
      description: 'Updated user profile',
      content: {
        'application/json': { schema: z.object({ success: z.literal(true), data: UserSchema }) },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Username already taken',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{userId}',
  tags: ['Users'],
  summary: 'Get public user profile',
  request: {
    params: z.object({ userId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Public user profile',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: PublicUserSchema }),
        },
      },
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/username/{username}',
  tags: ['Users'],
  summary: 'Get public user profile by username',
  description:
    'Human-friendly lookup by username, alongside the DB-id-based /users/{userId} route.',
  request: {
    params: z.object({ username: z.string() }),
  },
  responses: {
    200: {
      description: 'Public user profile',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: PublicUserSchema }),
        },
      },
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

// ── Recipes ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/v1/recipes',
  tags: ['Recipes'],
  summary: 'List / search recipes',
  request: {
    query: recipeQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated list of recipes',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(RecipeListItemSchema),
            meta: PaginationMetaSchema,
          }),
        },
      },
    },
    422: {
      description: 'Invalid query params',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/recipes/{recipeId}',
  tags: ['Recipes'],
  summary: 'Get recipe by ID',
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Full recipe detail',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }),
        },
      },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/recipes',
  tags: ['Recipes'],
  summary: 'Create recipe',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateRecipeBody } } },
  },
  responses: {
    201: {
      description: 'Recipe created',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/recipes/{recipeId}',
  tags: ['Recipes'],
  summary: 'Full update (replaces ingredients, steps and tags)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpdateRecipeBody } } },
  },
  responses: {
    200: {
      description: 'Updated recipe',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the recipe owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/recipes/{recipeId}',
  tags: ['Recipes'],
  summary: 'Partial update',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: PatchRecipeBody } } },
  },
  responses: {
    200: {
      description: 'Updated recipe',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the recipe owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/recipes/{recipeId}',
  tags: ['Recipes'],
  summary: 'Delete recipe',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
  },
  responses: {
    204: { description: 'Recipe deleted' },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the recipe owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/recipes/{recipeId}/cover-image',
  tags: ['Recipes'],
  summary: 'Upload cover image',
  description:
    'Uploads a single image (multipart/form-data, field "image"; JPEG/PNG/WEBP/GIF, max 5MB) to Cloudflare R2 ' +
    'and sets it as the recipe cover, replacing any existing one.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
    body: {
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: { image: { type: 'string', format: 'binary' } },
            required: ['image'],
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated recipe with the new cover image URL',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the recipe owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Missing/invalid file, or wrong type/size',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/recipes/{recipeId}/cover-image',
  tags: ['Recipes'],
  summary: 'Remove cover image',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Updated recipe with cover image cleared',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the recipe owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/recipes/{recipeId}/images',
  tags: ['Recipes'],
  summary: 'Add gallery images',
  description:
    'Uploads one or more images (multipart/form-data, field "images"; JPEG/PNG/WEBP/GIF, max 5MB each) to ' +
    'Cloudflare R2 and appends them to the recipe gallery. The gallery is capped at 10 images total.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
    body: {
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              images: { type: 'array', items: { type: 'string', format: 'binary' } },
            },
            required: ['images'],
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated recipe with the new gallery images appended',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the recipe owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Missing/invalid files, wrong type/size, or gallery would exceed 10 images',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/recipes/{recipeId}/images',
  tags: ['Recipes'],
  summary: 'Remove gallery images',
  description:
    'Removes the given relative storage paths from the recipe gallery and deletes them from R2.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: RemoveGalleryImagesBody } } },
  },
  responses: {
    200: {
      description: 'Updated recipe with the given gallery images removed',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the recipe owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{userId}/recipes',
  tags: ['Recipes'],
  summary: 'List recipes by user (by DB id)',
  request: {
    params: z.object({ userId: z.string().uuid() }),
    query: recipeQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated list of recipes',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(RecipeListItemSchema),
            meta: PaginationMetaSchema,
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{username}/recipes/{recipename}',
  tags: ['Recipes'],
  summary: 'Get recipe by author username + slug',
  description: 'Human-friendly URL. Slug uniqueness is scoped per user.',
  request: {
    params: z.object({ username: z.string(), recipename: z.string() }),
  },
  responses: {
    200: {
      description: 'Full recipe detail',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }),
        },
      },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

// ── Reviews ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/v1/recipes/{recipeId}/reviews',
  tags: ['Reviews'],
  summary: 'List reviews for a recipe',
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
    query: reviewQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated list of reviews',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(ReviewSchema),
            meta: PaginationMetaSchema,
          }),
        },
      },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Invalid query params',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/recipes/{recipeId}/reviews/summary',
  tags: ['Reviews'],
  summary: "Get totalized rating breakdown and media count for a recipe's reviews",
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Totalized review stats',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: ReviewStatsSchema }),
        },
      },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/reviews',
  tags: ['Reviews'],
  summary: 'Create a review',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateReviewBody } } },
  },
  responses: {
    201: {
      description: 'Review created',
      content: {
        'application/json': { schema: z.object({ success: z.literal(true), data: ReviewSchema }) },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Recipe or user not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Already reviewed this recipe',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

// ── Collections ───────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{userId}/collections',
  tags: ['Collections'],
  summary: 'List collections by user',
  request: {
    params: z.object({ userId: z.string().uuid() }),
    query: collectionQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated list of collections',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(CollectionSchema),
            meta: PaginationMetaSchema,
          }),
        },
      },
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/collections/{collectionId}',
  tags: ['Collections'],
  summary: 'Get collection by ID',
  request: {
    params: z.object({ collectionId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Collection detail',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: CollectionSchema }),
        },
      },
    },
    404: {
      description: 'Collection not found or private',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/collections',
  tags: ['Collections'],
  summary: 'Create collection',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateCollectionBody } } },
  },
  responses: {
    201: {
      description: 'Collection created',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: CollectionSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/collections/{collectionId}',
  tags: ['Collections'],
  summary: 'Full metadata update',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ collectionId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpdateCollectionBody } } },
  },
  responses: {
    200: {
      description: 'Updated collection',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: CollectionSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the collection owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Collection not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/collections/{collectionId}',
  tags: ['Collections'],
  summary: 'Partial metadata update',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ collectionId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: PatchCollectionBody } } },
  },
  responses: {
    200: {
      description: 'Updated collection',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: CollectionSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the collection owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Collection not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/collections/{collectionId}',
  tags: ['Collections'],
  summary: 'Delete collection',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ collectionId: z.string().uuid() }),
  },
  responses: {
    204: { description: 'Collection deleted' },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the collection owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Collection not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/collections/{collectionId}/recipes',
  tags: ['Collections'],
  summary: 'Add recipes to collection',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ collectionId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: AddRecipesBody } } },
  },
  responses: {
    200: {
      description: 'Collection with updated recipe list',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: CollectionSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the collection owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Collection not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/collections/{collectionId}/recipes',
  tags: ['Collections'],
  summary: 'Remove recipes from collection',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ collectionId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: RemoveRecipesBody } } },
  },
  responses: {
    200: {
      description: 'Collection with updated recipe list',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: CollectionSchema }),
        },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the collection owner',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Collection not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/collections/{collectionId}/follow',
  tags: ['Collections'],
  summary: 'Follow a public collection',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ collectionId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Followed successfully',
      content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Collection is private or own collection',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Collection not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Already following',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/collections/{collectionId}/follow',
  tags: ['Collections'],
  summary: 'Unfollow a collection',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ collectionId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Unfollowed successfully',
      content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

// ── Webhooks ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/v1/webhooks/clerk',
  tags: ['Webhooks'],
  summary: 'Clerk user lifecycle webhook',
  description:
    'Receives user.created / user.updated / user.deleted events from Clerk. Verified via Svix signature ' +
    '(svix-id / svix-timestamp / svix-signature headers) against CLERK_WEBHOOK_SIGNING_SECRET — not a bearer token. ' +
    'user.created auto-provisions a stub User row with a generated fallback username. user.deleted removes the ' +
    'corresponding User row (cascades). user.updated is currently a no-op (username/displayName/bio are app-owned).',
  responses: {
    200: {
      description: 'Event processed',
      content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
    },
    400: {
      description: 'Invalid or unverifiable webhook signature',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

// ── Generator ─────────────────────────────────────────────────────────────────

export function buildOpenApiDocument(serverUrl = '/') {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Cookbook API',
      version: '1.0.0',
      description:
        'REST API for a cooking recipes website. Authentication is handled via Keycloak JWTs.',
    },
    servers: [{ url: serverUrl }],
  });
}
