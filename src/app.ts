import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { clerkMiddleware } from '@clerk/express';
import { env, allowedOrigins } from './config/env';
import { buildOpenApiDocument } from './docs/openapi';
import { prisma } from './config/database';
import { requestLogger } from './middlewares/requestLogger';
import { errorHandler } from './middlewares/errorHandler';
import userRouter from './modules/users/user.router';
import recipeRouter, { userRecipesRouter } from './modules/recipes/recipe.router';
import reviewRouter, { recipeReviewsRouter } from './modules/reviews/review.router';
import collectionRouter, { userCollectionsRouter } from './modules/collections/collection.router';
import webhookRouter from './modules/webhooks/clerk.webhook.router';
import { asyncHandler } from './utils/asyncHandler';

export function createApp(): express.Application {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY); // trusted proxy hops (env-driven) so req.ip is the real client IP, not a spoofable X-Forwarded-For

  app.use(helmet());
  const corsOptions: cors.CorsOptions = {
    // ALLOWED_ORIGINS="*" → reflect the request origin (required when credentials: true;
    // the string literal "*" is rejected by browsers when credentials are present).
    origin: env.ALLOWED_ORIGINS === '*' ? true : allowedOrigins,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-dev-user-sub',
      'ngrok-skip-browser-warning',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  };
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions)); // respond 204 to all preflight requests

  // clerkMiddleware throws on a structurally malformed token (e.g. a non-JWT Bearer value).
  // Swallow that error so the request continues unauthenticated: `authenticate` then returns a
  // clean 401 on protected routes instead of a 500, and public routes keep working.
  const clerk = clerkMiddleware();
  app.use((req, res, next) => {
    clerk(req, res, () => next()); // ignore token-parse errors; continue unauthenticated
  });

  const base = env.API_BASE_PATH;

  // Mounted before express.json() — Clerk webhook signature verification needs the raw,
  // unparsed request body, which the global JSON parser below would otherwise consume.
  app.use(`${base}/v1/webhooks`, webhookRouter);

  app.use(express.json());
  app.use(requestLogger);

  const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // More generous than writeLimiter — covers public read endpoints that fan out to
  // Meilisearch or issue multiple DB queries, which were previously unlimited.
  const readLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.get(
    '/health',
    asyncHandler(async (_req, res) => {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', db: 'connected' });
    }),
  );

  app.use(`${base}/v1/users`, writeLimiter, userRouter);
  app.use(`${base}/v1/users`, readLimiter, userRecipesRouter);
  app.use(`${base}/v1/users`, readLimiter, userCollectionsRouter);
  app.use(`${base}/v1/recipes`, readLimiter, recipeRouter);
  app.use(`${base}/v1/recipes`, readLimiter, recipeReviewsRouter);
  app.use(`${base}/v1/reviews`, writeLimiter, reviewRouter);
  app.use(`${base}/v1/collections`, writeLimiter, collectionRouter);

  if (env.NODE_ENV !== 'production') {
    const removeCSP = (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      res.removeHeader('Content-Security-Policy'); // helmet's CSP blocks swagger UI inline scripts
      next();
    };

    // Spec is served dynamically so the `servers` URL matches whatever host the docs are opened from
    // (localhost, a LAN IP, a tunnel URL, etc.) — Swagger UI "Try it out" calls stay same-origin.
    app.get('/api-docs.json', cors(), removeCSP, (_req: express.Request, res: express.Response) => {
      res.json(buildOpenApiDocument());
    });

    app.use(
      '/api-docs',
      cors(), // allow any origin — docs are public
      removeCSP,
      swaggerUi.serve,
      swaggerUi.setup(undefined, { swaggerOptions: { url: '/api-docs.json' } }),
    );
  }

  app.use(errorHandler);

  return app;
}
