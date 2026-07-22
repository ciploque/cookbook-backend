-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "averageRating" DOUBLE PRECISION,
ADD COLUMN     "ratingSum" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "recipes_averageRating_idx" ON "recipes"("averageRating");
