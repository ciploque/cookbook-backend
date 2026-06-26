import './registry'; // must be first — extends Zod prototype before schemas are used
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { createRecipeSchema, updateRecipeSchema, patchRecipeSchema, recipeQuerySchema } from '../modules/recipes/recipe.schema';
import { provisionUserSchema, updateUserSchema } from '../modules/users/user.schema';

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
    category: z.string().nullable(),
    tags: z.array(z.string()),
    coverImageUrl: z.string().nullable(),
    imageUrls: z.array(z.string()),
    prepTimeMinutes: z.number().int().nullable(),
    servings: z.number().int().nullable(),
    difficulty: z.number().int().nullable(),
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
    category: z.string().nullable(),
    tags: z.array(z.string()),
    coverImageUrl: z.string().nullable(),
    imageUrls: z.array(z.string()),
    prepTimeMinutes: z.number().int().nullable(),
    difficulty: z.number().int().nullable(),
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

// ── Input schemas ─────────────────────────────────────────────────────────────

const CreateRecipeBody = registry.register('CreateRecipeBody', createRecipeSchema);
const UpdateRecipeBody = registry.register('UpdateRecipeBody', updateRecipeSchema);
const PatchRecipeBody = registry.register('PatchRecipeBody', patchRecipeSchema);
const ProvisionUserBody = registry.register('ProvisionUserBody', provisionUserSchema);
const UpdateUserBody = registry.register('UpdateUserBody', updateUserSchema);

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
  description: 'Creates a user row on first login. Idempotent — returns the existing user if already provisioned.',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: ProvisionUserBody } } },
  },
  responses: {
    201: {
      description: 'User created',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: UserSchema }) } },
    },
    200: {
      description: 'User already provisioned (idempotent)',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: UserSchema }) } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Username already taken', content: { 'application/json': { schema: ErrorSchema } } },
    422: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: UserSchema }) } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'User not found', content: { 'application/json': { schema: ErrorSchema } } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: UserSchema }) } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Username already taken', content: { 'application/json': { schema: ErrorSchema } } },
    422: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: PublicUserSchema }) } },
    },
    404: { description: 'User not found', content: { 'application/json': { schema: ErrorSchema } } },
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
    422: { description: 'Invalid query params', content: { 'application/json': { schema: ErrorSchema } } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }) } },
    },
    404: { description: 'Recipe not found', content: { 'application/json': { schema: ErrorSchema } } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }) } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: ErrorSchema } } },
    422: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }) } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: ErrorSchema } } },
    403: { description: 'Not the recipe owner', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Recipe not found', content: { 'application/json': { schema: ErrorSchema } } },
    422: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }) } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: ErrorSchema } } },
    403: { description: 'Not the recipe owner', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Recipe not found', content: { 'application/json': { schema: ErrorSchema } } },
    422: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
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
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: ErrorSchema } } },
    403: { description: 'Not the recipe owner', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Recipe not found', content: { 'application/json': { schema: ErrorSchema } } },
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
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: RecipeDetailSchema }) } },
    },
    404: { description: 'Recipe not found', content: { 'application/json': { schema: ErrorSchema } } },
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
      description: 'REST API for a cooking recipes website. Authentication is handled via Keycloak JWTs.',
    },
    servers: [{ url: serverUrl }],
  });
}
