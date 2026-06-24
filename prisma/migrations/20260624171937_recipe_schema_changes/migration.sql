/*
  Warnings:

  - You are about to drop the column `cookTimeMinutes` on the `recipes` table. All the data in the column will be lost.
  - You are about to drop the column `imageUrl` on the `recipes` table. All the data in the column will be lost.
  - The `difficulty` column on the `recipes` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "recipes" DROP COLUMN "cookTimeMinutes",
DROP COLUMN "imageUrl",
ADD COLUMN     "coverImageUrl" TEXT,
ADD COLUMN     "imageUrls" TEXT[],
ALTER COLUMN "description" DROP NOT NULL,
DROP COLUMN "difficulty",
ADD COLUMN     "difficulty" INTEGER;

-- DropEnum
DROP TYPE "Difficulty";
