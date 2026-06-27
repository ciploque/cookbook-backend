# cookbook-backend — Agent Reference

Backend REST API for a cooking recipes website. Users authenticate via Keycloak on the frontend; the backend validates their JWTs and serves recipe and user data.

**Stack:** TypeScript · Node.js · Express.js · PostgreSQL · Prisma ORM · Zod · Keycloak (JWKS) · Meilisearch · dotenv · pino

> **Living document:** Update this file whenever schema, endpoints, env vars, or conventions change. It is the primary reference for both humans and AI agents working on this repo.

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres and Meilisearch (dev on 5432, test on 5433, Meili on 7700)
sudo docker compose -f docker/docker-compose.yml up -d

# 3. Copy and fill env vars
cp .env.example .env

# 4. Run migrations and generate Prisma client
#    Must run in an interactive terminal (Prisma requires TTY)
npx prisma migrate dev --name init
npm run db:generate

# 5. Start dev server (hot-reload) — configures Meilisearch index on startup
npm run dev

# 6. (First run or after data import) Bulk-index existing recipes into Meilisearch
npm run meili:reindex
```

Verify: `GET http://localhost:3001/health` → `{ "status": "ok", "db": "connected" }`

---

## Folder Structure

```
cookbook-backend/
├── src/
│   ├── config/
│   │   ├── env.ts              # Zod-validated env vars, exported as typed config object; exits on missing vars
│   │   ├── database.ts         # Prisma client singleton
│   │   ├── keycloak.ts         # jwks-rsa client setup; issuer/audience constants
│   │   ├── meilisearch.ts      # MeiliSearch client singleton + RECIPES_INDEX constant
│   │   └── meilisearchSetup.ts # Configures index attributes on server startup (idempotent)
│   ├── middlewares/
│   │   ├── authenticate.ts     # JWT verification via JWKS; dev bypass via x-dev-user-sub; returns 401 on failure
│   │   ├── authorize.ts        # Ownership guard factory — verifies req.user.sub === resource owner keycloakId
│   │   ├── validate.ts         # Zod middleware factory (body / query / params)
│   │   ├── errorHandler.ts     # Global Express error handler; maps ApiError → JSON; unknown → 500
│   │   └── requestLogger.ts    # pino-http request logger with pino-pretty in development
│   ├── modules/
│   │   ├── users/
│   │   │   ├── user.router.ts
│   │   │   ├── user.controller.ts
│   │   │   ├── user.service.ts
│   │   │   └── user.schema.ts  # Zod schemas; username regex: ^[a-z0-9_-]+$
│   │   ├── recipes/
│   │   │   ├── recipe.router.ts
│   │   │   ├── recipe.controller.ts
│   │   │   ├── recipe.service.ts
│   │   │   ├── recipe.schema.ts
│   │   │   └── recipe.search.ts   # Meilisearch sync (indexRecipe/update/delete) + searchRecipesViaMeili
│   │   ├── reviews/
│   │   │   ├── review.router.ts
│   │   │   ├── review.controller.ts
│   │   │   ├── review.service.ts
│   │   │   └── review.schema.ts       # Zod schemas; rating: 1–5 int; imageUrls: optional array
│   │   ├── collections/
│   │   │   ├── collection.router.ts
│   │   │   ├── collection.controller.ts
│   │   │   ├── collection.service.ts
│   │   │   └── collection.schema.ts   # metadata schemas (no recipes); addRecipesSchema; removeRecipesSchema
│   │   ├── ingredients/
│   │   │   └── ingredient.service.ts  # Placeholder — normalization is Phase 2 scope
│   │   └── tags/
│   │       └── tag.service.ts         # upsertTags: upserts by slug, returns Tag[]
│   ├── types/
│   │   ├── express.d.ts        # Augments Express Request with req.user (KeycloakTokenPayload)
│   │   └── common.ts           # ApiResponse<T>, PaginatedResponse<T>, PaginationMeta types
│   ├── utils/
│   │   ├── ApiError.ts         # Custom error class: statusCode, message, code, details; static factories
│   │   ├── asyncHandler.ts     # Wraps async route handlers; forwards rejections to next()
│   │   ├── pagination.ts       # parsePaginationQuery, buildMeta, toSkip
│   │   └── slugify.ts          # slugify() + generateRecipeSlug() → "pasta-carbonara-a1b2"
│   ├── app.ts                  # Express app factory (no listen call); mounts all routes
│   └── server.ts               # Entry point: first import is dotenv/config; creates app; graceful shutdown
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── reindexMeilisearch.ts  # One-shot bulk reindex script: reads all recipes from DB, pushes to Meili
├── tests/
│   ├── unit/
│   │   ├── utils/
│   │   │   ├── ApiError.test.ts
│   │   │   ├── slugify.test.ts
│   │   │   └── pagination.test.ts
│   │   ├── users/
│   │   │   └── user.service.test.ts
│   │   ├── recipes/
│   │   │   └── recipe.service.test.ts
│   │   ├── reviews/
│   │   │   └── review.service.test.ts
│   │   ├── collections/
│   │   │   └── collection.service.test.ts
│   │   └── middlewares/
│   │       └── authenticate.test.ts
│   ├── integration/            # Pending — use real DB + supertest
│   └── helpers/
│       ├── testDb.ts           # Import in integration tests: sets DATABASE_URL to port 5433
│       └── fixtures.ts         # buildUser(), buildRecipe() seed helpers
├── docker/
│   └── docker-compose.yml
├── .env
├── .env.example
├── .eslintrc.json
├── .prettierrc
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

**Rules:**
- Controllers never import Prisma directly — all DB access goes through services.
- Modules never import from another module's internals. Shared logic lives in `utils/` or a dedicated service.
- Every async route handler is wrapped with `asyncHandler`.
- `import 'dotenv/config'` must be the **first import** in `server.ts` — tsx does not auto-load `.env`.

---

## Architecture

```
Request
  └─> Router
        └─> Middleware chain (authenticate → authorize → validate)
              └─> Controller   (extract params, call service, shape response)
                    └─> Service   (business logic, throws ApiError)
                          └─> Prisma   (DB queries)
                                └─> PostgreSQL
```

### Layer Responsibilities

| Layer | Responsibility |
|---|---|
| **Router** | Mount middleware, delegate to controller methods only |
| **Middleware** | Auth, ownership, validation, logging, error handling |
| **Controller** | Extract `req.body`/`params`/`query`, call service, return HTTP response |
| **Service** | All business logic and DB calls; throws `ApiError` on failure |
| **Prisma** | Type-safe DB access; migrations manage schema |

---

## Environment Variables

See `.env.example` for all values. `src/config/env.ts` validates them with Zod at startup and exits with a clear message if any required variable is missing.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | yes | — | `development` \| `test` \| `production` |
| `PORT` | no | `3000` | HTTP server port |
| `API_BASE_PATH` | no | `/api` | Base path — the code appends `/v1` per router, so set this to `/api` not `/api/v1` |
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `KEYCLOAK_URL` | yes | — | Keycloak base URL (e.g. `https://auth.example.com`) |
| `KEYCLOAK_REALM` | yes | — | Keycloak realm name |
| `KEYCLOAK_AUDIENCE` | no | — | Expected `aud` claim in JWT (recommended) |
| `ALLOWED_ORIGINS` | yes | — | Comma-separated CORS origins |
| `TRUSTED_IMAGE_DOMAINS` | no | — | Comma-separated hostnames allowed in `coverImageUrl` and `imageUrls` fields |
| `MEILISEARCH_URL` | no | `http://localhost:7700` | Meilisearch base URL |
| `MEILISEARCH_API_KEY` | no | `masterkey` | Meilisearch master key (must match `MEILI_MASTER_KEY` in docker-compose) |
| `LOG_LEVEL` | no | `info` | `trace` \| `debug` \| `info` \| `warn` \| `error` |

---

## Authentication Flow

1. User authenticates against Keycloak in the frontend. Keycloak issues an RS256-signed JWT.
2. Frontend sends `Authorization: Bearer <token>` on every API request.
3. `authenticate.ts` middleware fetches Keycloak's JWKS from `{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs` (cached via `jwks-rsa`).
4. The JWT is verified with `jsonwebtoken` using the matching public key. Invalid or expired tokens → `401 UNAUTHORIZED`.
5. The decoded payload is attached as `req.user` (typed as `KeycloakTokenPayload` in `express.d.ts`). Key claims: `sub`, `email`, `preferred_username`.
6. On the first authenticated request from a new user, `user.service.ts` auto-provisions a `User` row using `keycloakId = sub`. This happens inside `POST /users/me`.

### Dev Bypass (development only)

When `NODE_ENV=development`, `authenticate.ts` accepts a shortcut header that skips JWKS verification entirely:

```
x-dev-user-sub: <any-string>
```

This sets `req.user = { sub: "<any-string>" }` and calls `next()`. It is **never active** in `production`. Use it to test protected endpoints locally without a running Keycloak instance.

```bash
curl -H "x-dev-user-sub: my-test-user" http://localhost:3001/api/v1/users/me
```

### `req.user` Type

```typescript
interface KeycloakTokenPayload {
  sub: string;               // Keycloak user ID — used as the stable external key
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
}
```

---

## API Reference

**Base URL:** `/api/v1`
**Auth header:** `Authorization: Bearer <keycloak_jwt>` (on protected routes)

### Response Envelope

All responses use a consistent shape:

```json
// Success (single resource)
{ "success": true, "data": { ... } }

// Success (list/paginated)
{ "success": true, "data": [ ... ], "meta": { "page": 1, "limit": 20, "total": 142, "totalPages": 8, "hasNextPage": true, "hasPrevPage": false } }

// Error
{ "success": false, "error": { "code": "RECIPE_NOT_FOUND", "message": "Recipe not found", "details": null } }
```

---

### Health

| Method | Path | Auth |
|---|---|---|
| GET | `/health` | Public |

**Response:**
```json
{ "status": "ok", "db": "connected" }
```

---

### Users

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/users/me` | Required | Provision user profile (idempotent) |
| GET | `/users/me` | Required | Get own profile |
| PUT | `/users/me` | Required | Update own profile |
| GET | `/users/:userId` | Public | Get public user profile by DB id |

#### POST /users/me

Creates a `User` row using `req.user.sub` as `keycloakId`. If a row already exists for that `keycloakId`, returns it unchanged (idempotent). Call this on first login.

**Request body:**
```json
{
  "username": "string (required, 3–30 chars, ^[a-z0-9_-]+$)",
  "displayName": "string (required, max 80)",
  "avatarUrl": "string (optional, https url)"
}
```

**Response:** `201` on create, `200` on existing. Body: user object (see shape below).
**Errors:** `409 CONFLICT` if `username` is already taken.

#### PUT /users/me

**Request body (all fields optional):**
```json
{
  "username": "string (3–30 chars, ^[a-z0-9_-]+$)",
  "displayName": "string (max 80)",
  "bio": "string (max 500)",
  "avatarUrl": "string (https url)"
}
```

**Errors:** `409 CONFLICT` if `username` is already taken.

#### User Object Shape

```json
{
  "id": "uuid",
  "keycloakId": "string",
  "username": "string",
  "displayName": "string",
  "bio": "string | null",
  "avatarUrl": "string | null",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Note:** `keycloakId` is omitted from the public `GET /users/:userId` response.

---

### Recipes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/recipes` | Public | List / search recipes (paginated) |
| GET | `/recipes/:recipeId` | Public | Get single recipe by DB id (full detail) |
| POST | `/recipes` | Required | Create recipe |
| PUT | `/recipes/:recipeId` | Required + Owner | Full update (replaces ingredients, steps, tags atomically) |
| PATCH | `/recipes/:recipeId` | Required + Owner | Partial update |
| DELETE | `/recipes/:recipeId` | Required + Owner | Delete |
| GET | `/users/:userId/recipes` | Public | List recipes by a specific user (by DB id) |
| GET | `/users/:username/recipes/:recipename` | Public | Get recipe by author username + slug (human-friendly URL) |

> **Route registration order matters:** `GET /users/:username/recipes/:recipename` is registered **before** `GET /users/:userId/recipes` in `app.ts` to avoid the more-specific route being shadowed by the param wildcard.

#### GET /recipes — Query Parameters

| Param | Type | Description |
|---|---|---|
| `q` | string | Full-text search via Meilisearch (typo-tolerant, relevance-ranked); filters still apply |
| `tags` | string | Comma-separated tag slugs; recipes must match ALL tags |
| `category` | string | Filter by category string |
| `authorId` | string (uuid) | Filter by author DB id |
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `50` |
| `sortBy` | string | `createdAt` \| `updatedAt` \| `title`. Default `createdAt` |
| `order` | string | `asc` \| `desc`. Default `desc` |

#### GET /users/:username/recipes/:recipename

Returns full recipe detail for a recipe identified by the author's `username` and the recipe's `slug`. Slug uniqueness is scoped per user — two different users can have recipes with the same slug.

```
GET /api/v1/users/joao/recipes/pasta-carbonara-a1b2
```

**Errors:** `404 RECIPE_NOT_FOUND` if either the username or slug doesn't match.

#### POST /recipes — Request Body

```json
{
  "title": "string (required, max 120)",
  "description": "string (optional, max 2000)",
  "category": "string (optional)",
  "tags": ["string"],
  "prepTimeMinutes": "number (optional, min 0)",
  "servings": "number (optional, min 1)",
  "difficulty": "number (optional, min 0 — numeric rating scale)",
  "coverImageUrl": "string (optional, https url from TRUSTED_IMAGE_DOMAINS)",
  "imageUrls": ["string (optional, https urls — gallery)"],
  "ingredients": [
    {
      "name": "string (required)",
      "quantity": "number (optional, min 0)",
      "unit": "string (optional)",
      "notes": "string (optional)"
    }
  ],
  "steps": [
    {
      "order": "number (required, 1-based)",
      "instruction": "string (required)",
      "imageUrl": "string (optional)"
    }
  ]
}
```

Ingredients are stored in the order they appear in the array (`order` is auto-assigned from array index).
Steps must have unique `order` values per recipe.
Slug is generated at creation from the title + a 4-char random suffix and is **immutable**.

#### Recipe Full Detail Shape

```json
{
  "id": "uuid",
  "slug": "pasta-carbonara-a1b2",
  "title": "string",
  "description": "string | null",
  "category": "string | null",
  "tags": ["pasta", "italian"],
  "coverImageUrl": "string | null",
  "imageUrls": ["string"],
  "prepTimeMinutes": 15,
  "servings": 4,
  "difficulty": "number | null",
  "author": { "id": "uuid", "username": "string", "displayName": "string", "avatarUrl": "string | null" },
  "ingredients": [
    { "id": "uuid", "name": "string", "quantity": "number | null", "unit": "string | null", "notes": "string | null", "order": 0 }
  ],
  "steps": [
    { "id": "uuid", "order": 1, "instruction": "string", "imageUrl": "string | null" }
  ],
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

#### Recipe List Item Shape (GET /recipes)

Abbreviated — no full steps or ingredients:
```json
{
  "id": "uuid",
  "slug": "string",
  "title": "string",
  "description": "string (truncated to 200 chars)",
  "category": "string | null",
  "tags": ["string"],
  "coverImageUrl": "string | null",
  "imageUrls": ["string"],
  "prepTimeMinutes": 15,
  "difficulty": "number | null",
  "author": { "id": "uuid", "username": "string", "displayName": "string" },
  "createdAt": "ISO8601"
}
```

#### Image Upload Strategy (Phase 1)

The frontend uploads images directly to an object storage bucket (S3 or Cloudflare R2) and sends the resulting HTTPS URL as `coverImageUrl` (cover) or in the `imageUrls` array (gallery). The backend validates that each URL's hostname is in `TRUSTED_IMAGE_DOMAINS`. No multipart upload endpoint exists in Phase 1.

---

### Reviews

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/recipes/:recipeId/reviews` | Public | Paginated reviews for a recipe |
| POST | `/reviews` | Required | Create a review |

#### GET /recipes/:recipeId/reviews — Query Parameters

| Param | Type | Description |
|---|---|---|
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `50` |

#### POST /reviews — Request Body

```json
{
  "recipeId": "uuid (required)",
  "rating": "number (required, integer 1–5)",
  "content": "string (optional, max 2000)",
  "imageUrls": ["string (optional, https urls)"]
}
```

**Errors:** `404 RECIPE_NOT_FOUND` if recipe does not exist. `409 CONFLICT` if the authenticated user has already reviewed this recipe. One review per user per recipe is enforced by a DB unique constraint.

#### Review Object Shape

```json
{
  "id": "uuid",
  "recipeId": "uuid",
  "rating": 4,
  "content": "string | null",
  "imageUrls": ["string"],
  "author": { "id": "uuid", "username": "string", "displayName": "string", "avatarUrl": "string | null" },
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

**Note:** Reviews are intentionally excluded from all recipe GET responses (`getRecipeById`, `listRecipes`, `getRecipeByUsernameAndSlug`).

---

### Collections

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/:userId/collections` | Public* | List user's collections (private filtered unless owner) |
| GET | `/collections/:collectionId` | Public* | Get single collection with ordered recipes |
| POST | `/collections` | Required | Create collection (metadata only) |
| PUT | `/collections/:collectionId` | Required + Owner | Full metadata update |
| PATCH | `/collections/:collectionId` | Required + Owner | Partial metadata update |
| DELETE | `/collections/:collectionId` | Required + Owner | Delete |
| POST | `/collections/:collectionId/recipes` | Required + Owner | Add one or many recipes (with order) |
| DELETE | `/collections/:collectionId/recipes` | Required + Owner | Remove one or many recipes |
| POST | `/collections/:collectionId/follow` | Required, not owner | Follow public collection |
| DELETE | `/collections/:collectionId/follow` | Required | Unfollow |

*Private collections: 404 for single, filtered out for list, when accessed by non-owner.

#### POST /collections — Request Body

```json
{
  "name": "string (required, 1–100 chars)",
  "description": "string (optional, max 500)",
  "isPublic": "boolean (default false)"
}
```

PUT uses the same body (all fields required). PATCH makes all fields optional. **Neither PUT nor PATCH accepts a `recipes` field** — recipe membership is managed via the dedicated `/recipes` sub-routes.

#### POST /collections/:collectionId/recipes — Request Body

```json
{ "recipes": [{ "recipeId": "uuid", "order": 0 }] }
```

Uses `createMany({ skipDuplicates: true })` — adding a recipe already in the collection is a no-op.

#### DELETE /collections/:collectionId/recipes — Request Body

```json
{ "recipeIds": ["uuid", "uuid"] }
```

#### Collection Object Shape

```json
{
  "id": "uuid",
  "name": "string",
  "description": "string | null",
  "isPublic": true,
  "owner": { "id": "uuid", "username": "string", "displayName": "string", "avatarUrl": "string | null" },
  "recipes": [
    { "collectionId": "uuid", "recipeId": "uuid", "order": 0, "recipe": { "id": "uuid", "slug": "string", "title": "string", "coverImageUrl": "string | null" } }
  ],
  "followerCount": 5,
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

**Follow constraints:** Only public collections can be followed. Authors cannot follow their own collections. A `409 CONFLICT` is returned if already following.

---

### Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing, expired, or invalid JWT |
| `FORBIDDEN` | 403 | Authenticated but not the resource owner |
| `USER_NOT_FOUND` | 404 | User record not found |
| `RECIPE_NOT_FOUND` | 404 | Recipe record not found |
| `REVIEW_NOT_FOUND` | 404 | Review record not found |
| `COLLECTION_NOT_FOUND` | 404 | Collection not found or private |
| `VALIDATION_ERROR` | 422 | Request body/params/query failed Zod validation |
| `CONFLICT` | 409 | Duplicate resource (e.g. username already taken, or duplicate review/follow) |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

---

## Database Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id          String   @id @default(uuid())
  keycloakId  String   @unique           // Keycloak sub claim — stable external key
  username    String   @unique           // URL-safe handle: ^[a-z0-9_-]+$, 3–30 chars
  displayName String
  bio         String?
  avatarUrl   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  recipes Recipe[]

  @@map("users")
}

model Recipe {
  id              String   @id @default(uuid())
  slug            String                // unique per author (not globally); see @@unique below
  title           String
  description     String?
  category        String?
  coverImageUrl   String?
  imageUrls       String[]
  prepTimeMinutes Int?
  servings        Int?
  difficulty      Int?                  // numeric rating — no fixed scale enforced by DB
  authorId        String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  author      User               @relation(fields: [authorId], references: [id], onDelete: Cascade)
  ingredients RecipeIngredient[]
  steps       RecipeStep[]
  recipeTags  RecipeTag[]

  @@unique([authorId, slug])            // slug is unique per author, not globally
  @@index([authorId])
  @@index([category])
  @@map("recipes")
}

// Ingredients are stored inline per recipe (not normalized) in Phase 1.
model RecipeIngredient {
  id       String  @id @default(uuid())
  recipeId String
  name     String
  quantity Float?
  unit     String?
  notes    String?
  order    Int     @default(0)

  recipe Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@index([recipeId])
  @@map("recipe_ingredients")
}

model RecipeStep {
  id          String  @id @default(uuid())
  recipeId    String
  order       Int
  instruction String
  imageUrl    String?

  recipe Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@unique([recipeId, order])
  @@index([recipeId])
  @@map("recipe_steps")
}

// Tags are normalized: shared across recipes via join table.
model Tag {
  id   String @id @default(uuid())
  name String @unique
  slug String @unique

  recipeTags RecipeTag[]

  @@map("tags")
}

model RecipeTag {
  recipeId String
  tagId    String

  recipe Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  tag    Tag    @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([recipeId, tagId])
  @@map("recipe_tags")
}

model Review {
  id        String   @id @default(uuid())
  recipeId  String
  authorId  String
  rating    Int                       // mandatory; Zod enforces 1–5
  content   String?
  imageUrls String[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  recipe Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  author User   @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@unique([recipeId, authorId])      // one review per user per recipe
  @@index([recipeId])
  @@index([authorId])
  @@map("reviews")
}

model Collection {
  id          String   @id @default(uuid())
  ownerId     String
  name        String
  description String?
  isPublic    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner     User                 @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  recipes   CollectionRecipe[]
  followers CollectionFollower[]

  @@index([ownerId])
  @@map("collections")
}

// Recipe membership with explicit ordering. Composite PK prevents duplicate recipe in same collection.
model CollectionRecipe {
  collectionId String
  recipeId     String
  order        Int

  collection Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  recipe     Recipe     @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@id([collectionId, recipeId])
  @@index([collectionId])
  @@map("collection_recipes")
}

model CollectionFollower {
  collectionId String
  userId       String
  createdAt    DateTime @default(now())

  collection Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([collectionId, userId])
  @@map("collection_followers")
}
```

**Schema decisions:**
- `User.username` is a unique, URL-safe handle used in human-friendly recipe URLs (`/users/:username/recipes/:slug`).
- `Recipe.slug` is unique **per author** (`@@unique([authorId, slug])`), not globally. Two different users can have recipes with the same slug.
- `Recipe.slug` is generated once at creation (`{title-slug}-{4-char-suffix}`) and is **immutable**.
- `Recipe.difficulty` is a plain `Int?` — the numeric scale is defined by the frontend (e.g. 1–5 stars). No DB-level constraint beyond `min 0` enforced by Zod.
- `Recipe.description` is optional (`String?`). Missing descriptions are returned as `null` and truncated to an empty string in list items.
- `Recipe.imageUrls` is a PostgreSQL text array (`TEXT[]`, default `{}`). `coverImageUrl` is the primary display image; `imageUrls` is the gallery.
- `RecipeIngredient.name` is a plain string (no normalized `Ingredient` table). Phase 2 scope.
- `RecipeIngredient.quantity` is `Float?` — a numeric value (the unit string handles "g", "cups", etc.). Optional; omit when quantity is not applicable.
- `Recipe.category` is `String?` — optional. A `Category` model can be added in Phase 2.
- Full-text search uses Meilisearch (not `ILIKE`). Postgres is the source of truth; Meilisearch is a read index only.

---

## Error Handling

### ApiError Class (`src/utils/ApiError.ts`)

```typescript
class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code: string,       // machine-readable constant (e.g. "RECIPE_NOT_FOUND")
    public details?: unknown   // Zod field errors, extra context
  ) {
    super(message);
  }

  static unauthorized(message?)  // 401 UNAUTHORIZED
  static forbidden(message?)     // 403 FORBIDDEN
  static notFound(resource)      // 404 {RESOURCE}_NOT_FOUND
  static conflict(message)       // 409 CONFLICT
  static validation(details)     // 422 VALIDATION_ERROR
  static internal(message?)      // 500 INTERNAL_ERROR
}
```

Services throw `ApiError` instances. The global `errorHandler.ts` middleware:
- Catches all errors forwarded via `next(err)`
- Returns `ApiError` instances as-is
- Maps unknown errors to `500 INTERNAL_ERROR`
- Never leaks stack traces in `NODE_ENV=production`

Prisma's `P2002` unique constraint error is caught in services and rethrown as `ApiError.conflict(...)`.

### asyncHandler (`src/utils/asyncHandler.ts`)

Wrap every async controller method to forward unhandled rejections:

```typescript
const asyncHandler = (fn: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```

---

## Validation

Zod is the single validation library. Each module's `*.schema.ts` file exports named Zod schemas.

The `validate` middleware factory (`src/middlewares/validate.ts`) accepts a Zod schema and a target (`'body' | 'query' | 'params'`):

```typescript
validate(createRecipeSchema, 'body')
validate(recipeQuerySchema, 'query')
```

Validation failures produce a `422 VALIDATION_ERROR` response with `details` containing Zod's flattened field errors.

---

## Meilisearch Integration

Meilisearch provides typo-tolerant, relevance-ranked full-text search. Postgres remains the source of truth for all data; Meilisearch is a read-only index.

### Search routing in `listRecipes`

```
q present  →  searchRecipesViaMeili()  →  Meilisearch
q absent   →  Prisma findMany()        →  PostgreSQL
```

Both paths support `tags`, `category`, `authorId` filters and `sortBy`/`order`. The response shape is identical.

### Index configuration (`src/config/meilisearchSetup.ts`)

Called once at server startup (non-blocking, errors are logged):

| Attribute type | Fields |
|---|---|
| Searchable | `title`, `description`, `category`, `tags` |
| Filterable | `category`, `authorId`, `tags` |
| Sortable | `createdAt`, `updatedAt`, `title` |

### Sync strategy (`src/modules/recipes/recipe.search.ts`)

Index writes are **fire-and-forget** — a Meilisearch failure never fails the HTTP response. Errors are logged to stderr.

| Service function | Meilisearch call |
|---|---|
| `createRecipe` | `indexRecipe(doc)` |
| `updateRecipe` / `patchRecipe` | `updateIndexedRecipe(doc)` |
| `deleteRecipe` | `deleteIndexedRecipe(id)` |

The indexed document (`RecipeSearchDocument`) matches the list item shape — no second DB fetch needed on search responses.

### Reindexing

```bash
npm run meili:reindex   # bulk-upserts all recipes from Postgres into Meilisearch
```

Run this after first deploy or any direct database import. The script (`prisma/reindexMeilisearch.ts`) reads all recipes with their tags and author via Prisma and enqueues them as a single batch.

### Docker

Meilisearch runs as a service in `docker/docker-compose.yml` on port `7700`. The master key is set via `MEILI_MASTER_KEY` (defaults to `masterkey` in development). Data is persisted in the `meilisearch_data` volume.

### Package version note

`meilisearch@0.37.0` is pinned because v0.38+ switched to ESM-only, which is incompatible with this project's CommonJS output. Do not upgrade without converting the project to ESM first.

---

## Testing

### Running Tests

```bash
npm run test              # run all tests once
npm run test:watch        # watch mode
npm run test:coverage     # coverage report
```

### Unit Tests (119 passing)

Unit tests mock Prisma and all external dependencies — no database required. `vitest.config.ts` has no global `setupFiles` so unit tests run fully isolated.

| File | Tests | What's covered |
|---|---|---|
| `tests/unit/utils/ApiError.test.ts` | 11 | All static factory methods, prototype chain, code/statusCode mapping |
| `tests/unit/utils/slugify.test.ts` | 12 | Diacritics, special chars, slug format, random suffix uniqueness |
| `tests/unit/utils/pagination.test.ts` | 14 | Defaults, clamping, meta flags, offset calculation, falsy `limit: '0'` |
| `tests/unit/users/user.service.test.ts` | 12 | Provision (create/idempotent/conflict/unexpected error), getMe, updateMe, getUserById |
| `tests/unit/recipes/recipe.service.test.ts` | 19 | All CRUD paths, ingredient ordering, description truncation, pagination, tag mapping, getRecipeByUsernameAndSlug, Meilisearch delegation when `q` present |
| `tests/unit/recipes/recipe.search.test.ts` | 8 | Meilisearch index/update/delete sync, searchRecipesViaMeili response mapping |
| `tests/unit/reviews/review.service.test.ts` | 9 | listReviewsByRecipe (pagination, recipe not found), createReview (success, user not found, recipe not found, duplicate), getReviewAuthorKeycloakId (found, null) |
| `tests/unit/collections/collection.service.test.ts` | 25 | listCollectionsByUser (public filter, owner all, user not found), getCollectionById (public, private own, private forbidden, not found), createCollection (success, user not found), updateCollection/patchCollection (metadata only), deleteCollection (success, not found), addRecipes/removeRecipes, followCollection (success, not found, private, own, duplicate), unfollowCollection, getOwnerKeycloakId |
| `tests/unit/middlewares/authenticate.test.ts` | 8 | Dev bypass, missing/non-Bearer header, valid token, expired token, null payload, JWKS key resolution |
| `tests/unit/docs/openapi.test.ts` | 1 | Every Express route has a matching OpenAPI spec entry |

**Mock conventions for unit tests:**
- Mock `../../../src/config/database` to mock Prisma
- Mock `../../../src/modules/tags/tag.service` to isolate tag upsert
- Mock `../../../src/utils/slugify` to control slug output
- Mock `../../../src/modules/recipes/recipe.search` in recipe service tests — prevents the Meilisearch import chain from triggering `env.ts` validation
- Mock `../../../src/config/env` and `../../../src/config/keycloak` for middleware tests; include `MEILISEARCH_URL` and `MEILISEARCH_API_KEY` in the env mock object
- Use `vi.mock(path)` — paths are relative to the test file, not the project root

### Integration Tests (pending)

Integration tests use the real `cookbook_test` database on port `5433`. Import `tests/helpers/testDb.ts` in each integration test file — it sets `DATABASE_URL` and manages connection lifecycle.

```typescript
import '../helpers/testDb';
import supertest from 'supertest';
import { createApp } from '../../src/app';
```

Target: ≥70% line coverage on all service files.

### Test Databases

| DB | Port | Name |
|---|---|---|
| Dev | 5432 | `cookbook_dev` |
| Test | 5433 | `cookbook_test` |

Both run via `docker/docker-compose.yml`.

---

## Development Commands

| Command | Description |
|---|---|
| `npm run dev` | Start server with hot-reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Generate coverage report |
| `npm run lint` | Run ESLint on `src/` |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format all files with Prettier |
| `npm run db:migrate` | Create and apply a new migration (dev — requires interactive TTY) |
| `npm run db:migrate:prod` | Apply pending migrations (production) |
| `npm run db:generate` | Regenerate Prisma client after schema change |
| `npm run db:seed` | Seed development database |
| `npm run db:studio` | Open Prisma Studio |
| `npm run meili:reindex` | Bulk-index all recipes from Postgres into Meilisearch |

---

## Phase 1 Milestone Checklist

### Milestone 1 — Project Scaffold ✅
- [x] TypeScript compiles with zero errors (`npm run build`)
- [x] `GET /health` responds `{ "status": "ok", "db": "connected" }`
- [x] ESLint and Prettier configured
- [x] Docker Compose brings up Postgres on port 5432 and test DB on 5433
- [x] Prisma connects and runs initial migration successfully
- [x] `src/config/env.ts` exits with a clear error if a required env var is missing

### Milestone 2 — Authentication Middleware ✅
- [x] `authenticate.ts` fetches and caches JWKS from Keycloak
- [x] Valid Bearer tokens pass through; invalid/expired tokens return `401 UNAUTHORIZED`
- [x] `req.user` is typed and populated with `sub`, `email`, `preferred_username`
- [x] Dev bypass via `x-dev-user-sub` header (development only, never in production)
- [x] Unit tests: dev bypass, missing/invalid headers, valid/expired token, JWKS key resolution

### Milestone 3 — User Provisioning ✅
- [x] `POST /users/me` creates a User row (with `username`) if new; returns existing if already provisioned (idempotent)
- [x] `GET /users/me` returns the authenticated user's full profile
- [x] `PUT /users/me` updates `username`, `displayName`, `bio`, `avatarUrl`
- [x] `GET /users/:userId` returns public profile (no `keycloakId`)
- [x] `username` field: unique, URL-safe, 3–30 chars, `^[a-z0-9_-]+$`
- [x] Zod validation rejects invalid/missing fields with 422; duplicate username → 409 CONFLICT

### Milestone 4 — Recipe CRUD ✅
- [x] All recipe endpoints return correct HTTP status codes
- [x] POST /recipes persists ingredients (ordered), steps (ordered), tags (upserted), generates slug
- [x] PUT /recipes replaces ingredients and steps atomically inside a Prisma transaction; tags are synced
- [x] DELETE /recipes cascades to ingredients, steps, recipe_tags
- [x] `PUT`/`PATCH`/`DELETE` return `403 FORBIDDEN` when requester is not the author
- [x] All request bodies validated by Zod; invalid payloads return 422 with field-level error details
- [x] `GET /users/:username/recipes/:recipename` — human-friendly lookup by username + slug

### Milestone 5 — Search and Listing ✅
- [x] `GET /recipes` returns paginated list with correct `meta` block
- [x] `q` parameter routes to Meilisearch (typo-tolerant, relevance-ranked); `tags`/`category`/`authorId` filters apply in both paths
- [x] `tags` filter returns only recipes matching ALL specified tags
- [x] `category` filter works correctly
- [x] `sortBy` + `order` parameters work for all supported values
- [x] List items use the abbreviated shape (description truncated to 200 chars, no steps/ingredients)
- [x] Unit tests cover pagination math, tag mapping, description truncation, filter wiring, Meilisearch delegation

### Milestone 6 — Hardening 🔄
- [x] `helmet()` applies security headers
- [x] `cors()` uses `ALLOWED_ORIGINS` allowlist
- [x] Rate limiter applied to write routes
- [x] Uncaught exceptions and unhandled rejections are logged and trigger graceful shutdown
- [x] `GET /health` probes DB with `prisma.$queryRaw\`SELECT 1\``
- [x] 75 unit tests passing across 7 test files
- [ ] Integration tests written (≥70% service coverage target)
- [ ] `.env.example` comments reviewed and complete

### Milestone 7 — Meilisearch Search ✅
- [x] Meilisearch service added to `docker-compose.yml` (port 7700, persistent volume)
- [x] `MEILISEARCH_URL` / `MEILISEARCH_API_KEY` env vars with safe defaults
- [x] `src/config/meilisearch.ts` — singleton client
- [x] `src/config/meilisearchSetup.ts` — idempotent index configuration on startup
- [x] `src/modules/recipes/recipe.search.ts` — fire-and-forget sync functions + `searchRecipesViaMeili`
- [x] `recipe.service.ts` — syncs index on create/update/patch/delete; routes `q` queries to Meilisearch
- [x] `prisma/reindexMeilisearch.ts` + `npm run meili:reindex` script for bulk reindex
- [x] All existing unit tests updated to mock `recipe.search`; 75 tests passing
