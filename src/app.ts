import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { env, allowedOrigins } from './config/env';
import { buildOpenApiDocument } from './docs/openapi';
import { validate } from './middlewares/validate';
import { recipeQuerySchema } from './modules/recipes/recipe.schema';
import { prisma } from './config/database';
import { requestLogger } from './middlewares/requestLogger';
import { errorHandler } from './middlewares/errorHandler';
import userRouter from './modules/users/user.router';
import recipeRouter from './modules/recipes/recipe.router';
import { asyncHandler } from './utils/asyncHandler';
import { listRecipesByUser, getRecipeByUsernameAndSlug } from './modules/recipes/recipe.controller';

export function createApp(): express.Application {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json());
  app.use(requestLogger);

  const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
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

  const base = env.API_BASE_PATH;
  app.use(`${base}/v1/users`, writeLimiter, userRouter);
  app.use(`${base}/v1/recipes`, recipeRouter);

  app.get(`${base}/v1/users/:username/recipes/:recipename`, asyncHandler(getRecipeByUsernameAndSlug));
  app.get(`${base}/v1/users/:userId/recipes`, validate(recipeQuerySchema, 'query'), asyncHandler(listRecipesByUser));

  if (env.NODE_ENV !== 'production') {
    const removeCSP = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.removeHeader('Content-Security-Policy'); // helmet's CSP blocks swagger UI inline scripts
      next();
    };

    // Spec is served dynamically so the `servers` URL matches whatever host the docs are opened from
    // (localhost, a LAN IP, a tunnel URL, etc.) — Swagger UI "Try it out" calls stay same-origin.
    app.get('/api-docs.json', cors(), removeCSP, (req: express.Request, res: express.Response) => {
      res.json(buildOpenApiDocument());
    });

    app.use(
      '/api-docs',
      cors(),    // allow any origin — docs are public
      removeCSP,
      swaggerUi.serve,
      swaggerUi.setup(undefined, { swaggerOptions: { url: '/api-docs.json' } }),
    );
  }

  app.use(errorHandler);

  return app;
}
