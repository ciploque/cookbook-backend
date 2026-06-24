import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
      },
    });
    return;
  }

  const message = env.NODE_ENV === 'production' ? 'Internal server error' : String(err);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message,
      details: null,
    },
  });
}
