/*
  Warnings:

  - You are about to drop the column `category` on the `recipes` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "recipes_category_idx";

-- AlterTable
ALTER TABLE "recipes" DROP COLUMN "category";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "about" TEXT;

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_categories" (
    "recipeId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "recipe_categories_pkey" PRIMARY KEY ("recipeId","categoryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "recipe_categories_categoryId_idx" ON "recipe_categories"("categoryId");

-- AddForeignKey
ALTER TABLE "recipe_categories" ADD CONSTRAINT "recipe_categories_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_categories" ADD CONSTRAINT "recipe_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
