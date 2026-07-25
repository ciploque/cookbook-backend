-- Switch id/FK columns from TEXT to native Postgres `uuid` for smaller indexes and
-- faster comparisons. Existing values are valid UUID strings (Prisma's uuid()), so
-- they are cast in place rather than dropped/recreated.
-- ID generation itself moves from uuid() (v4) to uuid(7) at the Prisma Client level
-- (client-side, no DB default involved) for better insert locality; unrelated to
-- this SQL. Also adds indexes on FK columns that previously only had one via a
-- composite primary key (recipe_tags.tagId, collection_recipes.recipeId,
-- collection_followers.userId).

-- DropForeignKey
ALTER TABLE "recipes" DROP CONSTRAINT "recipes_authorId_fkey";
ALTER TABLE "recipe_ingredients" DROP CONSTRAINT "recipe_ingredients_recipeId_fkey";
ALTER TABLE "recipe_steps" DROP CONSTRAINT "recipe_steps_recipeId_fkey";
ALTER TABLE "recipe_tags" DROP CONSTRAINT "recipe_tags_recipeId_fkey";
ALTER TABLE "recipe_tags" DROP CONSTRAINT "recipe_tags_tagId_fkey";
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_authorId_fkey";
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_recipeId_fkey";
ALTER TABLE "collections" DROP CONSTRAINT "collections_ownerId_fkey";
ALTER TABLE "collection_recipes" DROP CONSTRAINT "collection_recipes_collectionId_fkey";
ALTER TABLE "collection_recipes" DROP CONSTRAINT "collection_recipes_recipeId_fkey";
ALTER TABLE "collection_followers" DROP CONSTRAINT "collection_followers_collectionId_fkey";
ALTER TABLE "collection_followers" DROP CONSTRAINT "collection_followers_userId_fkey";

-- AlterColumn (TEXT -> UUID, cast in place)
ALTER TABLE "users" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;

ALTER TABLE "recipes" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "recipes" ALTER COLUMN "authorId" TYPE UUID USING "authorId"::uuid;

ALTER TABLE "recipe_ingredients" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "recipe_ingredients" ALTER COLUMN "recipeId" TYPE UUID USING "recipeId"::uuid;

ALTER TABLE "recipe_steps" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "recipe_steps" ALTER COLUMN "recipeId" TYPE UUID USING "recipeId"::uuid;

ALTER TABLE "tags" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;

ALTER TABLE "recipe_tags" ALTER COLUMN "recipeId" TYPE UUID USING "recipeId"::uuid;
ALTER TABLE "recipe_tags" ALTER COLUMN "tagId" TYPE UUID USING "tagId"::uuid;

ALTER TABLE "reviews" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "reviews" ALTER COLUMN "recipeId" TYPE UUID USING "recipeId"::uuid;
ALTER TABLE "reviews" ALTER COLUMN "authorId" TYPE UUID USING "authorId"::uuid;

ALTER TABLE "collections" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "collections" ALTER COLUMN "ownerId" TYPE UUID USING "ownerId"::uuid;

ALTER TABLE "collection_recipes" ALTER COLUMN "collectionId" TYPE UUID USING "collectionId"::uuid;
ALTER TABLE "collection_recipes" ALTER COLUMN "recipeId" TYPE UUID USING "recipeId"::uuid;

ALTER TABLE "collection_followers" ALTER COLUMN "collectionId" TYPE UUID USING "collectionId"::uuid;
ALTER TABLE "collection_followers" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_tags" ADD CONSTRAINT "recipe_tags_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_tags" ADD CONSTRAINT "recipe_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collections" ADD CONSTRAINT "collections_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_recipes" ADD CONSTRAINT "collection_recipes_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_recipes" ADD CONSTRAINT "collection_recipes_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_followers" ADD CONSTRAINT "collection_followers_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_followers" ADD CONSTRAINT "collection_followers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (previously-missing FK indexes)
CREATE INDEX "recipe_tags_tagId_idx" ON "recipe_tags"("tagId");
CREATE INDEX "collection_recipes_recipeId_idx" ON "collection_recipes"("recipeId");
CREATE INDEX "collection_followers_userId_idx" ON "collection_followers"("userId");
