/*
  Warnings:

  - The `quantity` column on the `recipe_ingredients` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "recipe_ingredients" DROP COLUMN "quantity",
ADD COLUMN     "quantity" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "recipes" ALTER COLUMN "category" DROP NOT NULL;
