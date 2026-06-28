-- Rename column keycloakId -> authProviderId (preserves existing data)
ALTER TABLE "users" RENAME COLUMN "keycloakId" TO "authProviderId";

-- Rename the unique index to match Prisma's expected name
ALTER INDEX "users_keycloakId_key" RENAME TO "users_authProviderId_key";
