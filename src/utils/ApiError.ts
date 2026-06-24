export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public override message: string,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(401, message, 'UNAUTHORIZED');
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(403, message, 'FORBIDDEN');
  }

  static notFound(resource: string): ApiError {
    return new ApiError(404, `${resource} not found`, `${resource.toUpperCase().replace(' ', '_')}_NOT_FOUND`);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message, 'CONFLICT');
  }

  static validation(details: unknown): ApiError {
    return new ApiError(422, 'Validation error', 'VALIDATION_ERROR', details);
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, message, 'INTERNAL_ERROR');
  }
}
