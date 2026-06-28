import 'express';

export interface AuthTokenPayload {
  sub: string;
  email?: string;
  given_name?: string;
  family_name?: string;
}

declare module 'express' {
  interface Request {
    user?: AuthTokenPayload;
  }
}
