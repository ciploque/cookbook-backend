import multer, { FileFilterCallback } from 'multer';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../utils/ApiError';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// Cheap first-pass filter on the client-declared mimetype. Not trusted as the sole
// guard — storage.service#storeImage verifies the actual file content via magic bytes
// before anything is uploaded to R2.
function imageFileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  if (!file.mimetype.startsWith('image/')) {
    cb(new Error('Only image files are allowed'));
    return;
  }
  cb(null, true);
}

const storage = multer.memoryStorage();

// Translates multer's raw errors (wrong type, too large, too many files) into the
// project's ApiError/422 convention instead of leaking a generic 500.
function toApiError(err: unknown): ApiError {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return ApiError.validation({ image: ['File exceeds the maximum size of 5MB'] });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return ApiError.validation({ image: ['Too many files in this upload'] });
    }
  }
  const message = err instanceof Error ? err.message : 'Invalid file upload';
  return ApiError.validation({ image: [message] });
}

function wrap(middleware: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (err?: unknown) => {
      if (err) {
        next(toApiError(err));
        return;
      }
      next();
    });
  };
}

export function uploadSingleImage(fieldName: string): RequestHandler {
  return wrap(
    multer({
      storage,
      fileFilter: imageFileFilter,
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    }).single(fieldName),
  );
}

export function uploadImagesArray(fieldName: string, maxCount: number): RequestHandler {
  return wrap(
    multer({
      storage,
      fileFilter: imageFileFilter,
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: maxCount },
    }).array(fieldName, maxCount),
  );
}
