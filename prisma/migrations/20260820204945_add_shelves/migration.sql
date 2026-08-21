-- CreateTable
CREATE TABLE "shelves" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "source" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "maxItems" INTEGER NOT NULL DEFAULT 20,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelf_items" (
    "shelfId" UUID NOT NULL,
    "recipeId" UUID NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "shelf_items_pkey" PRIMARY KEY ("shelfId","recipeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "shelves_slug_key" ON "shelves"("slug");

-- CreateIndex
CREATE INDEX "shelves_isActive_position_idx" ON "shelves"("isActive", "position");

-- CreateIndex
CREATE INDEX "shelf_items_shelfId_order_idx" ON "shelf_items"("shelfId", "order");

-- AddForeignKey
ALTER TABLE "shelf_items" ADD CONSTRAINT "shelf_items_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelves"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelf_items" ADD CONSTRAINT "shelf_items_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

