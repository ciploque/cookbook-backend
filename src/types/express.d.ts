import 'express';

export interface KeycloakTokenPayload {
  sub: string;
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
}

declare module 'express' {
  interface Request {
    user?: KeycloakTokenPayload;
  }
}
