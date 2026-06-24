/*
  Warnings:

  - A unique constraint covering the columns `[authorId,slug]` on the table `recipes` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[username]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `username` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "recipes_slug_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "username" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "recipes_authorId_slug_key" ON "recipes"("authorId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
