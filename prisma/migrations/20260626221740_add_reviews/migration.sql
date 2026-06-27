-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT,
    "imageUrls" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviews_recipeId_idx" ON "reviews"("recipeId");

-- CreateIndex
CREATE INDEX "reviews_authorId_idx" ON "reviews"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_recipeId_authorId_key" ON "reviews"("recipeId", "authorId");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
