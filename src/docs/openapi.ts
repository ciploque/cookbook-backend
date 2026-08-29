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
import {
  createReviewSchema,
  removeReviewImagesSchema,
  reviewQuerySchema,
  updateReviewSchema,
} from '../modules/reviews/review.schema';
import {
  createCollectionSchema,
  updateCollectionSchema,
  patchCollectionSchema,
  addRecipesSchema,
  removeRecipesSchema,
  collectionQuerySchema,
} from '../modules/collections/collection.schema';
import { shelfQuerySchema, shelfSourceValues } from '../modules/shelves/shelf.schema';
import {
  createRecipeReportSchema,
  reportQuerySchema,
  reportStatusValues,
  reportTargetTypeValues,
} from '../modules/reports/report.schema';

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
    about: z.string().nullable(),
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
    about: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    // Total recipes authored. Unfiltered — Recipe has no visibility flag.
    recipeCount: z.number().int(),
    // Public collections only, for every caller. The private-inclusive count is on GET /users/me.
    collectionCount: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

// GET /users/me only — POST/PUT /users/me return the plain User row. `collectionCount` here is
// unfiltered (public + private): the route authenticates the caller, so it may count both.
const UserWithCountsSchema = registry.register(
  'UserWithCounts',
  UserSchema.extend({
    recipeCount: z.number().int(),
    collectionCount: z.number().int(),
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
    categories: z.array(z.string()),
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

// The two single-recipe GETs only. RecipeDetail itself stays viewer-agnostic — it's shared by
// POST/PUT/PATCH and the four image routes, whose responses carry no viewer state.
const RecipeDetailWithViewerStateSchema = registry.register(
  'RecipeDetailWithViewerState',
  RecipeDetailSchema.extend({
    hasReviewed: z.boolean(),
    isSavedInCollection: z.boolean(),
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
    categories: z.array(z.string()),
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

// GET /recipes and GET /users/{userId}/recipes only. Plain RecipeListItem stays viewer-agnostic —
// it's shared by GET /shelves, whose items are a precomputed snapshot with no per-viewer context.
const RecipeListItemWithViewerStateSchema = registry.register(
  'RecipeListItemWithViewerState',
  RecipeListItemSchema.extend({
    isSavedInCollection: z.boolean(),
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
const UpdateReviewBody = registry.register('UpdateReviewBody', updateReviewSchema);
const RemoveReviewImagesBody = registry.register(
  'RemoveReviewImagesBody',
  removeReviewImagesSchema,
);

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
    // URL-safe handle, unique per owner and derived from `name` — re-slugged whenever the name
    // changes, so GET /users/{username}/collections/{slug} always matches the current title.
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isPublic: z.boolean(),
    owner: CollectionOwnerSchema,
    recipes: z.array(CollectionRecipeItemSchema),
    // Card thumbnails: covers of the first 4 recipes by `order`. Recipes without a cover are
    // omitted rather than backfilled, so this holds 0–4 entries and never a null.
    coverImages: z.array(z.string()),
    // Total membership — unaffected by the 50-recipe cap on `recipes`.
    recipeCount: z.number().int(),
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

const ReportSchema = registry.register(
  'Report',
  z.object({
    id: z.string().uuid(),
    targetType: z.enum(reportTargetTypeValues),
    topic: z.string(),
    message: z.string().nullable(),
    status: z.enum(reportStatusValues),
    // Populated when targetType is "recipe"; null for other target types.
    recipe: z
      .object({
        id: z.string().uuid(),
        slug: z.string(),
        title: z.string(),
        coverImageUrl: z.string().nullable(),
      })
      .nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

const CreateRecipeReportBody = registry.register(
  'CreateRecipeReportBody',
  createRecipeReportSchema,
);

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
  description:
    "The authenticated caller's own profile, including `recipeCount` and an unfiltered " +
    '`collectionCount` (public **and** private). The public profile GETs count public ' +
    'collections only — this is the route that proves identity, so it is the one that may ' +
    'count both.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Authenticated user profile with counts',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: UserWithCountsSchema }),
        },
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
  description:
    'Fully public — the same body for every caller. `collectionCount` counts public collections ' +
    'only; the profile owner gets their private ones counted on GET /users/me.',
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
    422: {
      description: 'Invalid path parameter',
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
    'Human-friendly lookup by username, alongside the DB-id-based /users/{userId} route. ' +
    'Fully public, identical response shape and rules — see that route.',
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
            data: z.array(RecipeListItemWithViewerStateSchema),
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
  description:
    'Public. A bearer token is optional: when present, `hasReviewed` and `isSavedInCollection` ' +
    'describe the authenticated caller. Both are `false` for an anonymous request.',
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Full recipe detail, including viewer-scoped state',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailWithViewerStateSchema }),
        },
      },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Invalid path parameter',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/recipes',
  tags: ['Recipes'],
  summary: 'Create recipe',
  description:
    'The slug is server-derived from `title` and is not accepted in the body. It must be unique ' +
    'among the caller’s own recipes — a title that slugifies to one they already have is a 409. ' +
    'A title that cannot produce a usable slug at all (nothing but emoji, CJK, punctuation or ' +
    'separators) is a 422 and no recipe is created; accented and digit-only titles are fine.',
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
    409: {
      description: 'The caller already has a recipe with this title',
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
  description:
    'Renaming re-derives the slug, which moves the recipe’s ' +
    'GET /users/{username}/recipes/{recipename} URL — `title` is required here, so every full ' +
    'update re-derives it. A title colliding with another of the caller’s recipes is a 409; one ' +
    'that cannot produce a usable slug is a 422 and the rename is not applied.',
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
    409: {
      description: 'The caller already has a recipe with this title',
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
  description:
    'The slug is re-derived only when `title` is present in the body — a patch touching only ' +
    'other fields leaves the recipe’s URL alone. A title colliding with another of the caller’s ' +
    'recipes is a 409; one that cannot produce a usable slug is a 422 and the rename is not ' +
    'applied.',
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
    409: {
      description: 'The caller already has a recipe with this title',
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
    422: {
      description: 'Invalid path parameter',
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
    422: {
      description: 'Invalid path parameter',
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
            data: z.array(RecipeListItemWithViewerStateSchema),
            meta: PaginationMetaSchema,
          }),
        },
      },
    },
    422: {
      description: 'Invalid path parameter',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{username}/recipes/{recipename}',
  tags: ['Recipes'],
  summary: 'Get recipe by author username + slug',
  description:
    'Human-friendly URL. Slug uniqueness is scoped per user. The slug is re-derived whenever the ' +
    'recipe is renamed, so a link minted before a rename no longer resolves. Public, but a ' +
    'bearer token is optional: when present, `hasReviewed` and `isSavedInCollection` describe ' +
    'the authenticated caller. Both are `false` for an anonymous request.',
  request: {
    params: z.object({ username: z.string(), recipename: z.string() }),
  },
  responses: {
    200: {
      description: 'Full recipe detail, including viewer-scoped state',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: RecipeDetailWithViewerStateSchema }),
        },
      },
    },
    404: {
      description: 'Recipe not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

// ── Categories ────────────────────────────────────────────────────────────────

const CategorySchema = registry.register(
  'Category',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    recipeCount: z.number().int(),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/categories',
  tags: ['Categories'],
  summary: 'List all categories with recipe counts',
  description:
    'Every category in the curated registry, with the number of recipes in each — ordered by name. ' +
    'Deliberately unpaginated: the list is small and a category nav wants all of it at once. ' +
    'Categories with no recipes are included. There are no write endpoints: the registry is ' +
    'src/modules/categories/categories.config.ts, applied with `npm run categories:sync`.',
  responses: {
    200: {
      description: 'All categories',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: z.array(CategorySchema) }),
        },
      },
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
    422: {
      description: 'Invalid path parameter',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/recipes/{recipeId}/reviews/me',
  tags: ['Reviews'],
  summary: "Get the authenticated user's own review of a recipe",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "The caller's review of this recipe",
      content: {
        'application/json': { schema: z.object({ success: z.literal(true), data: ReviewSchema }) },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Recipe or user not found, or the caller has not reviewed this recipe',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Invalid path parameter',
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

registry.registerPath({
  method: 'put',
  path: '/api/v1/reviews/{reviewId}',
  tags: ['Reviews'],
  summary: 'Update your own review',
  description:
    'Full replace of the review body: `rating` is required, and omitting `content` clears it. ' +
    "Images are unaffected. The recipe's rating stats are recomputed from the reviews table.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ reviewId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpdateReviewBody } } },
  },
  responses: {
    200: {
      description: 'Updated review',
      content: {
        'application/json': { schema: z.object({ success: z.literal(true), data: ReviewSchema }) },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the review author',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Review not found (RESOURCE_NOT_FOUND, raised by the owner guard)',
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
  path: '/api/v1/reviews/{reviewId}',
  tags: ['Reviews'],
  summary: 'Delete your own review',
  description:
    "Deletes the review, recomputes the recipe's rating stats from the reviews table, and " +
    'deletes every attached image from R2.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ reviewId: z.string().uuid() }),
  },
  responses: {
    204: { description: 'Review deleted' },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the review author',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Review not found (RESOURCE_NOT_FOUND, raised by the owner guard)',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Invalid path parameter',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/reviews/{reviewId}/images',
  tags: ['Reviews'],
  summary: 'Add review images',
  description:
    'Uploads one or more images (multipart/form-data, field "images"; JPEG/PNG/WEBP/GIF, max 5MB each) to ' +
    'Cloudflare R2 and appends them to the review. Capped at 10 images total.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ reviewId: z.string().uuid() }),
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
      description: 'Updated review with the new images appended',
      content: {
        'application/json': { schema: z.object({ success: z.literal(true), data: ReviewSchema }) },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the review author',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Review not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Missing/invalid files, wrong type/size, or images would exceed the cap of 10',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/reviews/{reviewId}/images',
  tags: ['Reviews'],
  summary: 'Remove review images',
  description: 'Removes the given relative storage paths from the review and deletes them from R2.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ reviewId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: RemoveReviewImagesBody } } },
  },
  responses: {
    200: {
      description: 'Updated review with the given images removed',
      content: {
        'application/json': { schema: z.object({ success: z.literal(true), data: ReviewSchema }) },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Not the review author',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Review not found',
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
  summary: "List a user's public collections",
  description:
    'Fully public — public collections only, the same list for every caller. The owner gets ' +
    'their full library (public + private) from GET /users/me/collections.',
  request: {
    params: z.object({ userId: z.string().uuid() }),
    query: collectionQuerySchema,
  },
  responses: {
    200: {
      description: "Paginated list of the user's public collections",
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
    422: {
      description: 'Invalid path parameter',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/me/collections',
  tags: ['Collections'],
  summary: "List all of the authenticated user's collections",
  description: 'Returns both public and private collections owned by the authenticated user.',
  security: [{ bearerAuth: [] }],
  request: {
    query: collectionQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated list of the authenticated user’s collections',
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
  method: 'get',
  path: '/api/v1/users/me/collections/{collectionId}',
  tags: ['Collections'],
  summary: 'Get one of the authenticated user’s own collections',
  description:
    'The owner-scoped counterpart to GET /collections/{collectionId}: returns the caller’s own ' +
    'collection whether it is public or private. A collection the caller does not own is a 404, ' +
    'not a 403 — a non-owner should not learn the id exists.',
  security: [{ bearerAuth: [] }],
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
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Collection not found, or not owned by the caller',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Invalid path parameter',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/collections/{collectionId}',
  tags: ['Collections'],
  summary: 'Get public collection by ID',
  description:
    'Fully public. A private collection is a 404 for every caller, its owner included — the ' +
    'owner reads their own through GET /users/me/collections/{collectionId}.',
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
    422: {
      description: 'Invalid path parameter',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{username}/collections/{slug}',
  tags: ['Collections'],
  summary: 'Get public collection by owner username + slug',
  description:
    'SEO-friendly URL for GET /collections/{collectionId} — identical behaviour and response ' +
    'shape. Slug uniqueness is scoped per owner, so both params are needed to identify a ' +
    'collection. Fully public: a private collection is a 404 for every caller, its owner ' +
    'included. The slug is re-derived whenever the collection is renamed, so a link minted ' +
    'before a rename no longer resolves.',
  request: {
    params: z.object({ username: z.string(), slug: z.string() }),
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
      description: 'Collection not found or private, or no such username',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/collections',
  tags: ['Collections'],
  summary: 'Create collection',
  description:
    'The slug is server-generated from `name` and is not accepted in the body. It must be ' +
    'unique among the caller’s own collections — a name that slugifies to one they already ' +
    'have is a 409.',
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
    409: {
      description: 'The caller already has a collection with this name',
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
  description:
    'Renaming re-derives the slug, which moves the collection’s ' +
    'GET /users/{username}/collections/{slug} URL. A name colliding with another of the ' +
    'caller’s collections is a 409.',
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
    409: {
      description: 'The caller already has a collection with this name',
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
  description:
    'The slug is re-derived only when `name` is present in the body — a patch touching only ' +
    '`description`/`isPublic` leaves the collection’s URL alone. A name colliding with another ' +
    'of the caller’s collections is a 409.',
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
    409: {
      description: 'The caller already has a collection with this name',
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
    422: {
      description: 'Invalid path parameter',
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
    422: {
      description: 'Invalid path parameter',
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
    422: {
      description: 'Invalid path parameter',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

// ── Reports ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/v1/recipes/{recipeId}/reports',
  tags: ['Reports'],
  summary: 'Report a recipe',
  description:
    'Flags a recipe for moderation. One report per user per recipe; reporting your own recipe is not allowed.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ recipeId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: CreateRecipeReportBody } } },
  },
  responses: {
    201: {
      description: 'Report created',
      content: {
        'application/json': { schema: z.object({ success: z.literal(true), data: ReportSchema }) },
      },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Cannot report your own recipe',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Recipe or user not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Already reported this recipe',
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
  path: '/api/v1/reports/me',
  tags: ['Reports'],
  summary: "List the authenticated user's own reports",
  security: [{ bearerAuth: [] }],
  request: {
    query: reportQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated list of reports filed by the authenticated user',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(ReportSchema),
            meta: PaginationMetaSchema,
          }),
        },
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
    422: {
      description: 'Invalid query params',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

// ── Shelves ───────────────────────────────────────────────────────────────────

const ShelfMetaSchema = registry.register(
  'Shelf',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    subtitle: z.string().nullable(),
    // Names the resolver that produced the contents — see src/modules/shelves/resolvers/.
    source: z.enum(shelfSourceValues),
    position: z.number().int(),
    // null until the shelf has been refreshed at least once.
    refreshedAt: z.string().datetime().nullable(),
  }),
);

const ShelfWithItemsSchema = registry.register(
  'ShelfWithItems',
  ShelfMetaSchema.extend({
    items: z.array(RecipeListItemSchema),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/shelves',
  tags: ['Shelves'],
  summary: 'List the landing-page shelves',
  description:
    'Every active shelf whose publish window contains the current time, ordered by position, each with its ' +
    'recipes in shelf order. Contents are a precomputed snapshot rewritten by `npm run shelves:refresh`, so ' +
    "this costs the same regardless of how expensive a shelf's criteria are. Shelves that currently resolve " +
    'to zero recipes are omitted, so the response never contains an empty row. Not paginated — the number of ' +
    'shelves is small and editorially controlled.',
  responses: {
    200: {
      description: 'Active shelves with their recipes',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(ShelfWithItemsSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/shelves/{slug}',
  tags: ['Shelves'],
  summary: 'Get one shelf with paginated recipes',
  description:
    'The "see all" view behind a landing-page row. Returns 404 for an unknown slug, and also for a shelf that ' +
    'is inactive or outside its publish window — an expired seasonal row is not browsable by direct link.',
  request: {
    params: z.object({ slug: z.string() }),
    query: shelfQuerySchema,
  },
  responses: {
    200: {
      description: 'Shelf metadata plus a page of its recipes',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            shelf: ShelfMetaSchema,
            data: z.array(RecipeListItemSchema),
            meta: PaginationMetaSchema,
          }),
        },
      },
    },
    404: {
      description: 'Shelf not found, inactive, or outside its publish window',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    422: {
      description: 'Invalid query params',
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
