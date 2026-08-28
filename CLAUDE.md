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
│   │   ├── env.ts              # Zod-validated env vars, exported as typed config object; exits on missing vars (and on ALLOWED_ORIGINS=* in production, via envGuards)
│   │   ├── envGuards.ts        # Pure, side-effect-free env guards (assertProductionOrigins) — kept separate from env.ts so they're unit-testable without triggering the load-time exit
│   │   ├── database.ts         # Prisma client singleton
│   │   ├── clerk.ts            # (removed — @clerk/express reads CLERK_SECRET_KEY from env automatically)
│   │   ├── r2.ts                # Cloudflare R2 (S3-compatible) client singleton + R2_BUCKET_NAME constant
│   │   ├── meilisearch.ts      # MeiliSearch client singleton + RECIPES_INDEX constant
│   │   └── meilisearchSetup.ts # Configures index attributes on server startup (idempotent)
│   ├── middlewares/
│   │   ├── authenticate.ts     # authenticate() — Clerk JWT verification via getAuth(); dev bypass via x-dev-user-sub; returns 401 on failure. optionalAuthenticate() — same resolution, but never rejects; populates req.user only if a valid session is present
│   │   ├── authorize.ts        # Ownership guard factory — verifies req.user.sub === resource owner authProviderId. Only a resolved `null` (resource genuinely absent) maps to 404; an unexpected error from the lookup propagates to asyncHandler → 500, it is not swallowed
│   │   ├── validate.ts         # Zod middleware factory (body / query / params); also rejects NUL bytes (0x00) in any validated string → 422
│   │   ├── upload.ts            # multer memory-storage configs (uploadSingleImage / uploadImagesArray); translates multer errors to ApiError
│   │   ├── verifyClerkWebhook.ts # Verifies Clerk webhook signature (svix headers); sets req.clerkEvent
│   │   ├── errorHandler.ts     # Global Express error handler; maps ApiError → JSON; body-parser errors → 413 (entity.too.large) / 400 (entity.parse.failed); unknown → 500
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
│   │   │   └── review.schema.ts       # Zod schemas; rating: 1–5 int; removeReviewImagesSchema
│   │   ├── collections/
│   │   │   ├── collection.router.ts
│   │   │   ├── collection.controller.ts
│   │   │   ├── collection.service.ts
│   │   │   └── collection.schema.ts   # metadata schemas (no recipes); addRecipesSchema; removeRecipesSchema
│   │   ├── reports/
│   │   │   ├── report.router.ts       # GET /reports/me + the cross-prefix recipeReportsRouter (POST /recipes/:recipeId/reports)
│   │   │   ├── report.controller.ts
│   │   │   ├── report.service.ts
│   │   │   └── report.schema.ts       # Zod schemas; topic enums are per target type (recipeReportTopicValues)
│   │   ├── shelves/
│   │   │   ├── shelf.router.ts        # GET /shelves + GET /shelves/:slug — public reads only
│   │   │   ├── shelf.controller.ts
│   │   │   ├── shelf.service.ts       # serving (snapshot reads) + refresh/sync (write paths, CLI-driven)
│   │   │   ├── shelf.schema.ts        # per-source criteria schemas + shelfDefinitionSchema (config validation)
│   │   │   ├── shelves.config.ts      # THE REGISTRY — checked-in themed-row definitions, source of truth
│   │   │   └── resolvers/             # the mechanism: one module per criteria kind
│   │   │       ├── types.ts           # ShelfResolver<C> interface — the extension point
│   │   │       ├── index.ts           # registry + getResolver/parseCriteria/resolveShelfItems
│   │   │       ├── query.resolver.ts    # delegates to recipe.service#listRecipes (incl. Meilisearch)
│   │   │       ├── manual.resolver.ts   # hand-pinned ordered recipe ids
│   │   │       └── trending.resolver.ts # review counts in a time window
│   │   ├── categories/
│   │   │   ├── category.router.ts     # GET /categories — the only route; no write endpoints
│   │   │   ├── category.controller.ts
│   │   │   ├── category.service.ts    # listCategories (with counts) + resolveCategories (write-path gate) + syncCategoriesFromConfig
│   │   │   ├── category.schema.ts     # categoryDefinitionSchema — validates the config file, not requests
│   │   │   └── categories.config.ts   # THE REGISTRY — checked-in curated category list, source of truth
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
│   ├── reindexMeilisearch.ts  # One-shot bulk reindex script: reads all recipes from DB, pushes to Meili
│   ├── syncCategories.ts      # Applies categories.config.ts to the DB (upsert-only, never deletes)
│   ├── syncShelves.ts         # Applies shelves.config.ts to the DB, then refreshes contents
│   └── refreshShelves.ts      # Re-resolves shelf criteria into shelf_items (all shelves, or one by slug)
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
│   │   ├── reports/
│   │   │   ├── report.service.test.ts
│   │   │   └── report.schema.test.ts
│   │   ├── categories/
│   │   │   ├── category.service.test.ts
│   │   │   └── category.schema.test.ts
│   │   ├── shelves/
│   │   │   ├── shelf.service.test.ts
│   │   │   ├── shelf.schema.test.ts
│   │   │   └── resolvers.test.ts
│   │   ├── webhooks/
│   │   │   └── clerk.webhook.controller.test.ts
│   │   ├── routers/
│   │   │   └── paramsValidation.test.ts  # mounts the real routers; asserts 422 on every uuid param route
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
| `TRUST_PROXY` | no | `1` | Number of trusted reverse-proxy hops passed to `app.set('trust proxy', …)`. Must match the real deployment topology so rate limiting keys off the true client IP, not a spoofable `X-Forwarded-For` — see [Rate Limiting](#rate-limiting). Set `0` when the app is directly reachable (no proxy) to ignore `X-Forwarded-For` entirely. |
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | yes | — | Clerk secret key from the Clerk dashboard → API Keys |
| `CLERK_PUBLISHABLE_KEY` | no | — | Clerk publishable key (optional for pure backend) |
| `CLERK_WEBHOOK_SIGNING_SECRET` | yes | — | Clerk dashboard → Webhooks → Signing Secret (`whsec_...`); verifies `POST /webhooks/clerk` |
| `ALLOWED_ORIGINS` | yes | — | Comma-separated CORS origins. `*` reflects any origin (with `credentials: true`) — allowed in dev/test only; `env.ts` **refuses to boot** if `ALLOWED_ORIGINS=*` while `NODE_ENV=production` (guarded by `assertProductionOrigins` in `src/config/envGuards.ts`). Set an explicit allowlist in production. |
| `TRUSTED_IMAGE_DOMAINS` | no | — | Comma-separated hostnames allowed in the remaining raw-URL image fields: `RecipeStep.imageUrl` and `User.avatarUrl` (enforced via `trustedImageUrlSchema` in `src/utils/imageUrl.ts`). Recipe cover/gallery images and review images instead go through the R2 upload endpoints, not a raw URL field. These fields are always `https:`-only regardless of this var — that check is unconditional, not part of the allowlist. Empty/unset → no domain allowlist, any `https:` URL is accepted; non-`https:` schemes (`javascript:`, `data:`, etc.) are always rejected. |
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

Some routes are readable by anyone but need to know *who's asking* to shape the response — e.g. `GET /collections/:collectionId` shows a private collection to its owner but 404s it for everyone else. These routes don't run `authenticate` (that would incorrectly reject anonymous requests to what's a public-by-default endpoint). Instead they run `optionalAuthenticate`, which resolves `getAuth(req)` the same way `authenticate` does but **never rejects**: it sets `req.user` when a valid session (or dev-bypass header) is present, and just calls `next()` unauthenticated otherwise — including when `getAuth` throws on a malformed token. Downstream service code reads `req.user?.sub` and treats `undefined` as "anonymous."

Routes using it:

| Route | What the caller's identity changes |
|---|---|
| `GET /collections/:collectionId` | A private collection is visible to its owner, `404` for everyone else |
| `GET /recipes/:recipeId` | Adds the viewer-scoped `hasReviewed` / `isSavedInCollection` flags |
| `GET /users/:username/recipes/:recipename` | Same flags as above — identical detail shape |

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

`app.set('trust proxy', env.TRUST_PROXY)` is set in `createApp()` (before any middleware) so `express-rate-limit` reads the real client IP from `X-Forwarded-For` instead of the proxy's IP — required for per-client throttling to work at all behind nginx/Cloudflare/an ELB. `TRUST_PROXY` defaults to `1` (one trusted hop); set it to the actual number of proxy hops in front of the app.

**Security caveat:** `trust proxy` must match the real topology exactly. If the app is reachable *without* a proxy that overwrites `X-Forwarded-For` (direct access, or more hops than configured), a client can spoof `X-Forwarded-For` to land in a fresh limiter bucket every request and bypass all rate limits. Set `TRUST_PROXY=0` when the app is directly internet-reachable so the header is ignored and the real socket IP is used.

Three limiters, all `windowMs: 15 * 60 * 1000` (15 min):

| Limiter | Max | Applied to |
|---|---|---|
| `writeLimiter` | 50 | `${base}/v1/users`, `${base}/v1/reviews`, `${base}/v1/collections` (mount-level — covers every route on those routers, reads and writes alike), plus `recipeReportsRouter` (`POST /recipes/:recipeId/reports`) — mounted under the `/recipes` prefix but deliberately given `writeLimiter` rather than inheriting that prefix's `readLimiter`, since a report is a write on an abuse-prone endpoint |
| `readLimiter` | 300 | `${base}/v1/recipes` (mount-level — covers the whole recipe router, including writes, which otherwise had no limiter) and `${base}/v1/reports` (read-only router — `GET /reports/me`), `${base}/v1/shelves` (read-only router — the landing page, served from the precomputed snapshot), `${base}/v1/categories` (read-only router — the curated registry), plus the cross-module GET routes: `recipeReviewsRouter` (including the authenticated `GET /recipes/:recipeId/reviews/me` — a read, so it keeps this router's limiter rather than the reviews module's `writeLimiter`), `userRecipesRouter`, `userCollectionsRouter` |
| `uploadLimiter` | 30 | The four R2 image upload/delete routes on `recipeRouter`, plus the two on `reviewRouter` (`POST`/`DELETE /reviews/:reviewId/images`) — stricter than the surrounding `readLimiter`/`writeLimiter` since image uploads are heavier |

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
  "about": "string (max 5000 — long-form profile body; see the note below)",
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
  "about": "string | null",
  "avatarUrl": "string | null",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Note:** `authProviderId` is omitted from the public `GET /users/:userId` / `GET /users/username/:username` responses.

**`bio` vs `about`:** two independent optional fields, both update-only (neither is accepted by
`POST /users/me` — provisioning takes `username`/`displayName`/`avatarUrl`, and the rest is
filled in later via `PUT /users/me`). `bio` is the short one-liner shown next to an avatar
(max 500); `about` is the long-form profile body (max 5000). Updating one never touches the
other, and both are returned on every user response, public and private alike.

---

### Recipes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/recipes` | Public | List / search recipes (paginated) |
| GET | `/recipes/:recipeId` | Public* | Get single recipe by DB id (full detail) |
| POST | `/recipes` | Required | Create recipe |
| PUT | `/recipes/:recipeId` | Required + Owner | Full update (replaces ingredients, steps, tags atomically) |
| PATCH | `/recipes/:recipeId` | Required + Owner | Partial update |
| DELETE | `/recipes/:recipeId` | Required + Owner | Delete |
| POST | `/recipes/:recipeId/cover-image` | Required + Owner | Upload cover image (multipart, field `image`) — replaces any existing cover |
| DELETE | `/recipes/:recipeId/cover-image` | Required + Owner | Remove cover image |
| POST | `/recipes/:recipeId/images` | Required + Owner | Add gallery images (multipart, field `images`, up to 10 files per request) |
| DELETE | `/recipes/:recipeId/images` | Required + Owner | Remove gallery images by relative path |
| GET | `/users/:userId/recipes` | Public | List recipes by a specific user (by DB id) |
| GET | `/users/:username/recipes/:recipename` | Public* | Get recipe by author username + slug (human-friendly URL) |

*The two full-detail GETs run `optionalAuthenticate`, not `authenticate` — anonymous requests are served normally, but a valid session adds the viewer-scoped `hasReviewed` / `isSavedInCollection` fields described in [Recipe Full Detail Shape](#recipe-full-detail-shape). See [Optional Auth](#optional-auth-optionalauthenticate).

> **Route registration order matters:** `GET /users/:username/recipes/:recipename` is registered **before** `GET /users/:userId/recipes` in `userRecipesRouter` (in `recipe.router.ts`) to avoid the more-specific route being shadowed by the param wildcard. Cross-prefix routes live in their owning module's router and are exported as a named router (`userRecipesRouter`, `userCollectionsRouter`, `recipeReviewsRouter`); `app.ts` only mounts routers, it does not define routes.

#### GET /recipes — Query Parameters

| Param | Type | Description |
|---|---|---|
| `q` | string | Full-text search via Meilisearch (typo-tolerant, relevance-ranked); filters still apply |
| `tags` | string | Comma-separated tag slugs (max 500 chars, max 20 tags); recipes must match ALL tags |
| `category` | string | Filter by a single category **slug** (max 100 chars, lowercased/trimmed). A recipe matches if that slug is among its categories — see [Categories](#categories) |
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

Same response shape as `GET /recipes/:recipeId`, viewer-scoped fields included — this route runs `optionalAuthenticate` too, so a recipe page reached by pretty URL knows the caller's `hasReviewed` / `isSavedInCollection` state exactly as one reached by id.

**Errors:** `404 RECIPE_NOT_FOUND` if either the username or slug doesn't match.

#### POST /recipes — Request Body

```json
{
  "title": "string (required, max 120)",
  "description": "string (optional, max 2000)",
  "authorNote": "string (optional, max 300 — brief personal note from the author)",
  "categories": ["string (category slug, max 5 items — must exist in the registry, else 422)"],
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

`ingredients` is capped at 200 items, `steps` at 100 items, `categories` at 5 (`422 VALIDATION_ERROR` beyond that).
`categories` holds **slugs from the curated registry** — an unknown one is a `422` (unlike `tags`, which are created on the fly). Resolved before the write opens, so a bad slug never leaves a partial recipe. `PUT` replaces the set; `PATCH` leaves it untouched unless the key is present, and `"categories": []` clears it.
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
  "categories": ["desserts"],
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
  "hasReviewed": false,
  "isSavedInCollection": false,
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

**Viewer-scoped fields.** `hasReviewed` (the caller already has a review row for this recipe)
and `isSavedInCollection` (the recipe is in at least one collection **owned by** the caller —
a *followed* collection doesn't count) describe the requester, not the recipe. They're always
booleans, never `null`: an anonymous caller gets `false`/`false`, so the frontend needs no
null handling.

They're returned **only** by the two full-detail GETs (`GET /recipes/:recipeId` and
`GET /users/:username/recipes/:recipename`), and are absent from list items, the Meilisearch
search path, and the `POST`/`PUT`/`PATCH`/image-endpoint responses — the index document is
shared across all viewers, and the write responses aren't viewer-scoped. In OpenAPI this is
the separate `RecipeDetailWithViewerState` schema; `RecipeDetail` itself stays viewer-agnostic.

Both flags are resolved by `resolveViewerState()` in `recipe.service.ts`: two index-backed
`findFirst`s (`Review.@@index([recipeId])`, `CollectionRecipe.@@index([recipeId])`) run in
parallel, filtered through the relation on `authProviderId` so the caller's `User` row never
has to be resolved first — and skipped entirely when the caller is anonymous.

#### Recipe List Item Shape (GET /recipes)

Abbreviated — no full steps or ingredients:
```json
{
  "id": "uuid",
  "slug": "string",
  "title": "string",
  "description": "string (truncated to 200 chars)",
  "authorNote": "string | null",
  "categories": ["string"],
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

`RecipeStep.imageUrl` (per-step images) is unchanged — still a raw URL field, not part of this pipeline, but now validated against `TRUSTED_IMAGE_DOMAINS` via `trustedImageUrlSchema` (see [Environment Variables](#environment-variables)). `User.avatarUrl` uses the same schema — `avatarUrl` is no longer a bare `z.string().url()`, since that only checks the string parses as a URL and does not restrict the scheme (`javascript:`/`data:` URIs pass it). `trustedImageUrlSchema` always requires `https:` (unconditionally, independent of whether `TRUSTED_IMAGE_DOMAINS` is configured) on top of the optional domain allowlist. `provisionFromWebhook` (`user.service.ts`) validates Clerk's `image_url` the same way before writing it, since that path bypasses the Zod schema. `Review.imageUrls` no longer accepts raw URLs at all — it now follows this R2 upload pipeline instead, same as recipe images (see [Review Images (Cloudflare R2)](#review-images-cloudflare-r2)).

---

### Categories

A recipe's categories are a **curated** normalized set: `Category` + the `RecipeCategory` join
table, structurally identical to `Tag` / `RecipeTag` but with the opposite authoring rule.
Tags are created on the fly by whatever a user types; categories are not — they come from a
checked-in registry, and a recipe write naming an unknown slug is a `422`. That's what keeps
the list free of near-duplicates ("dessert"/"desserts"/"deserts") and makes the counts below
mean something.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/categories` | Public | Every category with its recipe count |

There are deliberately **no write endpoints** — same reasoning as [Shelves](#shelves): the
codebase has no admin/role concept, and a config file gives code review and git history for
free. The registry is `src/modules/categories/categories.config.ts`, applied with
`npm run categories:sync`.

#### GET /categories

Unpaginated by design: the registry is small (tens of rows) and the caller is a category nav
that wants all of it in one request. Ordered by `name` ascending. Categories with zero recipes
are **included** — a curated category nobody has used yet is still a real nav entry (this is
the opposite of the shelves rule, where an empty row is omitted because it would render as an
empty carousel).

```json
{ "success": true, "data": [ { "id": "uuid", "name": "Desserts", "slug": "desserts", "recipeCount": 42 } ] }
```

#### Sync

```bash
npm run categories:sync
```

Validates every definition **before** writing anything (so a typo can't half-apply), then
upserts by slug — `name` is updated, `slug` is the identity key.

Unlike `shelves:sync`, this **never deletes**. A category absent from the config is reported
as a warning and left alone: `RecipeCategory` cascades on delete, so removing a category would
silently unlabel every recipe using it. Dropping one is a deliberate manual act.

Treat a shipped `slug` as immutable — it's what recipes reference and what `?category=`
filters on. `name` is just the display label and can be edited freely.

#### Where categories appear

| Surface | Shape |
|---|---|
| `POST`/`PUT`/`PATCH /recipes` body | `categories: string[]` — slugs, max 5, must exist |
| Every recipe response (detail + list + search) | `categories: string[]` |
| `GET /recipes?category=<slug>` | A single slug; matches if it's among the recipe's categories |
| Meilisearch | `categories` is a searchable + filterable array attribute, same as `tags` |

**Errors:** `422 VALIDATION_ERROR` — details `{ "categories": ["Unknown category: <slug>"] }`,
listing every unknown slug in the request.

---

### Reviews

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/recipes/:recipeId/reviews` | Public | Paginated reviews for a recipe |
| GET | `/recipes/:recipeId/reviews/summary` | Public | Totalized rating breakdown + media count for a recipe's reviews |
| GET | `/recipes/:recipeId/reviews/me` | Required | The authenticated user's own review of this recipe |
| POST | `/reviews` | Required | Create a review |
| PUT | `/reviews/:reviewId` | Required + Owner | Full update of your own review (rating + content) |
| DELETE | `/reviews/:reviewId` | Required + Owner | Delete your own review |
| POST | `/reviews/:reviewId/images` | Required + Owner | Add review images (multipart, field `images`, up to 10 files per request) |
| DELETE | `/reviews/:reviewId/images` | Required + Owner | Remove review images by relative path |

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
  "content": "string (optional, max 2000)"
}
```

**`imageUrls` is not part of this body.** It's server-managed, same as `Recipe.coverImageUrl`/`imageUrls`: create the review first, then upload images against its id via `POST /reviews/:reviewId/images`. A new review is created with `imageUrls: []`.

**Errors:** `404 RECIPE_NOT_FOUND` if recipe does not exist. `409 CONFLICT` if the authenticated user has already reviewed this recipe. One review per user per recipe is enforced by a DB unique constraint.

#### GET /recipes/:recipeId/reviews/me

The caller's own review of this recipe, in the same [Review Object Shape](#review-object-shape)
as every other review response. Resolved through the `@@unique([recipeId, authorId])`
constraint (a single indexed lookup, no scan). Intended for a recipe page that needs to know
whether the caller has already reviewed — and to prefill the edit form if so.

Unlike the two GET routes above it, this one requires auth. It's the only authenticated route
on `recipeReviewsRouter`, so it inherits that mount's `readLimiter` rather than the
`writeLimiter` the rest of the reviews module runs under — correct, since it's a read.

**Errors:** `404 RECIPE_NOT_FOUND` if the recipe doesn't exist · `404 USER_NOT_FOUND` if the
caller has no provisioned row · `404 REVIEW_NOT_FOUND` if the caller hasn't reviewed this
recipe · `422 VALIDATION_ERROR` on a non-UUID `recipeId`.

#### PUT /reviews/:reviewId — Request Body

```json
{
  "rating": "number (required, integer 1–5)",
  "content": "string (optional, max 2000)"
}
```

A **full replace**, matching `PUT` semantics elsewhere in the repo: `rating` is required, and
omitting `content` clears it (sets it to `null`). There is deliberately no `PATCH` counterpart —
the body has two fields, so a partial variant would add a route, a schema and an OpenAPI block
for no real gain.

`recipeId` and `imageUrls` are **not** updatable through this body: a review can't be moved
between recipes, and images stay server-managed via `POST`/`DELETE /reviews/:reviewId/images`.
Both are stripped by `validate()` if passed.

Recomputes the recipe's `reviewCount`/`ratingSum`/`averageRating` from the `Review` table in
the same transaction, then syncs the new values to Meilisearch — see the denormalization bullet
under [Schema decisions](#database-schema).

**Errors:** `401 UNAUTHORIZED` · `403 FORBIDDEN` if not the review's author · `404 RESOURCE_NOT_FOUND`
if the review doesn't exist (raised by the owner guard, which resolves before the service — the
same generic code `DELETE /recipes/:recipeId` returns for a missing recipe; the service's own
`REVIEW_NOT_FOUND` only fires if the row disappears between the two) ·
`422 VALIDATION_ERROR` on a non-UUID `reviewId` or an invalid body.

#### DELETE /reviews/:reviewId

Deletes the caller's own review. Returns `204` with no body (same convention as
`DELETE /recipes/:recipeId` and `DELETE /collections/:collectionId`).

Side effects, in order: the review row is deleted and the recipe's rating stats recomputed in
one transaction, the new stats are pushed to Meilisearch, and every image attached to the review
is deleted from R2 (fire-and-forget, same as `deleteRecipe`). Deleting the only review of a
recipe resets it to `reviewCount: 0`, `ratingSum: 0`, `averageRating: null`.

Because the one-review-per-user unique constraint is on the row itself, deleting frees the user
to review that recipe again — unlike reports, which have no withdrawal route.

**Errors:** `401 UNAUTHORIZED` · `403 FORBIDDEN` if not the review's author · `404 RESOURCE_NOT_FOUND`
if the review doesn't exist (from the owner guard — see the note on `PUT` above) ·
`422 VALIDATION_ERROR` on a non-UUID `reviewId`.

#### Review Images (Cloudflare R2)

Same pipeline as [Recipe Cover & Gallery Images](#recipe-cover--gallery-images-cloudflare-r2--phase-2) — see [Cloudflare R2 Image Storage](#cloudflare-r2-image-storage) for the shared mechanics.

| Method | Path | Field(s) | Notes |
|---|---|---|---|
| POST | `/reviews/:reviewId/images` | `images` (up to 10 files) | Appends to the review's images; **422** if it would exceed 10 images total |
| DELETE | `/reviews/:reviewId/images` | JSON body `{ "paths": ["/reviews/<id>/gallery/<uuid>.jpg"] }` | Removes the given relative paths; deletes the R2 objects |

Both require `authenticate` + an owner guard (`req.user.sub` must match the review's author, same `authorize()` factory as recipes) and the same stricter `uploadLimiter` (30 requests / 15 min) recipes use for image routes — stacked on top of the `writeLimiter` this router is otherwise mounted under (see [Rate Limiting](#rate-limiting)). Images are stored under `reviews/<reviewId>/gallery/<uuid>.jpg`. `DELETE /reviews/:reviewId` cleans these up the same way `deleteRecipe` does — the row is loaded before the delete, so every stored path is known without a bucket listing.

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

### Reports

Content moderation. All reports — for recipes, reviews and users — live in a single
`reports` table; only the **recipe** path is implemented (see
[Schema decisions](#database-schema) for why one table with typed FK columns rather
than a table per reportable entity).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/recipes/:recipeId/reports` | Required | Report a recipe (one per user per recipe) |
| GET | `/reports/me` | Required | Paginated list of reports filed by the authenticated user |

#### POST /recipes/:recipeId/reports — Request Body

```json
{
  "topic": "string (required — one of the recipe topics below)",
  "message": "string (optional, max 2000)"
}
```

**Recipe report topics** (`recipeReportTopicValues` in `report.schema.ts`):
`spam` · `inappropriate_content` · `copyright` · `dangerous_instructions` ·
`misleading_recipe` · `other`

Topic lists are **per target type** — a recipe report and a review report describe
different problems, so each reportable entity gets its own `*TopicValues` list and
its own create schema rather than one flattened union. `targetType` is server-set
(`"recipe"` on this route), never client-supplied.

**Errors:** `404 RECIPE_NOT_FOUND` if the recipe doesn't exist · `404 USER_NOT_FOUND`
if the reporter has no provisioned row · `403 FORBIDDEN` when reporting your own
recipe (same convention as "authors cannot follow their own collections") ·
`409 CONFLICT` if you've already reported this recipe · `422 VALIDATION_ERROR` on an
unknown topic or a non-UUID `recipeId`.

> Like every other UUID route param in the API, `recipeId` is validated before it reaches
> Prisma — see [Route Param Validation](#route-param-validation).

#### GET /reports/me — Query Parameters

| Param | Type | Description |
|---|---|---|
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `50` |

Ordered `createdAt` descending. **Errors:** `404 USER_NOT_FOUND`.

#### Report Object Shape

```json
{
  "id": "uuid",
  "targetType": "recipe",
  "topic": "spam",
  "message": "string | null",
  "status": "pending",
  "recipe": { "id": "uuid", "slug": "string", "title": "string", "coverImageUrl": "string | null" },
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

`recipe` is populated when `targetType` is `"recipe"` and `null` otherwise. The
reporter is deliberately omitted — it's always the authenticated caller on both
routes. `status` (`pending` | `reviewed` | `dismissed`) is present but **no endpoint
writes it yet**; it exists so a future moderation queue needs no migration.

**Not implemented:** any moderation/admin endpoint (list all reports, change
`status`), report withdrawal (`DELETE /reports/:reportId`), and review/user reports.
Note the consequence of no withdrawal route: the unique constraint means a user who
reports a recipe can never report it again.

---

### Collections

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/:userId/collections` | Public | List a user's public collections |
| GET | `/users/me/collections` | Required | List all (public + private) collections owned by the authenticated user |
| GET | `/collections/:collectionId` | Public* | Get single collection with ordered recipes (first 50 only — see note below) |
| POST | `/collections` | Required | Create collection (metadata only) |
| PUT | `/collections/:collectionId` | Required + Owner | Full metadata update |
| PATCH | `/collections/:collectionId` | Required + Owner | Partial metadata update |
| DELETE | `/collections/:collectionId` | Required + Owner | Delete |
| POST | `/collections/:collectionId/recipes` | Required + Owner | Add one or many recipes (with order) |
| DELETE | `/collections/:collectionId/recipes` | Required + Owner | Remove one or many recipes |
| POST | `/collections/:collectionId/follow` | Required, not owner | Follow public collection |
| DELETE | `/collections/:collectionId/follow` | Required | Unfollow |

*Private collections: 404 when a non-owner accesses `GET /collections/:collectionId` directly. That route runs `optionalAuthenticate` (not `authenticate`) so an owner's own valid session is recognized without rejecting anonymous requests — see [Optional Auth](#optional-auth-optionalauthenticate). `GET /users/:userId/collections` and `GET /users/me/collections` are deliberately separate endpoints instead of one auth-dependent route: the former is unconditionally public-only (no auth involved at all), the latter requires a valid session and always returns the full set for that session's own user — see the note on `userCollectionsRouter` route registration order below.

**Route registration order:** `GET /users/me/collections` is registered **before** `GET /users/:userId/collections` in `userCollectionsRouter` (`collection.router.ts`) so the literal `me` segment isn't swallowed by the `:userId` wildcard — same pattern as `GET /users/:username/recipes/:recipename` vs `GET /users/:userId/recipes` in `recipe.router.ts`.

**Recipe count cap:** `GET /collections/:collectionId` (and the `recipes` array on every collection returned by `GET /users/:userId/collections` / `GET /users/me/collections`) includes at most the first 50 recipes, ordered by `order` — a hard cap in `collectionInclude` (`take: 50` in `collection.service.ts`), not full pagination. A collection with more than 50 saved recipes will not expose the rest via these endpoints; a dedicated paginated sub-resource (`GET /collections/:collectionId/recipes`) would be needed to reach them.

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

### Shelves

Themed recipe rows for the landing page ("Recently Added", "Top Drinks", a seasonal
Halloween row). The point of the module is **not** any particular row — it's a mechanism
for defining new ones without writing new code.

Three ideas carry it:

1. **A shelf is a saved query.** `Shelf.criteria` is a JSONB blob interpreted by the
   resolver named in `Shelf.source`. The `query` resolver simply calls
   `recipeService.listRecipes`, so a shelf inherits every filter `GET /recipes` supports —
   tag AND-ing, category equality, `minRating`, sorting, and Meilisearch free-text — and
   can never drift from it.
2. **Contents are a precomputed snapshot.** A refresh job resolves criteria and writes the
   ordered recipe ids into `shelf_items`. Serving the landing page is then one indexed
   query no matter how many shelves exist or how expensive their criteria are.
3. **Authoring is a checked-in file, not an API.** `src/modules/shelves/shelves.config.ts`
   is the source of truth, applied by `npm run shelves:sync`. There are deliberately **no
   write endpoints** — the codebase has no admin/role concept, and a config file gives
   code review and git history for free.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/shelves` | Public | All live shelves with their recipes — the landing page |
| GET | `/shelves/:slug` | Public | One shelf, paginated recipes ("see all") |

#### The resolver registry — how to add a new kind of row

Each `source` is a module in `src/modules/shelves/resolvers/` implementing `ShelfResolver<C>`:
a Zod schema for its own criteria, plus `resolve(criteria, maxItems) → ordered recipe ids`.

| Source | Criteria | Behavior |
|---|---|---|
| `query` | subset of `recipeQuerySchema` (`q`, `tags`, `category`, `authorId`, `minRating`, `sortBy`, `order`) | Delegates to `listRecipes`. Covers most rows. |
| `manual` | `{ recipeIds: string[] }` | Hand-pinned, order preserved exactly. The editorial escape hatch for a row no query can express. Ids whose recipe no longer exists are dropped rather than failing the refresh. |
| `trending` | `{ windowDays, tags?, category? }` | Ranks by review count inside the window (`Review.createdAt` + the existing `@@index([recipeId])`). Time-windowed popularity is the one thing all-time `averageRating` cannot express. Built on existing data — no view counter, no rollup table, no migration. |

**To add a new theme kind:** write `resolvers/<name>.resolver.ts`, register it in
`resolvers/index.ts`, add its name to `shelfSourceValues`. No migration (criteria is JSON),
no change to the refresh job, the serving path, or the API contract.

**`maxItems` is capped at 50** because the `query` resolver runs through
`recipeQuerySchema`, whose `limit` maxes at 50. Fine for a carousel; `GET /shelves/:slug`
pages beyond it.

#### Publish windows

`startsAt`/`endsAt` are optional. A shelf outside its window is invisible to **both**
endpoints — a seasonal row activates and retires on its own, and an expired one 404s on
direct link rather than being browsable. No refresh or manual toggle is involved: the
window is evaluated per request.

Shelves that currently hold zero recipes are **omitted** from `GET /shelves`, so the
frontend never renders a headed row with nothing in it.

#### Refreshing

```bash
npm run shelves:sync                  # apply config -> DB, then refresh everything
npm run shelves:refresh               # re-resolve all shelves
npm run shelves:refresh -- top-drinks # just one
```

`sync` validates every definition — shape *and* criteria against its declared resolver —
**before** writing anything, so a typo can't half-apply. Shelves absent from the config are
deleted (the file is the source of truth). Each shelf's snapshot is rewritten inside one
transaction, so a concurrent reader never sees a half-empty row, and a single failing shelf
doesn't abort the rest of the batch.

**Freshness is a function of refresh cadence** — "Recently Added" is the most sensitive
row. Run `shelves:refresh` from the host's cron or the platform scheduler (every 15 minutes
is ample). There is deliberately no in-process scheduler and no new npm dependency.

#### Shelf Object Shape

```json
{
  "id": "uuid",
  "slug": "top-drinks",
  "title": "Top Drinks",
  "subtitle": "string | null",
  "source": "query",
  "position": 0,
  "refreshedAt": "ISO8601 | null",
  "items": [ /* Recipe List Item shape — identical to GET /recipes */ ]
}
```

`items` uses the exact same shape as `GET /recipes` list items, via the `recipeListSelect` /
`formatRecipeListItem` pair exported from `recipe.service.ts` — exported precisely so the
two can't drift. `criteria` is authoring detail and is **not** exposed by the API.

`GET /shelves/:slug` returns `{ success, shelf, data, meta }` — shelf metadata alongside a
standard paginated `data`/`meta` pair.

**Errors:** `404 SHELF_NOT_FOUND` · `422 VALIDATION_ERROR` on bad pagination params.

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
| `SHELF_NOT_FOUND` | 404 | Shelf not found, inactive, or outside its publish window |
| `VALIDATION_ERROR` | 422 | Request body/params/query failed Zod validation — including a malformed UUID in any route param (see [Route Param Validation](#route-param-validation)), and a NUL byte (`0x00`) in any validated string (rejected centrally in `validate.ts` since PostgreSQL `text` can't store it) |
| `CONFLICT` | 409 | Duplicate resource (e.g. username already taken, or duplicate review/follow) |
| `PAYLOAD_TOO_LARGE` | 413 | Request body exceeds the `express.json` size limit (body-parser `entity.too.large`, mapped in `errorHandler.ts`) |
| `INVALID_JSON` | 400 | Malformed JSON in the request body (body-parser `entity.parse.failed`) |
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
  bio         String?                     // short one-liner shown next to an avatar (max 500, Zod)
  about       String?                     // long-form profile body (max 5000, Zod) — see the bio-vs-about note
  avatarUrl   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  recipes Recipe[]
  reports Report[] @relation("ReportReporter")

  @@map("users")
}

model Recipe {
  id              String   @id @default(uuid(7)) @db.Uuid
  slug            String                // unique per author (not globally); see @@unique below
  title           String
  description     String?
  authorNote      String?
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

  author           User               @relation(fields: [authorId], references: [id], onDelete: Cascade)
  ingredients      RecipeIngredient[]
  steps            RecipeStep[]
  recipeTags       RecipeTag[]
  recipeCategories RecipeCategory[]   // categories are normalized + curated — see Schema decisions
  reviews          Review[]
  reports          Report[]

  @@unique([authorId, slug])            // slug is unique per author, not globally
  @@index([authorId])
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

// Structurally identical to Tag/RecipeTag, but *curated*: rows come from the checked-in
// registry via `npm run categories:sync`, never from a recipe write. See Schema decisions.
model Category {
  id   String @id @default(uuid(7)) @db.Uuid
  name String @unique
  slug String @unique                    // what recipes reference and `?category=` filters on — treat as immutable

  recipeCategories RecipeCategory[]

  @@map("categories")
}

model RecipeCategory {
  recipeId   String @db.Uuid
  categoryId String @db.Uuid

  recipe   Recipe   @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@id([recipeId, categoryId])
  @@index([categoryId])                 // reverse lookup ("recipes in category X") — the composite PK alone only covers recipeId
  @@map("recipe_categories")
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

// One table for every kind of report, with a real typed FK per reportable entity
// rather than an untyped targetId — see Schema decisions.
model Report {
  id         String   @id @default(uuid(7)) @db.Uuid
  targetType String                       // "recipe" | "review" | "user" — Zod-validated, server-set
  topic      String                       // per-target-type Zod enum, see report.schema.ts
  message    String?
  status     String   @default("pending") // pending | reviewed | dismissed — no endpoint writes this yet
  reporterId String   @db.Uuid
  recipeId   String?  @db.Uuid            // set when targetType = "recipe"
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  reporter User    @relation("ReportReporter", fields: [reporterId], references: [id], onDelete: Cascade)
  recipe   Recipe? @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@unique([recipeId, reporterId])      // one report per user per recipe; see Schema decisions re: NULLs
  @@index([reporterId])                 // GET /reports/me
  @@map("reports")
}

// A themed landing-page row. `source` names a resolver; `criteria` is that resolver's own
// Zod-validated payload — so a new kind of theme is a new resolver, not a migration.
model Shelf {
  id          String    @id @default(uuid(7)) @db.Uuid
  slug        String    @unique
  title       String
  subtitle    String?
  source      String                       // "query" | "manual" | "trending" — see resolvers/
  criteria    Json                         // resolver-specific, validated per source at sync time
  maxItems    Int       @default(20)       // capped at 50 — see the Shelves API section
  position    Int       @default(0)        // landing-page order
  isActive    Boolean   @default(true)
  startsAt    DateTime?                    // publish window — seasonal rows self-activate/retire
  endsAt      DateTime?
  refreshedAt DateTime?                    // null until first refresh
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  items ShelfItem[]

  @@index([isActive, position])            // the landing-page read
  @@map("shelves")
}

// The precomputed snapshot of a shelf's contents.
model ShelfItem {
  shelfId  String @db.Uuid
  recipeId String @db.Uuid
  order    Int

  shelf  Shelf  @relation(fields: [shelfId], references: [id], onDelete: Cascade)
  recipe Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@id([shelfId, recipeId])
  @@index([shelfId, order])
  @@map("shelf_items")
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
- **Categories are normalized and curated** (`Category` + `RecipeCategory`), replacing the former `Recipe.category String?` column and its `@@index([category])`. Two decisions worth keeping straight:
  - *Normalized, many-to-many.* A recipe carries up to 5 category slugs; `GET /recipes?category=<slug>` matches through the join table (`recipeCategories: { some: { category: { slug } } }`), scoped by the unique — therefore indexed — `Category.slug`. The old string column couldn't answer "every category and how many recipes each has" without a `GROUP BY` over the whole recipes table, which is exactly what `GET /categories` needs; nor could it stop two spellings of the same category from coexisting.
  - *Curated, unlike tags.* Same shape as `Tag`/`RecipeTag`, opposite authoring rule: `upsertTags` creates unseen tags on the fly, while `resolveCategories` only ever **reads** and throws `422` on an unknown slug. The registry is `categories.config.ts`, applied by `npm run categories:sync` — a code change with git history, not an admin action, following the same reasoning as `shelves.config.ts`. Category resolution happens *before* the recipe transaction opens, so a bad slug can't leave a half-written recipe.
  - *Sync never deletes.* `shelves:sync` deletes rows absent from its config safely — a shelf owns nothing. A `Category` is referenced by `RecipeCategory` rows that cascade, so deleting one would silently unlabel every recipe using it. `syncCategoriesFromConfig` upserts and reports extras instead.
  - The lowercase-at-the-Zod-layer normalization survives the migration (`createRecipeSchema.categories` and `recipeQuerySchema.category` both `.trim().toLowerCase()`), now so the value matches `Category.slug` directly. Prisma's `mode: 'insensitive'` is still deliberately avoided: it compiles to an `ILIKE`/`LOWER()`-equivalent comparison a plain B-tree index can't satisfy.
- `User.bio` and `User.about` are two independent optional fields, not one field with a length dial: `bio` is the short one-liner rendered next to an avatar (max 500), `about` is the long-form profile body (max 5000). Both are update-only — `provisionUserSchema` deliberately accepts neither, since first-login provisioning has nothing to put in them. Caps are Zod-enforced only; both are plain `String?` in Postgres, consistent with every other free-text field here.
- Full-text search uses Meilisearch (not `ILIKE`). Postgres is the source of truth; Meilisearch is a read index only.
- `Recipe.reviewCount`/`ratingSum`/`averageRating` are **denormalized** rather than computed live (`AVG(rating)` / Prisma `_count`) at request time. Reason: `listRecipes` has two response paths — Postgres (`q` absent) and Meilisearch (`q` present, returns raw index-document hits with no second DB round-trip) — and a live aggregate can only cover the first path, producing an inconsistent field between browsing and searching. Every review write path updates these stats inside the same transaction as the review write itself, and then pushes the result to Meilisearch via `updateIndexedRecipeRating`. `createReview` uses a single atomic increment-and-recompute (`UPDATE ... RETURNING`), since an insert's effect on the aggregate is known without reading the table. `updateReview` and `deleteReview` can't be expressed as an increment (a rating *change* isn't a delta of one), so they share `recomputeRecipeRatingStats(recipeId)` in `review.service.ts` — one `UPDATE recipes ... FROM (SELECT count(*), sum(rating) FROM reviews WHERE "recipeId" = $1) ... RETURNING` that recomputes all three columns **from the `Review` table**, and sets `averageRating` back to `NULL` when the last review is removed. Recomputing from source also self-heals any drift as a side effect. Ordering matters: `$transaction([...])` runs its array in order, so the review write is placed first and the aggregate sees the new state. Any future review write path must do the same. `averageRating` is stored (not derived at read time from `ratingSum`/`reviewCount`) so it can be indexed, sorted (`sortBy=averageRating`), and filtered (`minRating`) directly in both Postgres and Meilisearch — the latter requires the value to already be present in the synced document.
- `Review.imageUrls` is populated only via `POST`/`DELETE /reviews/:reviewId/images` (Cloudflare R2) — not accepted in the `POST /reviews` body — same pattern as `Recipe.coverImageUrl`/`imageUrls`. See [Review Images (Cloudflare R2)](#review-images-cloudflare-r2).
- `Report` is **one table for every reportable entity**, not a table per entity. Moderation is inherently cross-entity ("show me the open queue"); three parallel tables would mean three services, three paginators, three OpenAPI blocks, and a manual merge/sort for any admin view. What it deliberately avoids is the usual polymorphic shortcut — a `targetType` plus an untyped `targetId String` — which has no foreign key at all: deleting a recipe would silently orphan its reports, and a typo'd UUID would insert happily. Instead `targetType` records intent for reading, and each reportable entity gets its own **nullable, real FK column** (`recipeId` today; `reviewId`/`reportedUserId` are additive later), each with `onDelete: Cascade`. No join table and no write-time transaction.
- `Report`'s one-report-per-user rule is `@@unique([recipeId, reporterId])`. PostgreSQL treats NULLs as distinct in a unique index, so rows for other target types (`recipeId = NULL`) never collide with each other — the constraint is naturally scoped per target type, and each new FK column brings its own `@@unique([<fk>, reporterId])`. The `P2002` is caught in `report.service.ts#createRecipeReport` and rethrown as `ApiError.conflict(...)`, same as `createReview`/`followCollection`.
- **Not yet enforced at the DB level:** "exactly one target FK is non-null, and it matches `targetType`". Prisma can't express a CHECK constraint, so it needs hand-written SQL. With a single target type the service is the only writer and always sets `recipeId`, so the constraint has near-zero value today — add it in the same migration that introduces the second target type:
  ```sql
  ALTER TABLE reports ADD CONSTRAINT reports_exactly_one_target CHECK (
    num_nonnulls(recipe_id, review_id, reported_user_id) = 1
  );
  ```
- `Report.topic` and `Report.status` are plain `String` (not Prisma enums), consistent with `Recipe.category`/`Review.rating` — the schema has no enums anywhere. Allowed values live in `report.schema.ts` as `as const` arrays feeding `z.enum(...)`, so adding a topic is a code change with no migration; the trade-off is that the DB accepts anything written outside the API. Topic lists are **per target type** (`recipeReportTopicValues`), since the valid complaints about a recipe differ from those about a review or a user.
- `Shelf.criteria` is **JSONB in Postgres**, not a document database and not a Meilisearch index. The alternatives were considered and rejected: Meilisearch is a read index rebuilt from Postgres, so it is the wrong home for authored data that nothing else can regenerate; a document DB would add a stack component, an ops surface and a monthly bill to store a table that holds ~20 rows. JSONB gives the schema-flexibility that motivated those options (every resolver stores a different criteria shape) with zero new infrastructure, and the shape is still validated — by the resolver's own Zod schema at sync time, not by the column.
- **Shelf contents are a denormalized snapshot** (`ShelfItem`) rather than resolved per request. The landing page is the hottest endpoint and fans out to one query *per row*; resolving live would put N queries — including expensive aggregates like `trending` — on every pageview. With a snapshot the whole page is one indexed read regardless of shelf count or criteria cost, and expensive criteria run once per refresh instead of once per viewer. The trade-off is staleness bounded by refresh cadence, which is why `shelves:refresh` is meant to run on a schedule. `refreshedAt` records when each shelf was last resolved.
- `Shelf.source` is a plain `String` naming a resolver, and `criteria` is deliberately **not** typed per source at the DB level — the same reasoning as `Report.topic`: allowed values live in `shelfSourceValues` as an `as const` array, so adding a kind of themed row is a code change with no migration. The cost is that a hand-written SQL insert could store an unknown source; `refreshShelf` fails loudly on one (naming the known sources) rather than silently serving an empty row.
- `ShelfItem` has no `createdAt` and no surrogate id: it is derived data, fully rewritten on every refresh, so there is nothing to track. `onDelete: Cascade` on `recipeId` means a deleted recipe drops out of every shelf immediately, with no cleanup job and no dangling id — the snapshot is allowed to shrink between refreshes but never to break.

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
validate(recipeParamsSchema, 'params')
```

Validation failures produce a `422 VALIDATION_ERROR` response with `details` containing Zod's flattened field errors.

### Route Param Validation

**Every route param holding a UUID is validated.** PostgreSQL `uuid` columns reject a
malformed value, and Prisma raises `P2023` — which the error handler can only map to a
`500 INTERNAL_ERROR`. Validating at the router turns that into a clean `422` instead:

```typescript
const validateRecipeId = validate(recipeParamsSchema, 'params');
```

Two rules when adding a parameterized route:

1. **Params validation runs before the ownership guard.** `authorize()` resolves the
   owner through Prisma, so an unvalidated UUID would hit the database inside the guard
   and 500 there — before the controller is ever reached. Order:
   `authenticate` → (rate limiter) → `validate(…, 'params')` → `asyncHandler(ownerGuard)`
   → `validate(…, 'body')` → `asyncHandler(controller)`.
2. **A params schema must declare *every* param on its route.** `validate` replaces
   `req.params` with the parsed object, and Zod strips keys the schema doesn't mention —
   a partial schema silently drops the others. This is why
   `GET /users/:username/recipes/:recipename` has no params schema at all rather than one
   covering only `username`.

Params that aren't UUIDs (`:username`, `:recipename`) are deliberately **not** validated:
they're plain strings, so they can't raise `P2023`, and an unknown value is already a
clean `404` from the service. Adding a format check there would convert legitimate 404s
into 422s for no safety benefit.

Each module declares its own params schemas next to its body/query schemas
(`recipeParamsSchema`, `reviewParamsSchema`, `collectionParamsSchema`, `userParamsSchema`,
plus the cross-prefix `userRecipesParamsSchema` / `userCollectionsParamsSchema` /
`recipeReviewsParamsSchema` / `recipeReportParamsSchema`). `tests/unit/routers/paramsValidation.test.ts`
mounts the real routers and asserts a `422` on every UUID route, that the owner guard is
never reached, and that the `me` / `username` routes still resolve.

---

## Meilisearch Integration

Meilisearch provides typo-tolerant, relevance-ranked full-text search. Postgres remains the source of truth for all data; Meilisearch is a read-only index.

### Search routing in `listRecipes`

```
q present  →  searchRecipesViaMeili()  →  Meilisearch
q absent   →  Prisma findMany()        →  PostgreSQL
```

Both paths support `tags`, `category`, `authorId` filters and `sortBy`/`order`. The response shape is identical.

**Filter string escaping:** `category` and each tag slug are user-controlled strings interpolated directly into Meilisearch's filter DSL (`categories = "<value>"` — an array-contains match, since the indexed document holds `categories: string[]`). `searchRecipesViaMeili` escapes `\` and `"` via `escapeMeiliString()` before interpolating, to prevent breaking out of the filter expression. `authorId` is already UUID-validated by Zod so it can't contain `"`, but it's escaped too for consistency.

**Pagination:** `searchRecipesViaMeili` uses Meilisearch's page-based pagination (`page`/`hitsPerPage`), not `offset`/`limit` — the latter only ever returns an approximate `estimatedTotalHits`, while page-based mode returns an exact `totalHits`, which `buildMeta` needs for correct `totalPages`/`hasNextPage`.

### Index configuration (`src/config/meilisearchSetup.ts`)

Called once at server startup (non-blocking, errors are logged):

| Attribute type | Fields |
|---|---|
| Searchable | `title`, `description`, `categories`, `tags` |
| Filterable | `categories`, `authorId`, `tags`, `averageRating` |
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

Run this after first deploy or any direct database import — **and after the categories migration**, since the indexed document's `category: string | null` became `categories: string[]`; documents indexed before it still carry the old field and won't match a category filter. The script (`prisma/reindexMeilisearch.ts`) reads all recipes with their tags and author via Prisma and enqueues them as a single batch.

### Docker

Meilisearch runs as a service in `docker/docker-compose.yml` on port `7700`. The master key is set via `MEILI_MASTER_KEY` (defaults to `masterkey` in development). Data is persisted in the `meilisearch_data` volume.

### Package version note

`meilisearch@0.37.0` is pinned because v0.38+ switched to ESM-only, which is incompatible with this project's CommonJS output. Do not upgrade without converting the project to ESM first.

---

## Cloudflare R2 Image Storage

Generic, provider-agnostic image storage — used for recipe cover/gallery images and review images, designed to be reused by other modules (e.g. avatars) later without rework. Postgres stores (and the API returns) only a **relative path with a leading `/`**; the backend never builds a full URL — the storage provider can change, and the frontend's base/CDN URL can change, without touching stored data or the API contract.

### Pipeline

```
POST /recipes/:recipeId/(cover-image|images)   or   POST /reviews/:reviewId/images
  └─> upload.ts middleware        multer memoryStorage — buffers the file(s), cheap mimetype prefilter, 5MB limit, translates multer errors to ApiError/422
        └─> recipe.service.ts / review.service.ts   ownership already verified by authorize(); enforces the 10-image cap atomically (see note below)
              └─> storage.service.ts#storeImage
                    ├─> imageSignature.ts#detectImageType   magic-byte check (JPEG/PNG/WEBP/GIF) — the real validation, not the client-declared Content-Type
                    ├─> r2Client.send(PutObjectCommand)      real R2 key (no leading slash): `<folder>/<uuid>.<ext>`, e.g. recipes/<id>/cover/<uuid>.jpg or reviews/<id>/gallery/<uuid>.jpg
                    └─> returns buildImageUrl(key)           leading-slash path, e.g. /recipes/<id>/cover/<uuid>.jpg
              recipe.<coverImageUrl|imageUrls> / review.imageUrls updated with the returned path(s)
```

### `src/modules/storage/storage.service.ts`

| Function | Behavior |
|---|---|
| `storeImage(buffer, folder)` | Validates content via `detectImageType`, uploads to R2 under the unprefixed key, returns the leading-slash path (`buildImageUrl(key)`). Throws `ApiError.validation(...)` on unrecognized/disallowed content. |
| `deleteImage(path)` | Accepts the stored leading-slash path, strips the `/` back off to reconstruct the real R2 key before deleting. Fire-and-forget from callers (errors are caught internally and logged, never thrown) — same pattern as the Meilisearch sync functions in `recipe.search.ts`. |
| `buildImageUrl(key)` | `` `/${key}` `` — the single seam where a raw R2 key becomes the leading-slash path stored in Postgres and returned by the API. |

### Cleanup

- Adding gallery/review images (`addGalleryImages`/`addReviewImages`) appends via a single atomic `UPDATE … SET imageUrls = imageUrls || … WHERE cardinality(imageUrls) + n <= 10` (built with `prisma.$executeRaw` + `Prisma.join`, so each key is a bound param). This is race-safe: concurrent uploads can neither exceed the cap nor lose each other's writes. If the guard's `WHERE` rejects the append (a concurrent upload won the cap), the just-stored R2 objects are deleted so they don't orphan, and the request gets a `422`. A cheap pre-check still short-circuits the obvious over-cap/not-found case before spending R2 writes.
- Replacing a cover image deletes the old R2 object.
- Removing gallery images (`DELETE /recipes/:recipeId/images`) deletes the corresponding R2 objects.
- `deleteRecipe` fire-and-forget deletes the cover key and every gallery key (the row is loaded before the DB delete, so no bucket `ListObjectsV2` call is needed).
- Removing review images (`DELETE /reviews/:reviewId/images`) deletes the corresponding R2 objects the same way.
- `deleteReview` (`DELETE /reviews/:reviewId`) fire-and-forget deletes every key in the review's `imageUrls` — the row is loaded before the DB delete, same as `deleteRecipe`, so no bucket `ListObjectsV2` call is needed.

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

### Unit Tests (508 passing)

Unit tests mock Prisma and all external dependencies — no database required. `vitest.config.ts` has no global `setupFiles` so unit tests run fully isolated.

| File | Tests | What's covered |
|---|---|---|
| `tests/unit/utils/ApiError.test.ts` | 12 | All static factory methods, prototype chain, code/statusCode mapping, multi-word (2 and 3+) resource names in `notFound()` |
| `tests/unit/utils/slugify.test.ts` | 11 | Diacritics, special chars, slug format, deterministic slug from title |
| `tests/unit/utils/pagination.test.ts` | 14 | Defaults, clamping, meta flags, offset calculation, falsy `limit: '0'` |
| `tests/unit/users/user.service.test.ts` | 30 | Provision (create/idempotent/conflict/unexpected error, race on authProviderId with successful and failed re-fetch), getMe, updateMe (incl. `about` updated independently of `bio`, and absent from the payload when omitted), getUserById, provisionFromWebhook (username derivation/fallbacks, collision retry, race on authProviderId, retries exhausted), deleteUserByAuthProviderId (success, already-absent no-op, unexpected error) |
| `tests/unit/recipes/recipe.service.test.ts` | 65 | All CRUD paths, ingredient ordering, description truncation, pagination, tag mapping, getRecipeByUsernameAndSlug, viewer state on both detail GETs (anonymous → `false`/`false` with **no** viewer queries issued, reviewed+saved → both `true`, neither → both `false`, lookups scoped by recipe id + caller `authProviderId` and by *owned* collections only), Meilisearch delegation when `q` present, `category` filtered through the join table, category mapping to a flat `categories` array, create/update linking resolved category rows, unknown category → 422 with no recipe write and no `$transaction`, PATCH leaving categories untouched when the key is absent, `minRating` filter, `sortBy=averageRating`, cover/gallery image upload-delete, atomic 10-image gallery cap (fast-path reject, `$executeRaw` guarded append, race-loss cleanup of stored objects), image cleanup on recipe delete, slug-collision `P2002` → 409 CONFLICT, unexpected create error re-thrown |
| `tests/unit/recipes/recipe.schema.test.ts` | 11 | `categories` lowercased/trimmed per slug on write, defaults to `[]`, capped at 5, rejects empty slugs; `category` filter still lowercased/trimmed (`recipeQuerySchema`); `tags` query param rejects more than 20 comma-separated slugs; `videoUrl` host allowlist; `authorNote` cap |
| `tests/unit/recipes/recipe.search.test.ts` | 18 | Meilisearch index/update/delete sync, searchRecipesViaMeili response mapping (page/hitsPerPage, exact `totalHits`), `minRating` filter clause, filter string escaping for the `categories`/tag slug clauses, `updateIndexedRecipeRating` partial document sync |
| `tests/unit/categories/category.service.test.ts` | 9 | `listCategories` (flattens `_count` into `recipeCount`, keeps zero-count categories, orders by name, empty registry); `resolveCategories` (empty input short-circuits with no query, de-duplicates into one `findMany`, unknown slugs → 422 naming every one of them); `syncCategoriesFromConfig` (created vs updated counts, reports extras **without deleting**, rejects a malformed definition / duplicate slug / duplicate name before any write) |
| `tests/unit/categories/category.schema.test.ts` | 6 | `categoryDefinitionSchema` — URL-safe slug regex, empty/oversized name and slug. Plus the checked-in `categories.config.ts` itself: every definition valid, unique slugs and names, and the `drinks` slug the `top-drinks` shelf depends on is present |
| `tests/unit/storage/storage.service.test.ts` | 6 | `storeImage` (returns leading-slash path, uploads to R2 with the unprefixed key, invalid content rejected via `ApiError.validation`), `deleteImage` (strips leading slash before the R2 call), `buildImageUrl` |
| `tests/unit/utils/imageSignature.test.ts` | 9 | `detectImageType` magic-byte detection for JPEG/PNG/WEBP/GIF; rejects unknown content and SVG |
| `tests/unit/utils/imageUrl.test.ts` | 8 | `trustedImageUrlSchema` — allows any URL when no allowlist configured, rejects non-URLs, accepts/rejects by hostname against `TRUSTED_IMAGE_DOMAINS` |
| `tests/unit/tags/tag.service.test.ts` | 3 | `upsertTags` — empty input short-circuits, single `createMany`+`findMany` round-trip regardless of tag count, de-duplicates names that slugify to the same value |
| `tests/unit/reviews/review.service.test.ts` | 36 | listReviewsByRecipe (pagination, recipe not found, `filter=rating:N`, `filter=media`, no filter, `order=rating_asc`/`rating_desc`/`newest`), createReview (success, user not found, recipe not found, duplicate, recomputes/syncs recipe rating stats), getMyReviewForRecipe (found via the `recipeId_authorId` unique, recipe/user/review not found), updateReview (updates rating+content, clears `content` when omitted, recomputes stats in the same `$transaction` + syncs Meilisearch, review not found), deleteReview (deletes + recomputes/syncs stats, deletes every attached image from storage, review not found), getReviewAuthorId (found, null), getReviewStats (recipe not found, totals from denormalized `reviewCount` + zero-filled rating breakdown + media count), addReviewImages (review not found, fast-path 10-image cap, `$executeRaw` guarded atomic append, race-loss cleanup of stored objects), removeReviewImages (review not found, removes given paths and deletes them from storage) |
| `tests/unit/reviews/review.schema.test.ts` | 16 | `createReviewSchema` — parses without `imageUrls`, strips an `imageUrls` field if passed (no longer part of the schema); `updateReviewSchema` — rating required (full replace, no partial), rejects out-of-range/non-integer ratings, `content` optional and capped at 2000, strips `recipeId`/`imageUrls`; `reviewQuerySchema` — `filter` accepts `rating:1`-`rating:5`/`media`, rejects out-of-range/arbitrary values, optional; `order` defaults to `newest`, accepts `rating_asc`/`rating_desc`, rejects invalid values |
| `tests/unit/collections/collection.service.test.ts` | 28 | listPublicCollectionsByUser (always public-filtered, user not found), listMyCollections (all public+private for the authenticated owner, user not found), getCollectionById (public, private own, private forbidden, not found), createCollection (success, user not found), updateCollection/patchCollection (metadata only), deleteCollection (success, not found), addRecipes/removeRecipes (incl. `take: 50` cap assertion, not-found-on-re-fetch race), followCollection (success, not found, private, own, duplicate), unfollowCollection, getOwnerId |
| `tests/unit/routers/paramsValidation.test.ts` | 32 | Mounts the real routers on a bare Express app (services mocked). Malformed UUID → `422 VALIDATION_ERROR` on all 24 UUID param routes across recipes/reviews/collections/users/reports; the owner guard is never reached; well-formed UUIDs still hit the handler with the param intact; the two `optionalAuthenticate` detail GETs forward the caller sub when a session is present and `undefined` when not (no Clerk middleware mounted — proves the route resolves rather than 401s); `GET /users/me`, `/users/me/collections`, `/users/username/:username` and `/users/:username/recipes/:recipename` still resolve (route-ordering + param-stripping regressions) |
| `tests/unit/reports/report.service.test.ts` | 9 | createRecipeReport (success — asserts server-set `targetType: 'recipe'` and the resolved `reporterId`; recipe not found; **self-report → 403** before the reporter is even resolved; user not found; duplicate `P2002` → 409 CONFLICT; unexpected create error re-thrown), listMyReports (paginated shape, query scoped to the resolved reporter id, user not found) |
| `tests/unit/reports/report.schema.test.ts` | 12 | `createRecipeReportSchema` — accepts every recipe topic, rejects unknown/missing topic, `message` optional and capped at 2000, strips a client-supplied `status`; `recipeReportParamsSchema` — accepts/rejects by UUID; `reportQuerySchema` — page/limit defaults, string coercion, out-of-range rejection |
| `tests/unit/shelves/shelf.service.test.ts` | 17 | listActiveShelves (active + publish-window predicate, position/item ordering, empty shelves omitted, `criteria` never leaked, list items formatted by the shared recipe mapper), getShelfBySlug (pagination + meta, 404 unknown slug, 404 out-of-window via the same predicate), refreshShelf (atomic delete+insert+`refreshedAt` in one `$transaction`, order follows resolver output, resolver called with source/criteria/maxItems, 404), refreshAllShelves (one failing shelf doesn't abort the batch; single-slug mode skips the findMany), syncShelvesFromConfig (created vs updated counts, deletes shelves absent from config, rejects malformed definition/bad criteria/duplicate slug **before** any write) |
| `tests/unit/shelves/resolvers.test.ts` | 13 | Registry (every known source resolves; unknown source throws naming the known ones; criteria validated per source). `query` — delegates to `listRecipes` with `maxItems` as limit, applies recipe-query defaults, passes `q` through so the shelf routes to Meilisearch. `manual` — preserves authored order against arbitrary DB order, drops ids whose recipe no longer exists, truncates to `maxItems`. `trending` — window computed from `windowDays` (default 7), `GROUP BY recipeId` ordered by count desc, no recipe filter when none given, AND-s multiple tags + category matching `listRecipes` semantics |
| `tests/unit/shelves/shelf.schema.test.ts` | 22 | Per-source criteria schemas (query: inherits category lowercasing, empty object valid, strips page/limit, rejects bad sort/rating; manual: uuid/min/max bounds; trending: window default and 1–90 int range). `shelfQuerySchema` defaults + bounds. `shelfDefinitionSchema` — defaults, URL-safe slug regex, title/subtitle caps, `maxItems` ≤ 50, unknown source rejected, ISO date strings coerced to `Date`, `endsAt > startsAt`, open-ended windows allowed. Plus the checked-in `shelves.config.ts` itself: every definition structurally valid, every `criteria` valid for its declared source, unique slugs and positions, no unknown sources |
| `tests/unit/middlewares/authenticate.test.ts` | 11 | `authenticate()`: dev bypass, missing/non-Bearer header, valid token, null userId, malformed token (401 not 500). `optionalAuthenticate()`: dev bypass, valid session, no session, malformed token — all three non-session cases call `next()` with no error instead of rejecting |
| `tests/unit/middlewares/authorize.test.ts` | 5 | Missing `req.user` → 401, resolved owner id `null` → 404, mismatched owner → 403, matching owner → `next()`, unexpected error from the lookup propagates instead of being swallowed into 404 |
| `tests/unit/middlewares/validate.test.ts` | 5 | Valid input passes + unknown keys stripped; schema failure → 422; NUL byte (`0x00`) rejected → 422 at top level, nested in arrays/objects, and in query params |
| `tests/unit/middlewares/errorHandler.test.ts` | 4 | `ApiError` passthrough (status/code/details); body-parser `entity.too.large` → 413 `PAYLOAD_TOO_LARGE`; `entity.parse.failed` → 400 `INVALID_JSON`; unknown error → generic 500 (message hidden in production) |
| `tests/unit/config/envGuards.test.ts` | 3 | `assertProductionOrigins` — rejects `*` in production (trimmed), allows an explicit allowlist, allows `*` in dev/test |
| `tests/unit/middlewares/verifyClerkWebhook.test.ts` | 2 | Attaches verified event to `req.clerkEvent` on success; 400 `INVALID_WEBHOOK_SIGNATURE` on verification failure |
| `tests/unit/webhooks/clerk.webhook.controller.test.ts` | 6 | user.created (primary email selection, fallback to first email), user.deleted (with/without id), user.updated (no-op/logged), unhandled event types |
| `tests/unit/docs/openapi.test.ts` | 1 | Every Express route has a matching OpenAPI spec entry |

**Mock conventions for unit tests:**
- Mock `../../../src/config/database` to mock Prisma. The recipe service mock needs `review.findFirst` and `collectionRecipe.findFirst` in addition to the `recipe`/`user` delegates — `resolveViewerState` reads those two tables directly (via relations declared on `Recipe`, not a cross-module import)
- Mock `../../../src/modules/tags/tag.service` to isolate tag upsert, and `../../../src/modules/categories/category.service` to isolate category resolution. Re-establish `resolveCategories`'s default (`mockResolvedValue([])`) in `beforeEach`: every recipe write path awaits it, and `vi.clearAllMocks()` does not restore an implementation a previous test made throw
- Mock `../../../src/utils/slugify` to control slug output
- Mock `../../../src/modules/recipes/recipe.search` in recipe service tests — prevents the Meilisearch import chain from triggering `env.ts` validation
- Shelf tests: mock `../../../src/config/env` (as `{ trustedImageDomains: [] }`) — `shelf.schema.ts` derives from `recipeQuerySchema`, whose import chain reaches `env.ts` and would `process.exit(1)`. Mock `../../../src/modules/shelves/resolvers` in the service test and `../../../src/modules/recipes/recipe.service` in the resolver test, so each layer is tested against a stub of the other
- `vi.clearAllMocks()` resets calls but **not** implementations — a test that makes a mock throw must re-establish the default in `beforeEach`, or the throwing implementation leaks into the next test (see `shelf.service.test.ts`'s `parseCriteria` default)
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
| `npm run categories:sync` | Apply `categories.config.ts` to the DB (validates, then upserts by slug). Never deletes — categories absent from the config are reported only |
| `npm run shelves:sync` | Apply `shelves.config.ts` to the DB (validates, upserts, deletes removed rows), then refresh contents |
| `npm run shelves:refresh [-- <slug>]` | Re-resolve shelf criteria into `shelf_items`. Run on a schedule (cron, every ~15 min) to bound staleness |
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
- [x] Every UUID route param validated at the router — malformed ids return `422` instead of a Prisma `P2023` → `500` (see [Route Param Validation](#route-param-validation))
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
- [x] `POST`/`DELETE /reviews/:reviewId/images` — the "reviews" case of the storage service's planned reusability realized; `imageUrls` removed from `POST /reviews` body, capped at 10 images total, owner-only, rate-limited

### Milestone 10 — Reports (recipe reports) ✅
- [x] `Report` model — one table for all reportable entities, `targetType` + typed nullable FK per entity (`recipeId` today), `onDelete: Cascade`, `status` column reserved for future moderation
- [x] `@@unique([recipeId, reporterId])` enforces one report per user per recipe; `P2002` → `409 CONFLICT`
- [x] `src/modules/reports/` — router / controller / service / schema, with per-target-type topic lists
- [x] `POST /recipes/:recipeId/reports` — authenticated, `writeLimiter`, validates params + body, blocks self-reports with `403 FORBIDDEN`
- [x] `GET /reports/me` — authenticated, paginated, scoped to the caller's own reports
- [x] Documented in OpenAPI spec (`src/docs/openapi.ts`) under the `Reports` tag
- [x] Unit tests: service paths + schema validation (21 new tests)
- [ ] Moderation/admin endpoints (list all reports, set `status`) — not started
- [ ] Review and user reports — schema absorbs them without restructuring; no columns, topics or routes yet
- [ ] `DELETE /reports/:reportId` (withdraw) — not implemented; without it the unique constraint permanently blocks a re-report

### Milestone 11 — Themed Shelves (landing page rows) ✅
- [x] `Shelf` / `ShelfItem` models — JSONB `criteria`, precomputed snapshot, `onDelete: Cascade` on both FKs, `@@index([isActive, position])`
- [x] `src/modules/shelves/resolvers/` — `ShelfResolver<C>` interface + registry; `query` (delegates to `listRecipes`, inherits Meilisearch), `manual` (hand-pinned), `trending` (review counts in a window, no new tracking infra)
- [x] `src/modules/shelves/shelves.config.ts` — the checked-in registry; `syncShelvesFromConfig` validates shape *and* criteria-per-resolver before any write, and deletes shelves absent from the file
- [x] `npm run shelves:sync` / `npm run shelves:refresh [-- <slug>]` — snapshot rewritten in one transaction per shelf; a failing shelf doesn't abort the batch
- [x] `GET /shelves` (live shelves + items, empty ones omitted) and `GET /shelves/:slug` (paginated), both public, `readLimiter`
- [x] Publish windows (`startsAt`/`endsAt`) evaluated per request — seasonal rows activate and retire with no refresh or manual toggle
- [x] `recipeListSelect` / `formatRecipeListItem` exported from `recipe.service.ts` so shelf items match `GET /recipes` exactly
- [x] Documented in OpenAPI spec (`src/docs/openapi.ts`) under the `Shelves` tag
- [x] Unit tests: service, resolvers, schema + the config file itself (52 new tests)
- [ ] Scheduled refresh — the cron/platform-scheduler entry calling `shelves:refresh` is deployment config, not yet wired anywhere
- [ ] Admin API for shelf CRUD — deliberately deferred; needs an admin/role concept the codebase doesn't have. The service layer is already the seam an API would sit on
- [ ] View-based trending — `trending` ranks on review activity today; a denser signal (impressions/saves) would be a new resolver plus its own tracking infra

### Milestone 12 — Categories + long-form user bio ✅
- [x] `User.about` — long-form profile body (max 5000, Zod), update-only, alongside the short `bio`
- [x] `Category` / `RecipeCategory` models replace the `Recipe.category String?` column and its `@@index([category])` — Phase 2 normalization, per the old Schema-decisions note
- [x] `src/modules/categories/` — router / controller / service / schema + `categories.config.ts`, the curated registry
- [x] `GET /categories` — public, `readLimiter`, unpaginated, every category with its `recipeCount` (zero-count included)
- [x] `resolveCategories` gates every recipe write: unknown slug → `422`, resolved before the transaction opens so nothing half-writes
- [x] `npm run categories:sync` — validates the whole config before writing, upserts by slug, reports (never deletes) categories absent from the file
- [x] `categories: string[]` replaces `category` in every recipe request and response; `?category=<slug>` filters through the join table
- [x] Meilisearch document/index attributes moved to `categories: string[]`; `trending` resolver's category filter moved to the relation
- [x] Documented in OpenAPI spec (`src/docs/openapi.ts`) under the `Categories` tag
- [x] Unit tests: category service + schema/config, plus updated recipe/search/shelf/user suites (20 new tests)
- [ ] Category images/descriptions for a browse-page tile — the model is `name`/`slug` only; richer fields are additive
- [ ] Admin API for category CRUD — deliberately deferred, same reasoning as shelves (no admin/role concept yet)
- [ ] Backfill of the old `recipes.category` values — deliberately skipped; the migration drops the column
