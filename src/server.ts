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

// server.close() doesn't await its callback, so the disconnect promise is handled explicitly
// here (.then/.catch) rather than via an async callback, which close() would silently not wait on.
function shutdown(signal: string): void {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => {
    prisma
      .$disconnect()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error('Error disconnecting Prisma during shutdown:', err);
        process.exit(1);
      });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
