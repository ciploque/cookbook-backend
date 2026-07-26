# Issues — cookbook-backend

Findings from the 2026-06-26 code review. All findings below were re-verified against
the current codebase and resolved on 2026-07-25, except ISSUE-03 which was made moot
by the Keycloak → Clerk migration. See `CLAUDE.md` for the current, authoritative
documentation of the behaviors described here (Rate Limiting section, env var table,
Recipes/Reviews/Collections API reference, Meilisearch Integration section).

---

## ISSUE-01 · Meilisearch Filter Injection — ✅ Resolved

**File:** `src/modules/recipes/recipe.search.ts`

`category`, `authorId`, and tag slugs are now passed through `escapeMeiliString()`
(escapes `\` and `"`) before being interpolated into the Meilisearch filter DSL.
Covered by new tests in `tests/unit/recipes/recipe.search.test.ts`.

---

## ISSUE-02 · TRUSTED_IMAGE_DOMAINS Never Enforced — ✅ Resolved

**Files:** `src/utils/imageUrl.ts` (new), `src/modules/recipes/recipe.schema.ts`,
`src/modules/reviews/review.schema.ts`

Added `trustedImageUrlSchema` (a Zod refinement checking the URL hostname against
`trustedImageDomains`, allowing everything when the allowlist is empty). Applied to
`RecipeStep.imageUrl` and `Review.imageUrls` — the two raw-URL image fields that
remain in the API (`Recipe.coverImageUrl`/`imageUrls` are server-managed via the R2
upload endpoints and were never affected). `User.avatarUrl` intentionally left
unrestricted, per the original issue's scope note. Covered by
`tests/unit/utils/imageUrl.test.ts`.

---

## ISSUE-03 · JWT Audience Validation Not Enforced — ⬜ Obsolete

This finding was specific to the old Keycloak/`jsonwebtoken` auth stack
(`KEYCLOAK_AUDIENCE`, manual `jwt.verify` options). The project has since migrated to
`@clerk/express` (`getAuth()` in `src/middlewares/authenticate.ts`), which handles
token/session verification internally. No equivalent gap was found in the current
auth flow — see CLAUDE.md's Authentication Flow section.

---

## ISSUE-04 · Rate Limiter Ineffective Without `trust proxy` — ✅ Resolved

**File:** `src/app.ts`

Added `app.set('trust proxy', 1)` at the top of `createApp()`, before any middleware.

---

## ISSUE-05 · No Rate Limiting on Public Read Endpoints — ✅ Resolved

**File:** `src/app.ts`

Added a `readLimiter` (300 req / 15 min) applied to the recipe router and the
cross-module GET routes (`recipeReviewsRouter`, `userRecipesRouter`,
`userCollectionsRouter`). See CLAUDE.md's Rate Limiting section for the full
limiter/route matrix.

---

## ISSUE-06 · Array Fields Have No Maximum Length — ✅ Resolved

**Files:** `src/modules/recipes/recipe.schema.ts`, `src/modules/collections/collection.schema.ts`,
`src/modules/reviews/review.schema.ts`

Added `.max()` to `tags` (20), `ingredients` (200), `steps` (100), gallery `paths` (10),
`addRecipesSchema.recipes` (100), `removeRecipesSchema.recipeIds` (100), and review
`imageUrls` (10). Added string length caps to `ingredientSchema.name/unit/notes`,
`stepSchema.instruction`, and `recipeQuerySchema.category/tags`.

---

## ISSUE-07 · Unbounded Collection Recipe Fetch — ✅ Resolved (quick-fix option)

**File:** `src/modules/collections/collection.service.ts`

Applied the documented "Option B" quick fix: `take: 50` added to the `recipes`
include in `collectionInclude`. A paginated `GET /collections/:collectionId/recipes`
sub-resource (Option A) is still open as a follow-up if collections regularly exceed
50 saved recipes.

---

## ISSUE-08 · N+1 Queries in `upsertTags` — ✅ Resolved

**File:** `src/modules/tags/tag.service.ts`

Replaced the parallel `upsert` loop with a single `createMany({ skipDuplicates: true })`
followed by one `findMany`. Covered by the new `tests/unit/tags/tag.service.test.ts`.

---

## ISSUE-09 · Race Condition in `provisionUser` — ✅ Resolved

**File:** `src/modules/users/user.service.ts`

`provisionUser` now inspects `e.meta.target` on `P2002` the same way
`provisionFromWebhook` already did: if the race was on `authProviderId`, it re-fetches
and returns the winning row instead of throwing a misleading "Username already taken".

---

## ISSUE-10 · Non-null Assertion After Re-fetch in Collection Service — ✅ Resolved

**File:** `src/modules/collections/collection.service.ts`

Removed the `formatCollection(collection!)` assertions in `addRecipesToCollection` and
`removeRecipesFromCollection`; both now throw `ApiError.notFound('Collection')` if the
re-fetch returns `null`.

---

## ISSUE-11 · Recipe Slug Collision Not Handled in `createRecipe` — ✅ Resolved

**Files:** `src/utils/slugify.ts`, `src/modules/recipes/recipe.service.ts`

By the time this was re-verified, `generateRecipeSlug` no longer added a random
suffix at all (slug = slugified title, immutable, unique per author — see CLAUDE.md's
Schema decisions note). The remaining real gap was that `createRecipe` had no handler
for the `P2002` this produces on a duplicate title for the same author. `createRecipe`
now catches it and throws `ApiError.conflict(...)`, matching the documented
`409 CONFLICT` behavior. Covered by a new test in `tests/unit/recipes/recipe.service.test.ts`.

---

## ISSUE-12 · `estimatedTotalHits` Used for Pagination Math — ✅ Resolved

**File:** `src/modules/recipes/recipe.search.ts`

Switched `searchRecipesViaMeili` from `offset`/`limit` to Meilisearch's page-based
pagination (`page`/`hitsPerPage`), which returns an exact `totalHits` instead of an
estimate. Also removed the `(hit: any)` cast on the hits map. Covered by updated tests
in `tests/unit/recipes/recipe.search.test.ts`.

---

# Findings from the 2026-07-25 architecture/security/performance scan

A second, broader pass across every controller, service, middleware, and config file —
not limited to the original 2026-06-26 review's scope. Resolved the same day, except
ISSUE-16 which is a deliberately-deferred, documented risk (not a bug).

## ISSUE-13 · `GET /recipes/:recipeId` Required Auth for a Public Route — ✅ Resolved

**Severity:** High
**File:** `src/modules/recipes/recipe.router.ts`

`router.get('/:recipeId', authenticate, ...)` required a valid session to view a single
recipe, even though `getRecipeById` does no ownership/privacy check at all and CLAUDE.md
documents this route as `Public`. Every logged-out visitor got `401 UNAUTHORIZED` trying
to view a recipe — the most basic read path in the API. Looked like a copy-paste from
the owner-gated routes below it. Fix: dropped `authenticate` from that line.

## ISSUE-14 · Collection Owners Could Never See Their Own Private Collections — ✅ Resolved

**Severity:** High
**Files:** `src/middlewares/authenticate.ts` (new `optionalAuthenticate`),
`src/modules/collections/collection.router.ts`

`GET /collections/:collectionId` and `GET /users/:userId/collections` never ran
`authenticate` (correct — they're public-by-default routes), but their controllers
passed `req.user?.sub` to the service as the "requesting user" for the private-collection
visibility check. `req.user` is *only* ever populated inside `authenticate.ts` — nothing
else sets it — so on these two routes it was always `undefined`, even with a fully valid
session. Owners got `404` on their own private collections, and private collections
silently vanished from their own `GET /users/:userId/collections` list.

Fix: added `optionalAuthenticate` (resolves `getAuth(req)` the same way `authenticate`
does, but never rejects — populates `req.user` when a valid session is present and just
calls `next()` otherwise) and wired it into both routes. See CLAUDE.md's
[Optional Auth](#optional-auth-optionalauthenticate) section.

## ISSUE-15 · `category` Filter Couldn't Use Its Own Index — ✅ Resolved

**Severity:** Medium
**Files:** `src/modules/recipes/recipe.schema.ts`, `src/modules/recipes/recipe.service.ts`

`{ category: { equals: category, mode: 'insensitive' } }` against `@@index([category])`
(a plain B-tree index, default case-sensitive collation) — Prisma's `mode: 'insensitive'`
compiles to a case-insensitive comparison that a plain B-tree index structurally cannot
satisfy, forcing a sequential scan on every `?category=` request as the `recipes` table
grows. This was also inconsistent with the Meilisearch path, which did an exact
case-sensitive filter match — different casing behavior depending on whether `q` was
present.

Fix: normalize `category` to lowercase/trim at the Zod layer, on both write
(`createRecipeSchema`) and the query filter (`recipeQuerySchema`), and switch the Postgres
filter to a plain equality match. Unifies casing behavior between the Postgres and
Meilisearch paths as a side effect. Ran a one-time `UPDATE recipes SET category =
LOWER(TRIM(category)) WHERE category IS NOT NULL` against the dev DB (a no-op — existing
data was already lowercase); run the same statement against any other environment with
existing recipe data before deploying this change.

## ISSUE-16 · CORS Wildcard + `credentials: true` — ⚠️ Open, deliberately deferred

**Severity:** Medium
**File:** `src/app.ts`

When `ALLOWED_ORIGINS=*`, the code deliberately reflects the request's `Origin` header
(required for `credentials: true` to work at all — browsers reject a literal `"*"` when
credentials are present). Combined with Clerk's documented cookie-based session support
(not just Bearer tokens — see CLAUDE.md's Authentication Flow), this means: if an
operator sets `ALLOWED_ORIGINS=*` *and* the deployment topology puts Clerk's session
cookie in scope for this API's domain, any origin could make a credentialed request and
read the response. This is an opt-in footgun (requires the operator to set the wildcard),
not a default-on vulnerability, and the exploitability depends on deployment topology
(whether the Clerk cookie is actually in scope for this API's domain).

**Not fixed yet — deliberately deferred.** Revisit before recommending `ALLOWED_ORIGINS=*`
for any deployment that also relies on Clerk's cookie-based session path. Options when
picked back up: drop `credentials: true` when reflecting a wildcard origin, or emit a
startup warning when `ALLOWED_ORIGINS=*` is set, or require an explicit opt-in flag
separate from the origin list itself.

## ISSUE-17 · `authorize.ts` Swallowed All Errors Into a Blanket 404 — ✅ Resolved

**Severity:** Low
**File:** `src/middlewares/authorize.ts`

```ts
const ownerId = await getResourceOwnerId(req).catch(() => null);
```

A genuine DB failure during the ownership lookup (connection drop, timeout) was
indistinguishable from "resource doesn't exist" — every owner-gated route (recipes,
collections) returned `404` instead of `500` when the database itself was unhealthy.
Good for not leaking info, bad for debugging: an outage looked like every resource had
vanished, not like an infra problem.

Fix: removed the `.catch(() => null)`. `getResourceOwnerId` implementations
(`getRecipeAuthorId`, `getOwnerId`) already resolve `null` for a genuine "not found"
without throwing — an unexpected error now propagates through the (already-async)
middleware to `asyncHandler` at the router level, which forwards it to the global error
handler as `500 INTERNAL_ERROR`. Covered by a new `tests/unit/middlewares/authorize.test.ts`.

## ISSUE-18 · `ApiError.notFound()` Only Replaced the First Space — ✅ Resolved

**Severity:** Low
**File:** `src/utils/ApiError.ts`

```ts
`${resource.toUpperCase().replace(' ', '_')}_NOT_FOUND`
```

Missing the `/g` flag — only the *first* space in a multi-word resource name got
replaced. Dormant today because every call site passes a single word (`'Recipe'`,
`'User'`, `'Collection'`) or a two-word name (exactly one space, so the bug was
invisible). The moment anyone calls `ApiError.notFound('Review Author Profile')`
(3 words, 2 spaces), it would silently produce `REVIEW_AUTHOR PROFILE_NOT_FOUND` — a
literal space in a machine-readable `code` field, breaking the documented
`{RESOURCE}_NOT_FOUND` contract. One-character fix (`/ /g`). Added a 3-word test case to
`tests/unit/utils/ApiError.test.ts` alongside the existing 2-word one.

## ISSUE-19 · Tag Filter Had No Cap on Subquery Count — ✅ Resolved

**Severity:** Low
**File:** `src/modules/recipes/recipe.schema.ts`

`tags` was capped at 500 characters but not by item count — a dense comma list of short
slugs could chain up to ~60-80 ANDed correlated `EXISTS` subqueries (one per tag) into a
single query. Not urgent, but avoidable. Fix: added a `.refine()` on
`recipeQuerySchema.tags` rejecting more than 20 comma-separated values (matching the
existing 20-tag cap on `createRecipeSchema.tags` — a recipe can never have more than 20
tags anyway, so filtering by more couldn't match anything regardless). Covered by
`tests/unit/recipes/recipe.schema.test.ts`.
