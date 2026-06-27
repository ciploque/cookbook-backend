# Open Issues — cookbook-backend

Findings from the 2026-06-26 code review. Each entry contains the exact location,
the problematic code, why it is wrong, and a complete description of what the fix
must do so an AI agent can implement it without additional context.

---

## ISSUE-01 · Meilisearch Filter Injection

**Severity:** High  
**Category:** Security  
**File:** `src/modules/recipes/recipe.search.ts` lines 48–50

### Problematic code

```ts
if (category) filter.push(`category = "${category}"`);
if (authorId) filter.push(`authorId = "${authorId}"`);
tagSlugs.forEach((slug) => filter.push(`tags = "${slug}"`));
```

### Why it is wrong

`category` arrives as a raw `z.string()` query param with no character restrictions.
A crafted value such as `cooking" OR authorId != "00000000` breaks out of the filter
string and changes Meilisearch query semantics. `authorId` is safe because it is
`z.string().uuid()`, but `category` and each individual tag slug are not sanitised.
This is direct injection into Meilisearch's filter DSL.

### What the fix must do

1. Add a helper function `escapeMeiliString(value: string): string` that replaces
   every `"` and `\` with their escaped versions (`\"` and `\\`) before embedding
   the value in the filter string. Example:

   ```ts
   function escapeMeiliString(value: string): string {
     return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
   }
   ```

2. Apply the helper to every string that is interpolated into a filter expression:

   ```ts
   if (category) filter.push(`category = "${escapeMeiliString(category)}"`);
   tagSlugs.forEach((slug) => filter.push(`tags = "${escapeMeiliString(slug)}"`));
   ```

3. `authorId` is already UUID-validated and does not need escaping, but wrapping it
   is harmless and keeps the code consistent.

4. No schema changes are required; the fix is local to `searchRecipesViaMeili`.

---

## ISSUE-02 · TRUSTED_IMAGE_DOMAINS Never Enforced

**Severity:** High  
**Category:** Security / Validation  
**Files:**
- `src/config/env.ts` lines 36–38 (exports `trustedImageDomains` — never imported elsewhere)
- `src/modules/recipes/recipe.schema.ts` lines 24–25 (image URL fields)
- `src/modules/reviews/review.schema.ts` line 7 (review image URLs)

### Problematic code

`env.ts`:
```ts
export const trustedImageDomains = env.TRUSTED_IMAGE_DOMAINS
  ? env.TRUSTED_IMAGE_DOMAINS.split(',').map((s) => s.trim())
  : [];
```

`recipe.schema.ts`:
```ts
coverImageUrl: z.string().url().optional(),
imageUrls: z.array(z.string().url()).default([]),
```

`review.schema.ts`:
```ts
imageUrls: z.array(z.string().url()).optional().default([]),
```

### Why it is wrong

`trustedImageDomains` is computed and exported but never imported or referenced
anywhere in the codebase. Image URLs are accepted from any hostname as long as they
are syntactically valid URLs. The domain allowlist feature documented in CLAUDE.md
and `.env.example` is entirely dead.

### What the fix must do

1. Create a Zod refinement helper in a new file `src/utils/imageUrl.ts`:

   ```ts
   import { z } from 'zod';
   import { trustedImageDomains } from '../config/env';

   function isTrustedUrl(url: string): boolean {
     if (trustedImageDomains.length === 0) return true; // no allowlist configured → allow all
     try {
       const hostname = new URL(url).hostname;
       return trustedImageDomains.includes(hostname);
     } catch {
       return false;
     }
   }

   export const trustedImageUrlSchema = z
     .string()
     .url()
     .refine(isTrustedUrl, { message: 'Image URL hostname is not in the trusted domain list' });
   ```

2. Replace every `z.string().url()` that represents an image field in the schemas:
   - `src/modules/recipes/recipe.schema.ts`: `coverImageUrl`, `imageUrls` items,
     and `stepSchema.imageUrl`
   - `src/modules/reviews/review.schema.ts`: `imageUrls` items

3. Do NOT apply the trusted-domain check to `avatarUrl` on users unless that is also
   an intended constraint (the env var name says "IMAGE_DOMAINS" and the CLAUDE.md
   scopes it to `coverImageUrl` and `imageUrls` fields only).

4. No service or controller changes are needed; the fix is entirely in the schemas
   and the new utility module.

---

## ISSUE-03 · JWT Audience Validation Not Enforced

**Severity:** High  
**Category:** Security  
**File:** `src/middlewares/authenticate.ts` lines 45–47  
**Related file:** `src/config/env.ts` line 12

### Problematic code

```ts
// env.ts
KEYCLOAK_AUDIENCE: z.string().optional(),

// authenticate.ts
if (env.KEYCLOAK_AUDIENCE) {
  options.audience = env.KEYCLOAK_AUDIENCE;
}
```

### Why it is wrong

When `KEYCLOAK_AUDIENCE` is unset, `jsonwebtoken` performs no `aud` claim check.
Any RS256-signed JWT from the same Keycloak realm — regardless of which client it
was issued for — will authenticate successfully. A token intended for the Keycloak
admin console or another application in the same realm becomes a valid credential
for this API.

### What the fix must do

1. Change `KEYCLOAK_AUDIENCE` in `src/config/env.ts` from `optional()` to
   `z.string().min(1)` so the server refuses to start if the audience is not
   configured:

   ```ts
   KEYCLOAK_AUDIENCE: z.string().min(1),
   ```

2. Remove the conditional guard in `authenticate.ts` and always set the audience:

   ```ts
   const options: jwt.VerifyOptions = {
     issuer: keycloakIssuer,
     algorithms: ['RS256'],
     audience: env.KEYCLOAK_AUDIENCE,
   };
   ```

3. Update `.env.example` to remove the "(optional but recommended)" comment and
   mark the field as required.

4. Update `CLAUDE.md` env var table: change the `KEYCLOAK_AUDIENCE` row to
   `Required: yes`.

5. Update the authenticate middleware unit test mock in
   `tests/unit/middlewares/authenticate.test.ts` to always include
   `KEYCLOAK_AUDIENCE` in the mocked env object (it already does — verify it still
   passes after step 1).

---

## ISSUE-04 · Rate Limiter Ineffective Without `trust proxy`

**Severity:** Medium  
**Category:** Security  
**File:** `src/app.ts` lines 32–37

### Problematic code

```ts
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});
```

`app.set('trust proxy', ...)` is never called anywhere.

### Why it is wrong

`express-rate-limit` uses `req.ip` to identify clients. Without `trust proxy`, Express
reads the IP from the TCP socket, which behind nginx / Cloudflare / an ELB is always
the proxy's IP. Every user shares a single rate limit bucket. The limiter is completely
ineffective for per-client throttling and can falsely throttle all users at once.

### What the fix must do

1. Add `app.set('trust proxy', 1)` near the top of `createApp()` in `src/app.ts`,
   before any middleware is registered. The value `1` means "trust one hop" (the
   first proxy), which is correct for a single reverse proxy. If the deployment uses
   multiple proxy hops (e.g., Cloudflare in front of nginx), this should be `2`.
   Use `1` as the default and document it in `.env.example` or CLAUDE.md.

   ```ts
   export function createApp(): express.Application {
     const app = express();
     app.set('trust proxy', 1); // trust the first proxy (nginx / Cloudflare / ELB)
     app.use(helmet());
     // ...
   ```

2. No other changes are required. `express-rate-limit` will automatically read the
   real client IP from `X-Forwarded-For` once trust proxy is enabled.

---

## ISSUE-05 · No Rate Limiting on Public Read Endpoints

**Severity:** Medium  
**Category:** Security / Scalability  
**File:** `src/app.ts` lines 49–56

### Problematic code

```ts
app.use(`${base}/v1/users`, writeLimiter, userRouter);
app.use(`${base}/v1/recipes`, recipeRouter);       // ← no limiter
app.use(`${base}/v1/reviews`, writeLimiter, reviewRouter);
app.use(`${base}/v1/collections`, writeLimiter, collectionRouter);

app.get(`${base}/v1/recipes/:recipeId/reviews`, ...);             // ← no limiter
app.get(`${base}/v1/users/:username/recipes/:recipename`, ...);   // ← no limiter
app.get(`${base}/v1/users/:userId/recipes`, ...);                 // ← no limiter
app.get(`${base}/v1/users/:userId/collections`, ...);             // ← no limiter
```

### Why it is wrong

`GET /recipes` fans out to Meilisearch on every call and touches the DB for non-search
paths. The user-scoped list routes each perform two DB queries. These endpoints can be
hammered indefinitely with no back-pressure, enabling resource exhaustion on both
Postgres and Meilisearch.

### What the fix must do

1. Add a separate `readLimiter` in `createApp()` with a more generous limit than the
   write limiter (e.g., 300 requests per 15 minutes):

   ```ts
   const readLimiter = rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 300,
     standardHeaders: true,
     legacyHeaders: false,
   });
   ```

2. Apply `readLimiter` to the recipe router and to every individual GET route that is
   registered directly on `app`:

   ```ts
   app.use(`${base}/v1/recipes`, readLimiter, recipeRouter);

   app.get(`${base}/v1/recipes/:recipeId/reviews`, readLimiter, ...);
   app.get(`${base}/v1/users/:username/recipes/:recipename`, readLimiter, ...);
   app.get(`${base}/v1/users/:userId/recipes`, readLimiter, ...);
   app.get(`${base}/v1/users/:userId/collections`, readLimiter, ...);
   ```

3. The `health` endpoint should remain exempt (monitoring systems probe it frequently).

---

## ISSUE-06 · Array Fields Have No Maximum Length

**Severity:** Medium  
**Category:** Validation  
**Files:**
- `src/modules/recipes/recipe.schema.ts` lines 20–27
- `src/modules/collections/collection.schema.ts` lines 13–26
- `src/modules/reviews/review.schema.ts` line 7

### Problematic code

```ts
// recipe.schema.ts
tags: z.array(z.string().min(1)).default([]),         // no .max()
imageUrls: z.array(z.string().url()).default([]),      // no .max()
ingredients: z.array(ingredientSchema).default([]),   // no .max()
steps: z.array(stepSchema).default([]),               // no .max()

// collection.schema.ts
recipes: z.array(...).min(1),    // no .max()
recipeIds: z.array(...).min(1),  // no .max()

// review.schema.ts
imageUrls: z.array(z.string().url()).optional().default([]),  // no .max()
```

### Why it is wrong

A single malicious or buggy request with 10,000 ingredients, 5,000 steps, or 10,000
recipe IDs will be accepted, then executed inside a Prisma transaction. This creates
unbounded DB write pressure and can lock rows or exhaust connection pool time.

### What the fix must do

Add `.max(N)` constraints to all array fields. Suggested limits (adjust based on
product requirements):

| Field | Suggested max |
|---|---|
| `tags` (recipe) | 20 |
| `imageUrls` (recipe) | 20 |
| `ingredients` | 200 |
| `steps` | 100 |
| `addRecipesSchema.recipes` | 100 |
| `removeRecipesSchema.recipeIds` | 100 |
| `imageUrls` (review) | 10 |

Apply the `.max()` in the Zod array definition, for example:

```ts
ingredients: z.array(ingredientSchema).max(200).default([]),
steps: z.array(stepSchema).max(100).default([]),
tags: z.array(z.string().min(1)).max(20).default([]),
imageUrls: z.array(z.string().url()).max(20).default([]),
```

Also add individual string length limits where missing:
- `ingredientSchema.name`: add `.max(200)`
- `ingredientSchema.unit`: add `.max(50)`
- `ingredientSchema.notes`: add `.max(500)`
- `stepSchema.instruction`: add `.max(2000)`
- `recipeQuerySchema.category`: add `.max(100)`
- `recipeQuerySchema.tags` (the comma-separated string): add `.max(500)`

---

## ISSUE-07 · Unbounded Collection Recipe Fetch

**Severity:** High  
**Category:** Scalability  
**File:** `src/modules/collections/collection.service.ts` lines 13–22

### Problematic code

```ts
const collectionInclude = {
  owner: { select: { ... } },
  recipes: {
    orderBy: { order: 'asc' as const },
    include: {
      recipe: { select: { id: true, slug: true, title: true, coverImageUrl: true } },
    },
    // ← no `take` limit
  },
  _count: { select: { followers: true } },
} satisfies Prisma.CollectionInclude;
```

### Why it is wrong

Every call to `getCollectionById` or `listCollectionsByUser` loads ALL recipes in
every collection. A collection with 1,000 saved recipes returns all 1,000 inline on
every request. The list endpoint compounds this across every collection returned.

### What the fix must do

**Option A — Paginated recipes sub-resource (preferred):**

1. Remove `recipes` from `collectionInclude` and create a separate
   `collectionSummaryInclude` (owner + follower count only, no recipes).

2. Add a new service function `listRecipesByCollection(collectionId, query)` that
   paginates `CollectionRecipe` with `take`/`skip` and returns the standard paginated
   response shape.

3. Add a new route `GET /collections/:collectionId/recipes` that calls this service.

4. `getCollectionById` returns collection metadata + paginated first page of recipes
   (or metadata only, with recipes fetched separately).

**Option B — Hard cap (quick fix):**

Add `take: 50` to the `recipes` include and document that collection detail only
shows the first 50 recipes. This is a minimum viable change while Option A is
implemented:

```ts
recipes: {
  orderBy: { order: 'asc' as const },
  take: 50,
  include: {
    recipe: { select: { id: true, slug: true, title: true, coverImageUrl: true } },
  },
},
```

The CLAUDE.md API reference and OpenAPI docs must be updated to reflect whichever
approach is chosen.

---

## ISSUE-08 · N+1 Queries in `upsertTags`

**Severity:** Medium  
**Category:** Performance  
**File:** `src/modules/tags/tag.service.ts` lines 8–13

### Problematic code

```ts
const tags = await Promise.all(
  tagNames.map((name) => {
    const slug = slugify(name);
    return prisma.tag.upsert({
      where: { slug },
      update: {},
      create: { name: name.toLowerCase(), slug },
    });
  }),
);
```

### Why it is wrong

Each tag is a separate database round-trip. With 15 tags and high write concurrency,
this creates 15 × N concurrent upserts. Concurrent upserts on the same unique slug
can also trigger Prisma P2002 errors that are not caught here.

### What the fix must do

Replace the parallel upsert loop with a batch approach:

1. Compute all slugs and de-duplicate them before hitting the DB.

2. Use `createMany` with `skipDuplicates: true` to insert any new tags in a single
   statement.

3. Fetch all relevant tags with a single `findMany`:

```ts
export async function upsertTags(tagNames: string[]): Promise<Tag[]> {
  if (tagNames.length === 0) return [];

  const entries = tagNames.map((name) => ({
    name: name.toLowerCase(),
    slug: slugify(name),
  }));

  const uniqueSlugs = [...new Set(entries.map((e) => e.slug))];
  const uniqueEntries = uniqueSlugs.map(
    (slug) => entries.find((e) => e.slug === slug)!,
  );

  await prisma.tag.createMany({
    data: uniqueEntries,
    skipDuplicates: true,
  });

  return prisma.tag.findMany({
    where: { slug: { in: uniqueSlugs } },
  });
}
```

This reduces the operation from N round-trips to exactly 2, regardless of how many
tags are submitted.

---

## ISSUE-09 · Race Condition in `provisionUser`

**Severity:** Medium  
**Category:** Correctness  
**File:** `src/modules/users/user.service.ts` lines 10–25

### Problematic code

```ts
const existing = await prisma.user.findUnique({ where: { keycloakId } });
if (existing) {
  return { user: existing, created: false };
}

try {
  const user = await prisma.user.create({ ... });
  return { user, created: true };
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw ApiError.conflict('Username already taken');  // ← wrong error for keycloakId race
  }
  throw e;
}
```

### Why it is wrong

The check-then-create is not atomic. Two concurrent first-login requests for the same
Keycloak sub can both pass `findUnique` (both see no existing row), then both attempt
`create`. The second one hits the unique constraint on `keycloakId` and throws P2002,
which is caught and re-thrown as `ApiError.conflict('Username already taken')` — the
wrong message. The frontend receives a confusing 409 instead of the expected idempotent
200.

### What the fix must do

Distinguish between which unique constraint fired by inspecting `err.meta.target`:

```ts
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const target = (e.meta?.target as string[] | undefined) ?? [];
    if (target.includes('keycloakId')) {
      // Race on first login — another request already created the row; return it.
      const existing = await prisma.user.findUnique({ where: { keycloakId } });
      if (existing) return { user: existing, created: false };
    }
    throw ApiError.conflict('Username already taken');
  }
  throw e;
}
```

This makes the provision endpoint correctly idempotent under concurrent first-login
requests.

---

## ISSUE-10 · Non-null Assertion After Re-fetch in Collection Service

**Severity:** Low  
**Category:** Correctness  
**File:** `src/modules/collections/collection.service.ts` lines 146–152 and 161–167

### Problematic code

```ts
// addRecipesToCollection
const collection = await prisma.collection.findUnique({
  where: { id: collectionId },
  include: collectionInclude,
});
return formatCollection(collection!);  // ← crashes if deleted between mutation and re-fetch

// removeRecipesFromCollection
const collection = await prisma.collection.findUnique({ ... });
return formatCollection(collection!);  // ← same issue
```

### Why it is wrong

If the collection is deleted concurrently between the `createMany`/`deleteMany` and
the final re-fetch, `findUnique` returns `null`. The non-null assertion `!` bypasses
TypeScript's null check and causes a runtime `TypeError: Cannot read properties of
null` which propagates as an unhandled 500 instead of a proper `ApiError.notFound`.

### What the fix must do

Add a null guard after both re-fetches in `addRecipesToCollection` and
`removeRecipesFromCollection`:

```ts
const collection = await prisma.collection.findUnique({
  where: { id: collectionId },
  include: collectionInclude,
});
if (!collection) throw ApiError.notFound('Collection');
return formatCollection(collection);
```

Remove both `!` assertions. No other changes needed.

---

## ISSUE-11 · `Math.random()` Slug Collision Not Handled in `createRecipe`

**Severity:** Low  
**Category:** Correctness / Reliability  
**Files:**
- `src/utils/slugify.ts` line 14
- `src/modules/recipes/recipe.service.ts` lines 137–172

### Problematic code

```ts
// slugify.ts
const suffix = Math.random().toString(36).slice(2, 6);

// recipe.service.ts — createRecipe has no P2002 handler
const recipe = await prisma.recipe.create({ data: { slug, ... } });
```

### Why it is wrong

`Math.random()` with 4 base-36 characters gives 1,679,616 possible suffixes. For a
prolific author with many similarly-titled recipes, collisions on `@@unique([authorId,
slug])` are realistic. When one occurs, Prisma throws P2002, which is not caught in
`createRecipe` — it bubbles up as a raw 500 error.

Additionally, `Math.random()` is not a cryptographically secure RNG. For a suffix
whose only purpose is collision avoidance (not security), using `crypto.randomBytes`
is more robust.

### What the fix must do

1. Change `generateRecipeSlug` in `src/utils/slugify.ts` to use Node's `crypto`:

   ```ts
   import { randomBytes } from 'crypto';

   export function generateRecipeSlug(title: string): string {
     const base = slugify(title);
     const suffix = randomBytes(3).toString('hex'); // 6 hex chars, 16M possibilities
     return base ? `${base}-${suffix}` : suffix;
   }
   ```

   The `base ?` guard also fixes the edge case where a non-latin title produces an
   empty base (see note below).

2. Wrap the `prisma.recipe.create` call in `createRecipe` with a retry on P2002
   targeting the `[authorId, slug]` constraint:

   ```ts
   for (let attempt = 0; attempt < 3; attempt++) {
     const slug = generateRecipeSlug(input.title);
     try {
       const recipe = await prisma.recipe.create({ data: { slug, ... } });
       // ...
       return formatted;
     } catch (e) {
       if (
         e instanceof Prisma.PrismaClientKnownRequestError &&
         e.code === 'P2002' &&
         (e.meta?.target as string[] | undefined)?.includes('slug')
       ) {
         if (attempt === 2) throw ApiError.internal('Could not generate a unique slug');
         continue;
       }
       throw e;
     }
   }
   ```

---

## ISSUE-12 · `estimatedTotalHits` Used for Pagination Math

**Severity:** Low  
**Category:** Correctness  
**File:** `src/modules/recipes/recipe.search.ts` line 64

### Problematic code

```ts
meta: buildMeta(page, limit, result.estimatedTotalHits ?? 0),
```

### Why it is wrong

Meilisearch returns `estimatedTotalHits` as an approximation for performance, not an
exact count. Using it to compute `totalPages` and `hasNextPage` in `buildMeta` can
yield incorrect pagination metadata: users may navigate to a page number that appears
valid but returns 0 results, or the true last page is unreachable.

### What the fix must do

Configure the search call to request an exact total hit count by passing
`hitsPerPage` and `page` (Meilisearch pagination mode) instead of `offset`/`limit`,
OR by enabling `matchingStrategy` + requesting `totalHits`. The simplest fix is to
request `totalHits` by passing `{ limit }` to make Meilisearch compute the exact
count when the result set is small:

```ts
const result = await meiliClient.index(RECIPES_INDEX).search<RecipeSearchDocument>(q, {
  filter: filter.length > 0 ? filter : undefined,
  sort: [`${sortBy}:${order}`],
  offset: toSkip(page, limit),
  limit,
  // Request exact total for accurate pagination:
  hitsPerPage: limit,
  page,
});

return {
  data: result.hits.map((hit) => ({
    ...hit,
    description: (hit.description ?? '').slice(0, 200),
  })),
  meta: buildMeta(page, limit, result.totalHits ?? result.estimatedTotalHits ?? 0),
};
```

Also remove the `(hit: any)` cast on line 60 — `result.hits` is already typed as
`RecipeSearchDocument[]` from the generic parameter, so the `any` is unnecessary
and silently disables type checking on that map callback.

---

## Cross-cutting notes for the fixing agent

- All schema changes require regenerating the OpenAPI spec if it is generated from
  Zod schemas via `@asteasolutions/zod-to-openapi`. Run `npm run build` and verify
  the OpenAPI test (`tests/unit/docs/openapi.test.ts`) still passes after changes.
- Slug generation changes must update the corresponding unit tests in
  `tests/unit/utils/slugify.test.ts`.
- `upsertTags` changes must update `tests/unit/recipes/recipe.service.test.ts` —
  the mock for `tag.service` may need adjustment.
- ISSUE-03 (audience) changes must update the env mock in
  `tests/unit/middlewares/authenticate.test.ts` to always include `KEYCLOAK_AUDIENCE`.
- Run `npm test` after each fix to ensure existing 119 tests continue to pass.
