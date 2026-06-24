import 'dotenv/config';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './config/database';
import { setupMeilisearch } from './config/meilisearchSetup';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT} [${env.NODE_ENV}]`);
  setupMeilisearch().catch((err) => console.error('[meilisearch] setup failed:', err));
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
