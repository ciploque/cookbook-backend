-- Hand-written rather than generated: Prisma's diff for a new required column emits a bare
-- `ADD COLUMN "slug" TEXT NOT NULL`, which fails on a non-empty table. Adding it nullable,
-- backfilling, then tightening to NOT NULL + unique is the same shape applied in three steps.

-- AlterTable
ALTER TABLE "collections" ADD COLUMN "slug" TEXT;

-- Backfill. Approximates src/utils/slugify.ts: lowercase, every run of non-alphanumerics
-- collapsed to '-', leading/trailing '-' trimmed, with the same 'collection' fallback for a name
-- that slugifies to nothing. It does not strip diacritics the way the JS `normalize('NFD')` pass
-- does ("Café" lands on "caf", not "cafe") — a one-time cosmetic divergence on pre-existing rows;
-- every slug written from here on comes from generateCollectionSlug().
-- Names colliding within one owner get a -2, -3 … suffix so the unique index below can be built.
UPDATE "collections" AS c
SET "slug" = b.slug
FROM (
  SELECT
    id,
    CASE WHEN rn = 1 THEN base ELSE base || '-' || rn END AS slug
  FROM (
    SELECT
      id,
      base,
      ROW_NUMBER() OVER (PARTITION BY "ownerId", base ORDER BY "createdAt", id) AS rn
    FROM (
      SELECT
        id,
        "ownerId",
        "createdAt",
        COALESCE(
          NULLIF(trim(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''),
          'collection'
        ) AS base
      FROM "collections"
    ) AS slugged
  ) AS numbered
) AS b
WHERE c.id = b.id;

-- AlterTable
ALTER TABLE "collections" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "collections_ownerId_slug_key" ON "collections"("ownerId", "slug");
