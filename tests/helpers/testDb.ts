import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5433/cookbook_test';

export const testPrisma = new PrismaClient();

beforeAll(async () => {
  await testPrisma.$connect();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});
