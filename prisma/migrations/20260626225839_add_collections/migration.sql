-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_recipes" (
    "collectionId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "collection_recipes_pkey" PRIMARY KEY ("collectionId","recipeId")
);

-- CreateTable
CREATE TABLE "collection_followers" (
    "collectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_followers_pkey" PRIMARY KEY ("collectionId","userId")
);

-- CreateIndex
CREATE INDEX "collections_ownerId_idx" ON "collections"("ownerId");

-- CreateIndex
CREATE INDEX "collection_recipes_collectionId_idx" ON "collection_recipes"("collectionId");

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_recipes" ADD CONSTRAINT "collection_recipes_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_recipes" ADD CONSTRAINT "collection_recipes_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_followers" ADD CONSTRAINT "collection_followers_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_followers" ADD CONSTRAINT "collection_followers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
