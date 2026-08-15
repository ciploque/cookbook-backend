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

  // body-parser (express.json) errors carry a `type` discriminator. Map the common ones to
  // their proper status instead of letting them fall through to a generic 500.
  const bodyParserType = (err as { type?: unknown })?.type;
  if (bodyParserType === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', details: null },
    });
    return;
  }
  if (bodyParserType === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Malformed JSON in request body', details: null },
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
