# cookbook-backend — Agent Reference

Backend REST API for a cooking recipes website. Users authenticate via Clerk on the frontend; the backend validates their JWTs and serves recipe and user data.

**Stack:** TypeScript · Node.js · Express.js · PostgreSQL · Prisma ORM · Zod · Clerk (`@clerk/express`) · Meilisearch · dotenv · pino

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
│   │   ├── clerk.ts            # (removed — @clerk/express reads CLERK_SECRET_KEY from env automatically)
│   │   ├── r2.ts                # Cloudflare R2 (S3-compatible) client singleton + R2_BUCKET_NAME constant
│   │   ├── meilisearch.ts      # MeiliSearch client singleton + RECIPES_INDEX constant
│   │   └── meilisearchSetup.ts # Configures index attributes on server startup (idempotent)
│   ├── middlewares/
│   │   ├── authenticate.ts     # authenticate() — Clerk JWT verification via getAuth(); dev bypass via x-dev-user-sub; returns 401 on failure. optionalAuthenticate() — same resolution, but never rejects; populates req.user only if a valid session is present
│   │   ├── authorize.ts        # Ownership guard factory — verifies req.user.sub === resource owner authProviderId. Only a resolved `null` (resource genuinely absent) maps to 404; an unexpected error from the lookup propagates to asyncHandler → 500, it is not swallowed
│   │   ├── validate.ts         # Zod middleware factory (body / query / params)
│   │   ├── upload.ts            # multer memory-storage configs (uploadSingleImage / uploadImagesArray); translates multer errors to ApiError
│   │   ├── verifyClerkWebhook.ts # Verifies Clerk webhook signature (svix headers); sets req.clerkEvent
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
│   │   ├── tags/
│   │   │   └── tag.service.ts         # upsertTags: batch createMany+findMany by slug, returns Tag[] (2 queries regardless of input size)
│   │   ├── storage/
│   │   │   └── storage.service.ts     # Generic image storage (storeImage/deleteImage/buildImageUrl) — relative leading-slash paths only, no full URLs; reusable by any module
│   │   └── webhooks/
│   │       ├── clerk.webhook.router.ts     # POST /clerk — express.raw() body, mounted before express.json()
│   │       └── clerk.webhook.controller.ts # Dispatches on event.type; calls into users module's public service fns
│   ├── types/
│   │   ├── express.d.ts        # Augments Express Request with req.user (AuthTokenPayload) and req.clerkEvent (WebhookEvent)
│   │   └── common.ts           # ApiResponse<T>, PaginatedResponse<T>, PaginationMeta types
│   ├── utils/
│   │   ├── ApiError.ts         # Custom error class: statusCode, message, code, details; static factories
│   │   ├── asyncHandler.ts     # Wraps async route handlers; forwards rejections to next()
│   │   ├── pagination.ts       # parsePaginationQuery, buildMeta, toSkip
│   │   ├── imageSignature.ts    # detectImageType() — magic-byte sniffing (JPEG/PNG/WEBP/GIF), rejects SVG/unknown content
│   │   ├── imageUrl.ts          # trustedImageUrlSchema — Zod refinement enforcing TRUSTED_IMAGE_DOMAINS on raw-URL image fields
│   │   ├── videoUrl.ts          # trustedVideoUrlSchema — Zod refinement enforcing a fixed https-only video-platform allowlist on Recipe.videoUrl
│   │   └── slugify.ts          # slugify() + generateRecipeSlug() → "pasta-carbonara"
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
│   │   │   ├── review.service.test.ts
│   │   │   └── review.schema.test.ts
│   │   ├── collections/
│   │   │   └── collection.service.test.ts
│   │   ├── webhooks/
│   │   │   └── clerk.webhook.controller.test.ts
│   │   └── middlewares/
│   │       ├── authenticate.test.ts
│   │       └── verifyClerkWebhook.test.ts
│   ├── integration/            # Pending — use real DB + supertest
│   └── helpers/
│       ├── testDb.ts           # Import in integration tests: sets DATABASE_URL to port 5433
│       └── fixtures.ts         # buildUser(), buildRecipe() seed helpers
├── docker/
│   └── docker-compose.yml
├── .env
├── .env.example
├── eslint.config.js
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
| `CLERK_SECRET_KEY` | yes | — | Clerk secret key from the Clerk dashboard → API Keys |
| `CLERK_PUBLISHABLE_KEY` | no | — | Clerk publishable key (optional for pure backend) |
| `CLERK_WEBHOOK_SIGNING_SECRET` | yes | — | Clerk dashboard → Webhooks → Signing Secret (`whsec_...`); verifies `POST /webhooks/clerk` |
| `ALLOWED_ORIGINS` | yes | — | Comma-separated CORS origins |
| `TRUSTED_IMAGE_DOMAINS` | no | — | Comma-separated hostnames allowed in the remaining raw-URL image fields: `RecipeStep.imageUrl`, `Review.imageUrls`, and `User.avatarUrl` (enforced via `trustedImageUrlSchema` in `src/utils/imageUrl.ts`). Recipe cover/gallery images instead go through the R2 upload endpoints, not a raw URL field. These fields are always `https:`-only regardless of this var — that check is unconditional, not part of the allowlist. Empty/unset → no domain allowlist, any `https:` URL is accepted; non-`https:` schemes (`javascript:`, `data:`, etc.) are always rejected. |
| `R2_ACCOUNT_ID` | yes | — | Cloudflare account id; builds the R2 S3-compatible endpoint `https://<id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | yes | — | R2 API token access key (Dashboard → R2 → Manage API Tokens) |
| `R2_SECRET_ACCESS_KEY` | yes | — | R2 API token secret key |
| `R2_BUCKET_NAME` | yes | — | R2 bucket used for recipe cover/gallery images |
| `MEILISEARCH_URL` | no | `http://localhost:7700` | Meilisearch base URL |
| `MEILISEARCH_API_KEY` | no | `masterkey` | Meilisearch master key (must match `MEILI_MASTER_KEY` in docker-compose) |
| `LOG_LEVEL` | no | `info` | `trace` \| `debug` \| `info` \| `warn` \| `error` |

---

## Authentication Flow

1. User authenticates against Clerk in the frontend. Clerk issues an RS256-signed JWT (short-lived session token).
2. Frontend sends `Authorization: Bearer <token>` on every API request.
3. `clerkMiddleware()` in `app.ts` intercepts the request and populates Clerk auth state (reads the bearer token or session cookie). It reads `CLERK_SECRET_KEY` from the environment automatically.
4. `authenticate.ts` calls `getAuth(req).userId` (synchronous). If `userId` is null, returns `401 UNAUTHORIZED`.
5. `req.user = { sub: userId }` is set and `next()` is called. All downstream code (`authorize`, controllers, services) uses `req.user.sub` unchanged.
6. On the first authenticated request from a new user, `user.service.ts` auto-provisions a `User` row using `authProviderId = req.user.sub`. This happens inside `POST /users/me`.

### Optional Auth (`optionalAuthenticate`)

Some routes are readable by anyone but need to know *who's asking* to shape the response — e.g. `GET /collections/:collectionId` and `GET /users/:userId/collections` show private collections to their owner but 404/filter them for everyone else. Neither of these routes runs `authenticate` (that would incorrectly reject anonymous requests to what's a public-by-default endpoint). Instead they run `optionalAuthenticate`, which resolves `getAuth(req)` the same way `authenticate` does but **never rejects**: it sets `req.user` when a valid session (or dev-bypass header) is present, and just calls `next()` unauthenticated otherwise — including when `getAuth` throws on a malformed token. Downstream service code reads `req.user?.sub` and treats `undefined` as "anonymous."

Do not reach for `req.user?.sub` on a route that hasn't run either `authenticate` or `optionalAuthenticate` — `req.user` is never populated by `clerkMiddleware()` alone, only by one of these two.

### Dev Bypass (development only)

When `NODE_ENV=development`, `authenticate.ts` accepts a shortcut header that skips Clerk verification entirely:

```
x-dev-user-sub: <any-string>
```

This sets `req.user = { sub: "<any-string>" }` and calls `next()`. It is **never active** in `production`. Use it to test protected endpoints locally without a Clerk account.

```bash
curl -H "x-dev-user-sub: my-test-user" http://localhost:3001/api/v1/users/me
```

### `req.user` Type

```typescript
interface AuthTokenPayload {
  sub: string;               // Clerk user ID — used as the stable external key (authProviderId in DB)
  email?: string;
  given_name?: string;
  family_name?: string;
}
```

### Testing Auth Locally

Two ways to hit protected routes during development:

1. **Dev bypass** — fastest; skips Clerk entirely. Send `x-dev-user-sub: <any-string>` (only works in `NODE_ENV=development`). Exercises routing/validation/DB but **not** Clerk verification.
2. **Real token** — exercises the genuine `getAuth()` path. Mint a real Clerk session token without a frontend:
   ```bash
   npm run clerk:token -- <clerkUserId>   # userId from Clerk dashboard → Users (user_xxx)
   ```
   The script (`scripts/clerkToken.ts`) uses the secret key to `createSession` + `getToken`. Pass the printed JWT as `Authorization: Bearer <jwt>`. Default session tokens expire in ~60s — re-run to refresh, or pass a JWT template name as a 2nd arg for a longer-lived token.

### Clerk Webhooks (user lifecycle sync)

`POST /webhooks/clerk` receives `user.created` / `user.updated` / `user.deleted` events from Clerk (Dashboard → Webhooks → add endpoint → subscribe to the `user` events). This is **separate from JWT auth** — the route is unauthenticated in the `req.user` sense; instead `verifyClerkWebhook.ts` verifies the request came from Clerk using the `svix-id` / `svix-timestamp` / `svix-signature` headers via `@clerk/express/webhooks`' `verifyWebhook()`, checked against `CLERK_WEBHOOK_SIGNING_SECRET`.

**Why a separate raw-body route:** signature verification needs the exact, unparsed request bytes. `clerk.webhook.router.ts` applies `express.raw({ type: 'application/json' })` to only this route, and is mounted in `app.ts` **before** the global `express.json()` — otherwise the JSON parser would consume the body first and verification would fail.

| Event | Behavior |
|---|---|
| `user.created` | Auto-provisions a stub `User` row (`user.service.ts` → `provisionFromWebhook`) with a generated fallback username (Clerk's `username` field, then the email local-part, then `user-{last8ofid}`), retried with a random suffix on collision. This does **not** replace `POST /users/me` — that remains the primary path for a user-chosen username; the frontend flow (or `PUT /users/me`) can rename the stub afterwards. |
| `user.updated` | No-op (logged only). `username` / `displayName` / `bio` are app-owned via `PUT /users/me` and intentionally may diverge from Clerk's profile fields. |
| `user.deleted` | Deletes the `User` row (`deleteUserByAuthProviderId`) — cascades to recipes, reviews, collections, etc. per the schema's `onDelete: Cascade`. No-ops (doesn't error) if the user was never provisioned. |

**Local testing** — Clerk needs a public URL to reach your machine; the `x-dev-user-sub` bypass does not apply here since signature verification requires a real Clerk-signed payload:
- **ngrok** (or similar tunnel): `ngrok http 3001`, then register `https://<subdomain>.ngrok-free.app/api/v1/webhooks/clerk` as the endpoint URL in Dashboard → Webhooks. Copy the endpoint's signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`. Use the endpoint's "Testing" tab → "Send example" to fire a payload without a real signup/delete. `npm run dev:tunnel` (or `dev:tunnel:build` to also run the app inside Docker) automates the docker-compose-up + ngrok part of this.
- **Svix CLI** (`npx svix-cli listen http://localhost:3001/api/v1/webhooks/clerk`) — forwards events from Clerk (which uses Svix under the hood) straight to localhost, no public tunnel needed. Paste the printed forwarding URL into the Dashboard endpoint config.

---

## Rate Limiting

`app.set('trust proxy', 1)` is set in `createApp()` (before any middleware) so `express-rate-limit` reads the real client IP from `X-Forwarded-For` instead of the proxy's IP — required for per-client throttling to work at all behind nginx/Cloudflare/an ELB. Bump to `2`+ if a second proxy hop is added in front.

Three limiters, all `windowMs: 15 * 60 * 1000` (15 min):

| Limiter | Max | Applied to |
|---|---|---|
| `writeLimiter` | 50 | `${base}/v1/users`, `${base}/v1/reviews`, `${base}/v1/collections` (mount-level — covers every route on those routers, reads and writes alike) |
| `readLimiter` | 300 | `${base}/v1/recipes` (mount-level — covers the whole recipe router, including writes, which otherwise had no limiter), plus the cross-module GET routes: `recipeReviewsRouter`, `userRecipesRouter`, `userCollectionsRouter` |
| `uploadLimiter` | 30 | The four R2 image upload/delete routes on `recipeRouter` (stricter than `readLimiter` since image uploads are heavier) |

---

## API Reference

**Base URL:** `/api/v1`
**Auth header:** `Authorization: Bearer <clerk_session_token>` (on protected routes)

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
| GET | `/users/username/:username` | Public | Get public user profile by username (pretty-URL alternative to the above; same response shape) |

#### POST /users/me

Creates a `User` row using `req.user.sub` as `authProviderId`. If a row already exists for that `authProviderId`, returns it unchanged (idempotent). Call this on first login.

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
  "authProviderId": "string",
  "username": "string",
  "displayName": "string",
  "bio": "string | null",
  "avatarUrl": "string | null",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Note:** `authProviderId` is omitted from the public `GET /users/:userId` / `GET /users/username/:username` responses.

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
| POST | `/recipes/:recipeId/cover-image` | Required + Owner | Upload cover image (multipart, field `image`) — replaces any existing cover |
| DELETE | `/recipes/:recipeId/cover-image` | Required + Owner | Remove cover image |
| POST | `/recipes/:recipeId/images` | Required + Owner | Add gallery images (multipart, field `images`, up to 10 files per request) |
| DELETE | `/recipes/:recipeId/images` | Required + Owner | Remove gallery images by relative path |
| GET | `/users/:userId/recipes` | Public | List recipes by a specific user (by DB id) |
| GET | `/users/:username/recipes/:recipename` | Public | Get recipe by author username + slug (human-friendly URL) |

> **Route registration order matters:** `GET /users/:username/recipes/:recipename` is registered **before** `GET /users/:userId/recipes` in `userRecipesRouter` (in `recipe.router.ts`) to avoid the more-specific route being shadowed by the param wildcard. Cross-prefix routes live in their owning module's router and are exported as a named router (`userRecipesRouter`, `userCollectionsRouter`, `recipeReviewsRouter`); `app.ts` only mounts routers, it does not define routes.

#### GET /recipes — Query Parameters

| Param | Type | Description |
|---|---|---|
| `q` | string | Full-text search via Meilisearch (typo-tolerant, relevance-ranked); filters still apply |
| `tags` | string | Comma-separated tag slugs (max 500 chars, max 20 tags); recipes must match ALL tags |
| `category` | string | Filter by category string (max 100 chars). Lowercased/trimmed before matching — see Schema decisions |
| `authorId` | string (uuid) | Filter by author DB id |
| `minRating` | number | Minimum `averageRating` (1–5); recipes with no reviews are excluded |
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `50` |
| `sortBy` | string | `createdAt` \| `updatedAt` \| `title` \| `averageRating`. Default `createdAt` |
| `order` | string | `asc` \| `desc`. Default `desc` |

#### GET /users/:username/recipes/:recipename

Returns full recipe detail for a recipe identified by the author's `username` and the recipe's `slug`. Slug uniqueness is scoped per user — two different users can have recipes with the same slug.

```
GET /api/v1/users/joao/recipes/pasta-carbonara
```

**Errors:** `404 RECIPE_NOT_FOUND` if either the username or slug doesn't match.

#### POST /recipes — Request Body

```json
{
  "title": "string (required, max 120)",
  "description": "string (optional, max 2000)",
  "authorNote": "string (optional, max 300 — brief personal note from the author)",
  "category": "string (optional)",
  "tags": ["string (max 20 items)"],
  "videoUrl": "string (optional — https URL from YouTube, Vimeo, TikTok, Instagram, Facebook, or Loom)",
  "prepTimeMinutes": "number (optional, min 0)",
  "servings": "number (optional, min 1)",
  "difficulty": "number (optional, min 0 — numeric rating scale)",
  "ingredients": [
    {
      "name": "string (required, max 200)",
      "quantity": "number (optional, min 0)",
      "unit": "string (optional, max 50)",
      "notes": "string (optional, max 500)"
    }
  ],
  "steps": [
    {
      "order": "number (required, 1-based)",
      "instruction": "string (required, max 2000)",
      "imageUrl": "string (optional — must match a TRUSTED_IMAGE_DOMAINS hostname if the allowlist is configured)"
    }
  ]
}
```

`ingredients` is capped at 200 items, `steps` at 100 items (`422 VALIDATION_ERROR` beyond that).
Ingredients are stored in the order they appear in the array (`order` is auto-assigned from array index).
Steps must have unique `order` values per recipe.
Slug is generated at creation from the title (no random suffix) and is **immutable**. It's unique **per author**, not globally (`@@unique([authorId, slug])`) — creating two recipes with the same title as the same author returns `409 CONFLICT` (caught from the underlying Prisma `P2002` in `createRecipe`).

**`coverImageUrl`/`imageUrls` are not part of this body.** They're server-managed: create the recipe first, then upload images against its id via the dedicated endpoints below. A new recipe is created with both fields empty.

#### Recipe Full Detail Shape

```json
{
  "id": "uuid",
  "slug": "pasta-carbonara",
  "title": "string",
  "description": "string | null",
  "authorNote": "string | null",
  "category": "string | null",
  "tags": ["pasta", "italian"],
  "coverImageUrl": "string | null",
  "imageUrls": ["string"],
  "videoUrl": "string | null",
  "prepTimeMinutes": 15,
  "servings": 4,
  "difficulty": "number | null",
  "averageRating": "number | null",
  "reviewCount": 0,
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
  "authorNote": "string | null",
  "category": "string | null",
  "tags": ["string"],
  "coverImageUrl": "string | null",
  "imageUrls": ["string"],
  "videoUrl": "string | null",
  "prepTimeMinutes": 15,
  "difficulty": "number | null",
  "averageRating": "number | null",
  "reviewCount": 0,
  "author": { "id": "uuid", "username": "string", "displayName": "string" },
  "createdAt": "ISO8601"
}
```

#### Recipe Cover & Gallery Images (Cloudflare R2) — Phase 2

The frontend uploads image bytes directly to the backend (multipart/form-data), not to storage directly. See [Cloudflare R2 Image Storage](#cloudflare-r2-image-storage) below for the full pipeline. Summary:

| Method | Path | Field(s) | Notes |
|---|---|---|---|
| POST | `/recipes/:recipeId/cover-image` | `image` (single file) | Replaces any existing cover; old object is deleted from R2 |
| DELETE | `/recipes/:recipeId/cover-image` | — | Clears the cover; deletes the R2 object |
| POST | `/recipes/:recipeId/images` | `images` (up to 10 files) | Appends to the gallery; **422** if the gallery would exceed 10 images total |
| DELETE | `/recipes/:recipeId/images` | JSON body `{ "paths": ["/recipes/<id>/gallery/<uuid>.jpg"] }` | Removes the given relative paths; deletes the R2 objects |

All four require `authenticate` + the same owner guard as `PUT`/`PATCH`/`DELETE /recipes/:recipeId`, and a stricter `uploadLimiter` (30 requests / 15 min) than the rest of the recipes router (which has a `readLimiter`, 300 requests / 15 min — see [Rate Limiting](#rate-limiting)).

Max file size: 5MB. Allowed types: JPEG, PNG, WEBP, GIF (verified by content, not just the declared `Content-Type`). SVG is explicitly rejected (XSS risk).

**No full URLs:** `coverImageUrl`/`imageUrls` in every recipe API response are relative paths with a leading `/` (e.g. `/recipes/<id>/cover/<uuid>.jpg`), never a full `https://` URL. The frontend prepends its own base/CDN URL. `DELETE /recipes/:recipeId/images` expects `paths` to be the exact leading-slash values as returned in `imageUrls`.

`RecipeStep.imageUrl` (per-step images) is unchanged — still a raw URL field, not part of this pipeline, but now validated against `TRUSTED_IMAGE_DOMAINS` via `trustedImageUrlSchema` (see [Environment Variables](#environment-variables)). `Review.imageUrls` and `User.avatarUrl` use the same schema — `avatarUrl` is no longer a bare `z.string().url()`, since that only checks the string parses as a URL and does not restrict the scheme (`javascript:`/`data:` URIs pass it). `trustedImageUrlSchema` always requires `https:` (unconditionally, independent of whether `TRUSTED_IMAGE_DOMAINS` is configured) on top of the optional domain allowlist. `provisionFromWebhook` (`user.service.ts`) validates Clerk's `image_url` the same way before writing it, since that path bypasses the Zod schema.

---

### Reviews

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/recipes/:recipeId/reviews` | Public | Paginated reviews for a recipe |
| GET | `/recipes/:recipeId/reviews/summary` | Public | Totalized rating breakdown + media count for a recipe's reviews |
| POST | `/reviews` | Required | Create a review |

#### GET /recipes/:recipeId/reviews — Query Parameters

| Param | Type | Description |
|---|---|---|
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `50` |
| `filter` | string | Optional, not cumulative — one value at a time. `rating:1`–`rating:5` filters to a single rating; `media` filters to reviews with at least one image attached. Omit for all reviews (default). |
| `order` | string | Optional. `newest` (default, most recent first) \| `rating_asc` (lowest rating first) \| `rating_desc` (highest rating first) |

#### GET /recipes/:recipeId/reviews/summary

Totalized counts for a recipe's reviews — how many per star rating, and how many
have at least one image attached. Optimized to avoid fetching review rows: the
total comes from the already-denormalized `Recipe.reviewCount` (see
[Schema decisions](#database-schema)), and the rating breakdown / media count are
two aggregate queries (`GROUP BY rating`, and a `COUNT` filtered on non-empty
`imageUrls`) run in parallel, both scoped by the existing `@@index([recipeId])` —
no new index needed.

**Response:**
```json
{
  "totalReviews": 42,
  "ratingCounts": { "1": 0, "2": 3, "3": 5, "4": 10, "5": 24 },
  "mediaCount": 14
}
```

**Errors:** `404 RECIPE_NOT_FOUND` if recipe does not exist.

#### POST /reviews — Request Body

```json
{
  "recipeId": "uuid (required)",
  "rating": "number (required, integer 1–5)",
  "content": "string (optional, max 2000)",
  "imageUrls": ["string (optional, https urls, max 10 items, hostname must be in TRUSTED_IMAGE_DOMAINS if configured)"]
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

**Note:** Individual reviews are intentionally excluded from all recipe GET responses (`getRecipeById`, `listRecipes`, `getRecipeByUsernameAndSlug`) — only the aggregate `averageRating`/`reviewCount` on the recipe itself is included; fetch `GET /recipes/:recipeId/reviews` for the full list.

---

### Collections

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/:userId/collections` | Public* | List user's collections (private filtered unless owner) |
| GET | `/collections/:collectionId` | Public* | Get single collection with ordered recipes (first 50 only — see note below) |
| POST | `/collections` | Required | Create collection (metadata only) |
| PUT | `/collections/:collectionId` | Required + Owner | Full metadata update |
| PATCH | `/collections/:collectionId` | Required + Owner | Partial metadata update |
| DELETE | `/collections/:collectionId` | Required + Owner | Delete |
| POST | `/collections/:collectionId/recipes` | Required + Owner | Add one or many recipes (with order) |
| DELETE | `/collections/:collectionId/recipes` | Required + Owner | Remove one or many recipes |
| POST | `/collections/:collectionId/follow` | Required, not owner | Follow public collection |
| DELETE | `/collections/:collectionId/follow` | Required | Unfollow |

*Private collections: 404 for single, filtered out for list, when accessed by non-owner. Both of these `Public*` routes run `optionalAuthenticate` (not `authenticate`) so an owner's own valid session is recognized without rejecting anonymous requests — see [Optional Auth](#optional-auth-optionalauthenticate).

**Recipe count cap:** `GET /collections/:collectionId` (and the `recipes` array on every collection returned by `GET /users/:userId/collections`) includes at most the first 50 recipes, ordered by `order` — a hard cap in `collectionInclude` (`take: 50` in `collection.service.ts`), not full pagination. A collection with more than 50 saved recipes will not expose the rest via these endpoints; a dedicated paginated sub-resource (`GET /collections/:collectionId/recipes`) would be needed to reach them.

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

`recipes` is capped at 100 items per request. Uses `createMany({ skipDuplicates: true })` — adding a recipe already in the collection is a no-op.

#### DELETE /collections/:collectionId/recipes — Request Body

```json
{ "recipeIds": ["uuid", "uuid"] }
```

`recipeIds` is capped at 100 items per request.

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
| `INVALID_WEBHOOK_SIGNATURE` | 400 | `POST /webhooks/clerk` signature verification failed (bad/missing svix headers or secret mismatch) |
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
  id          String   @id @default(uuid(7)) @db.Uuid  // time-ordered UUID, native uuid column — see Schema decisions
  authProviderId  String   @unique           // Clerk userId (sub claim) — stable external key; NOT a uuid (Clerk's own id format), stays text
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
  id              String   @id @default(uuid(7)) @db.Uuid
  slug            String                // unique per author (not globally); see @@unique below
  title           String
  description     String?
  authorNote      String?
  category        String?
  coverImageUrl   String?
  imageUrls       String[]
  videoUrl        String?               // https URL, validated against a fixed video-platform allowlist — see Schema decisions
  prepTimeMinutes Int?
  servings        Int?
  difficulty      Int?                  // numeric rating — no fixed scale enforced by DB
  authorId        String   @db.Uuid
  reviewCount     Int      @default(0) // denormalized from Review — see Schema decisions
  ratingSum       Int      @default(0) // denormalized sum of Review.rating; averageRating = ratingSum / reviewCount
  averageRating   Float?                // null when reviewCount = 0
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  author      User               @relation(fields: [authorId], references: [id], onDelete: Cascade)
  ingredients RecipeIngredient[]
  steps       RecipeStep[]
  recipeTags  RecipeTag[]
  reviews     Review[]

  @@unique([authorId, slug])            // slug is unique per author, not globally
  @@index([authorId])
  @@index([category])
  @@index([averageRating])
  @@map("recipes")
}

// Ingredients are stored inline per recipe (not normalized) in Phase 1.
model RecipeIngredient {
  id       String  @id @default(uuid(7)) @db.Uuid
  recipeId String  @db.Uuid
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
  id          String  @id @default(uuid(7)) @db.Uuid
  recipeId    String  @db.Uuid
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
  id   String @id @default(uuid(7)) @db.Uuid
  name String @unique
  slug String @unique

  recipeTags RecipeTag[]

  @@map("tags")
}

model RecipeTag {
  recipeId String @db.Uuid
  tagId    String @db.Uuid

  recipe Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  tag    Tag    @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([recipeId, tagId])
  @@index([tagId])                      // reverse lookup ("recipes with tag X") — the composite PK alone only covers recipeId
  @@map("recipe_tags")
}

model Review {
  id        String   @id @default(uuid(7)) @db.Uuid
  recipeId  String   @db.Uuid
  authorId  String   @db.Uuid
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
  id          String   @id @default(uuid(7)) @db.Uuid
  ownerId     String   @db.Uuid
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
  collectionId String @db.Uuid
  recipeId     String @db.Uuid
  order        Int

  collection Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  recipe     Recipe     @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@id([collectionId, recipeId])
  @@index([collectionId])
  @@index([recipeId])                   // reverse lookup ("collections containing recipe X")
  @@map("collection_recipes")
}

model CollectionFollower {
  collectionId String @db.Uuid
  userId       String @db.Uuid
  createdAt    DateTime @default(now())

  collection Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([collectionId, userId])
  @@index([userId])                     // reverse lookup ("collections user X follows")
  @@map("collection_followers")
}
```

**Schema decisions:**
- All surrogate ids and FK columns use the native Postgres `uuid` type (`@db.Uuid`), not `text`. IDs are generated client-side as UUIDv7 (`@default(uuid(7))`, Prisma ≥5.14) rather than v4: v7 embeds a millisecond timestamp in the high bits so inserts stay roughly time-ordered (better B-tree locality on write-heavy tables) while keeping ~74 bits of randomness — equally unguessable/non-enumerable as v4 for this threat model. `User.authProviderId` is the one exception: it's Clerk's own external id format (not a UUID), so it stays `text`.
- `User.username` is a unique, URL-safe handle used in human-friendly recipe URLs (`/users/:username/recipes/:slug`).
- `Recipe.slug` is unique **per author** (`@@unique([authorId, slug])`), not globally. Two different users can have recipes with the same slug.
- `Recipe.slug` is generated once at creation (the slugified title, no suffix) and is **immutable**.
- `Recipe.difficulty` is a plain `Int?` — the numeric scale is defined by the frontend (e.g. 1–5 stars). No DB-level constraint beyond `min 0` enforced by Zod.
- `Recipe.description` is optional (`String?`). Missing descriptions are returned as `null` and truncated to an empty string in list items.
- `Recipe.authorNote` is a plain optional `String?` (max 300 chars, Zod-enforced) — a short personal note from the author, distinct from the longer `description`. It's included in Meilisearch documents for response-shape parity between the Postgres and Meilisearch list paths, but deliberately left out of `searchableAttributes`/`filterableAttributes`/`sortableAttributes` — it's supplementary text, not a search/filter/sort target.
- `Recipe.imageUrls` is a PostgreSQL text array (`TEXT[]`, default `{}`). `coverImageUrl` is the primary display image; `imageUrls` is the gallery, capped at 10 entries.
- `Recipe.coverImageUrl`/`Recipe.imageUrls` store **relative paths with a leading `/`** (e.g. `/recipes/<id>/cover/<uuid>.jpg`), not full URLs — despite the field names, kept as-is to avoid a rename migration. The API returns these paths as-is (no hydration); the frontend prepends its own base/CDN URL. `storage.service.ts#storeImage` is what produces the leading-slash form. See [Cloudflare R2 Image Storage](#cloudflare-r2-image-storage).
- `Recipe.videoUrl` is a raw, client-supplied `String?` (unlike `coverImageUrl`/`imageUrls`, which are server-managed paths) validated by `trustedVideoUrlSchema` (`src/utils/videoUrl.ts`) against a **fixed, hard-coded** allowlist of video-platform hostnames (YouTube, Vimeo, TikTok, Instagram, Facebook, Loom) — unlike `trustedImageUrlSchema`/`TRUSTED_IMAGE_DOMAINS`, this allowlist is not env-configurable and has no "allow all when unset" fallback; it's always enforced. Validation requires `https:` protocol explicitly and matches `URL.hostname` (WHATWG parser, not regex) by exact-or-subdomain equality, which closes the usual URL-allowlist bypasses (userinfo tricks like `https://youtube.com@evil.com/`, lookalike hosts like `evilyoutube.com`, suffix tricks like `youtube.com.evil.com`). Cloudflare R2 as a video origin is planned but **not yet implemented** — it needs a public R2 domain that doesn't exist in this deployment yet; adding it later means appending to `ALLOWED_VIDEO_HOSTS` (or introducing an env-driven R2 domain list), not restructuring the validator.
- `RecipeIngredient.name` is a plain string (no normalized `Ingredient` table). Phase 2 scope.
- `RecipeIngredient.quantity` is `Float?` — a numeric value (the unit string handles "g", "cups", etc.). Optional; omit when quantity is not applicable.
- `Recipe.category` is `String?` — optional. A `Category` model can be added in Phase 2. Both `createRecipeSchema.category` and `recipeQuerySchema.category` lowercase/trim the value at the Zod layer (`.trim().toLowerCase()`), so `listRecipes` can filter with a plain equality match against `@@index([category])`. Prisma's `mode: 'insensitive'` was deliberately avoided here — it compiles to a case-insensitive comparison (`ILIKE`/`LOWER()`-equivalent) that a plain B-tree index can't satisfy, forcing a sequential scan as the table grows. If you ever add a raw SQL path that writes `category` directly (bypassing the schema), normalize it the same way.
- Full-text search uses Meilisearch (not `ILIKE`). Postgres is the source of truth; Meilisearch is a read index only.
- `Recipe.reviewCount`/`ratingSum`/`averageRating` are **denormalized** rather than computed live (`AVG(rating)` / Prisma `_count`) at request time. Reason: `listRecipes` has two response paths — Postgres (`q` absent) and Meilisearch (`q` present, returns raw index-document hits with no second DB round-trip) — and a live aggregate can only cover the first path, producing an inconsistent field between browsing and searching. `POST /reviews` is currently the only write path for reviews (no update/delete route exists), so the stat update in `review.service.ts#createReview` is a simple atomic increment-and-recompute (single `UPDATE ... RETURNING`) inside the same transaction as the review insert, with no decrement/recompute-on-delete case to handle yet. `averageRating` is stored (not derived at read time from `ratingSum`/`reviewCount`) so it can be indexed, sorted (`sortBy=averageRating`), and filtered (`minRating`) directly in both Postgres and Meilisearch — the latter requires the value to already be present in the synced document. If a delete/update review endpoint is added later, its handler must recompute (not just decrement) `averageRating`/`ratingSum`/`reviewCount` from the `Review` table for that recipe.

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

**Filter string escaping:** `category` and each tag slug are user-controlled strings interpolated directly into Meilisearch's filter DSL (`category = "<value>"`). `searchRecipesViaMeili` escapes `\` and `"` via `escapeMeiliString()` before interpolating, to prevent breaking out of the filter expression. `authorId` is already UUID-validated by Zod so it can't contain `"`, but it's escaped too for consistency.

**Pagination:** `searchRecipesViaMeili` uses Meilisearch's page-based pagination (`page`/`hitsPerPage`), not `offset`/`limit` — the latter only ever returns an approximate `estimatedTotalHits`, while page-based mode returns an exact `totalHits`, which `buildMeta` needs for correct `totalPages`/`hasNextPage`.

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

## Cloudflare R2 Image Storage

Generic, provider-agnostic image storage — currently used for recipe cover/gallery images, designed to be reused by other modules (avatars, reviews) later without rework. Postgres stores (and the API returns) only a **relative path with a leading `/`**; the backend never builds a full URL — the storage provider can change, and the frontend's base/CDN URL can change, without touching stored data or the API contract.

### Pipeline

```
POST /recipes/:recipeId/(cover-image|images)
  └─> upload.ts middleware        multer memoryStorage — buffers the file(s), cheap mimetype prefilter, 5MB limit, translates multer errors to ApiError/422
        └─> recipe.service.ts     ownership already verified by authorize(); enforces the 10-image gallery cap
              └─> storage.service.ts#storeImage
                    ├─> imageSignature.ts#detectImageType   magic-byte check (JPEG/PNG/WEBP/GIF) — the real validation, not the client-declared Content-Type
                    ├─> r2Client.send(PutObjectCommand)      real R2 key (no leading slash): `<folder>/<uuid>.<ext>`, e.g. recipes/<id>/cover/<uuid>.jpg
                    └─> returns buildImageUrl(key)           leading-slash path, e.g. /recipes/<id>/cover/<uuid>.jpg
              recipe.<coverImageUrl|imageUrls> updated with the returned path(s)
```

### `src/modules/storage/storage.service.ts`

| Function | Behavior |
|---|---|
| `storeImage(buffer, folder)` | Validates content via `detectImageType`, uploads to R2 under the unprefixed key, returns the leading-slash path (`buildImageUrl(key)`). Throws `ApiError.validation(...)` on unrecognized/disallowed content. |
| `deleteImage(path)` | Accepts the stored leading-slash path, strips the `/` back off to reconstruct the real R2 key before deleting. Fire-and-forget from callers (errors are caught internally and logged, never thrown) — same pattern as the Meilisearch sync functions in `recipe.search.ts`. |
| `buildImageUrl(key)` | `` `/${key}` `` — the single seam where a raw R2 key becomes the leading-slash path stored in Postgres and returned by the API. |

### Cleanup

- Replacing a cover image deletes the old R2 object.
- Removing gallery images (`DELETE /recipes/:recipeId/images`) deletes the corresponding R2 objects.
- `deleteRecipe` fire-and-forget deletes the cover key and every gallery key (the row is loaded before the DB delete, so no bucket `ListObjectsV2` call is needed).

### Package choice

`@aws-sdk/client-s3` — R2 exposes an S3-compatible API. No content-sniffing library dependency (e.g. `file-type`) is used; `imageSignature.ts` is a small hand-written magic-byte check instead, to avoid a repeat of the `meilisearch@0.38+` ESM-only pinning trap (most such libraries dropped CommonJS support in recent majors).

---

## Testing

### Running Tests

```bash
npm run test              # run all tests once
npm run test:watch        # watch mode
npm run test:coverage     # coverage report
```

### Unit Tests (201 passing)

Unit tests mock Prisma and all external dependencies — no database required. `vitest.config.ts` has no global `setupFiles` so unit tests run fully isolated.

| File | Tests | What's covered |
|---|---|---|
| `tests/unit/utils/ApiError.test.ts` | 12 | All static factory methods, prototype chain, code/statusCode mapping, multi-word (2 and 3+) resource names in `notFound()` |
| `tests/unit/utils/slugify.test.ts` | 11 | Diacritics, special chars, slug format, deterministic slug from title |
| `tests/unit/utils/pagination.test.ts` | 14 | Defaults, clamping, meta flags, offset calculation, falsy `limit: '0'` |
| `tests/unit/users/user.service.test.ts` | 28 | Provision (create/idempotent/conflict/unexpected error, race on authProviderId with successful and failed re-fetch), getMe, updateMe, getUserById, provisionFromWebhook (username derivation/fallbacks, collision retry, race on authProviderId, retries exhausted), deleteUserByAuthProviderId (success, already-absent no-op, unexpected error) |
| `tests/unit/recipes/recipe.service.test.ts` | 36 | All CRUD paths, ingredient ordering, description truncation, pagination, tag mapping, getRecipeByUsernameAndSlug, Meilisearch delegation when `q` present, `category` plain-equality filter, `minRating` filter, `sortBy=averageRating`, cover/gallery image upload-delete, 10-image gallery cap, image cleanup on recipe delete, slug-collision `P2002` → 409 CONFLICT, unexpected create error re-thrown |
| `tests/unit/recipes/recipe.schema.test.ts` | 5 | `category` lowercased/trimmed on both write (`createRecipeSchema`) and filter (`recipeQuerySchema`); `tags` query param rejects more than 20 comma-separated slugs |
| `tests/unit/recipes/recipe.search.test.ts` | 11 | Meilisearch index/update/delete sync, searchRecipesViaMeili response mapping (page/hitsPerPage, exact `totalHits`), `minRating` filter clause, filter string escaping for `category`/tag slugs, `updateIndexedRecipeRating` partial document sync |
| `tests/unit/storage/storage.service.test.ts` | 6 | `storeImage` (returns leading-slash path, uploads to R2 with the unprefixed key, invalid content rejected via `ApiError.validation`), `deleteImage` (strips leading slash before the R2 call), `buildImageUrl` |
| `tests/unit/utils/imageSignature.test.ts` | 9 | `detectImageType` magic-byte detection for JPEG/PNG/WEBP/GIF; rejects unknown content and SVG |
| `tests/unit/utils/imageUrl.test.ts` | 4 | `trustedImageUrlSchema` — allows any URL when no allowlist configured, rejects non-URLs, accepts/rejects by hostname against `TRUSTED_IMAGE_DOMAINS` |
| `tests/unit/tags/tag.service.test.ts` | 3 | `upsertTags` — empty input short-circuits, single `createMany`+`findMany` round-trip regardless of tag count, de-duplicates names that slugify to the same value |
| `tests/unit/reviews/review.service.test.ts` | 18 | listReviewsByRecipe (pagination, recipe not found, `filter=rating:N`, `filter=media`, no filter, `order=rating_asc`/`rating_desc`/`newest`), createReview (success, user not found, recipe not found, duplicate, recomputes/syncs recipe rating stats), getReviewAuthorId (found, null), getReviewStats (recipe not found, totals from denormalized `reviewCount` + zero-filled rating breakdown + media count) |
| `tests/unit/reviews/review.schema.test.ts` | 8 | `reviewQuerySchema` — `filter` accepts `rating:1`-`rating:5`/`media`, rejects out-of-range/arbitrary values, optional; `order` defaults to `newest`, accepts `rating_asc`/`rating_desc`, rejects invalid values |
| `tests/unit/collections/collection.service.test.ts` | 27 | listCollectionsByUser (public filter, owner all, user not found), getCollectionById (public, private own, private forbidden, not found), createCollection (success, user not found), updateCollection/patchCollection (metadata only), deleteCollection (success, not found), addRecipes/removeRecipes (incl. `take: 50` cap assertion, not-found-on-re-fetch race), followCollection (success, not found, private, own, duplicate), unfollowCollection, getOwnerId |
| `tests/unit/middlewares/authenticate.test.ts` | 11 | `authenticate()`: dev bypass, missing/non-Bearer header, valid token, null userId, malformed token (401 not 500). `optionalAuthenticate()`: dev bypass, valid session, no session, malformed token — all three non-session cases call `next()` with no error instead of rejecting |
| `tests/unit/middlewares/authorize.test.ts` | 5 | Missing `req.user` → 401, resolved owner id `null` → 404, mismatched owner → 403, matching owner → `next()`, unexpected error from the lookup propagates instead of being swallowed into 404 |
| `tests/unit/middlewares/verifyClerkWebhook.test.ts` | 2 | Attaches verified event to `req.clerkEvent` on success; 400 `INVALID_WEBHOOK_SIGNATURE` on verification failure |
| `tests/unit/webhooks/clerk.webhook.controller.test.ts` | 6 | user.created (primary email selection, fallback to first email), user.deleted (with/without id), user.updated (no-op/logged), unhandled event types |
| `tests/unit/docs/openapi.test.ts` | 1 | Every Express route has a matching OpenAPI spec entry |

**Mock conventions for unit tests:**
- Mock `../../../src/config/database` to mock Prisma
- Mock `../../../src/modules/tags/tag.service` to isolate tag upsert
- Mock `../../../src/utils/slugify` to control slug output
- Mock `../../../src/modules/recipes/recipe.search` in recipe service tests — prevents the Meilisearch import chain from triggering `env.ts` validation
- Mock `../../../src/modules/storage/storage.service` in recipe service tests, and `../../../src/config/r2` (S3 client) + `../../../src/config/env` in storage service tests
- Mock `../../../src/config/env` and `../../../src/config/keycloak` for middleware tests; include `MEILISEARCH_URL` and `MEILISEARCH_API_KEY` in the env mock object
- Mock `@clerk/express/webhooks` (`verifyWebhook`) for `verifyClerkWebhook` tests, and `../../../src/modules/users/user.service` for webhook controller tests
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
| `npm run clerk:token -- <userId>` | Mint a real Clerk session token for local API testing (no frontend needed) |
| `npm run dev:tunnel` | Start `postgres`+`meilisearch` (`docker compose up -d`) then an `ngrok http 3001` tunnel — pair with `npm run dev` running locally. Requires the `ngrok` CLI |
| `npm run dev:tunnel:build` | Same, but also builds and starts the containerized `app` service (`docker compose up -d --build`) instead of running the server locally |

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
- [x] `GET /users/:userId` returns public profile (no `authProviderId`)
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
- [x] Rate limiters applied to write routes (`writeLimiter`), public read routes (`readLimiter`), and image uploads (`uploadLimiter`) — see [Rate Limiting](#rate-limiting)
- [x] `app.set('trust proxy', 1)` so rate limiting keys off the real client IP behind a reverse proxy
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

### Milestone 8 — Clerk Webhooks ✅
- [x] `CLERK_WEBHOOK_SIGNING_SECRET` env var, validated by `env.ts`
- [x] `src/middlewares/verifyClerkWebhook.ts` — verifies svix signature via `@clerk/express/webhooks`, sets `req.clerkEvent`
- [x] `src/modules/webhooks/clerk.webhook.router.ts` — `POST /webhooks/clerk`, raw body, mounted before global `express.json()`
- [x] `user.created` → `user.service.ts#provisionFromWebhook` auto-provisions a stub `User` row with a generated fallback username (collision-safe, idempotent on redelivery)
- [x] `user.deleted` → `user.service.ts#deleteUserByAuthProviderId` deletes the row (cascades); no-ops if never provisioned
- [x] `user.updated` → no-op (logged only) — app-owned profile fields are not overwritten by Clerk
- [x] Documented in OpenAPI spec (`src/docs/openapi.ts`)
- [x] Unit tests: signature verification middleware, controller event dispatch, service provision/delete paths (20 new tests)

### Milestone 9 — Recipe Image Storage (Cloudflare R2) ✅
- [x] `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` env vars, validated by `env.ts`
- [x] `src/config/r2.ts` — S3-compatible client singleton for R2
- [x] `src/utils/imageSignature.ts` — magic-byte content validation (JPEG/PNG/WEBP/GIF), rejects SVG/unknown
- [x] `src/modules/storage/storage.service.ts` — generic `storeImage`/`deleteImage`/`buildImageUrl`, reusable by any module. Relative leading-slash paths only — no full URLs; the frontend prepends its own base URL
- [x] `src/middlewares/upload.ts` — multer memory-storage configs, multer errors translated to `ApiError`/422
- [x] `POST`/`DELETE /recipes/:recipeId/cover-image` and `POST`/`DELETE /recipes/:recipeId/images` — owner-only, rate-limited
- [x] Gallery capped at 10 images total, enforced server-side against the existing count
- [x] `coverImageUrl`/`imageUrls` removed from `POST`/`PUT`/`PATCH /recipes` bodies — server-managed via the upload endpoints only
- [x] Old R2 objects cleaned up on cover replace, gallery image removal, and recipe delete
- [x] Documented in OpenAPI spec (`src/docs/openapi.ts`)
- [x] Unit tests: storage service, image signature detection, recipe service upload/delete/cap-enforcement paths
