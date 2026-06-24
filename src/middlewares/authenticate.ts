import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { jwksClient } from '../config/keycloak';
import { env, keycloakIssuer } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { KeycloakTokenPayload } from '../types/express';

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  if (!header.kid) {
    callback(new Error('No kid in token header'));
    return;
  }
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      callback(err ?? new Error('Signing key not found'));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  if (env.NODE_ENV === 'development') {
    const devSub = req.headers['x-dev-user-sub'];
    if (devSub && typeof devSub === 'string') {
      req.user = { sub: devSub };
      next();
      return;
    }
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next(ApiError.unauthorized('Missing or malformed Authorization header'));
    return;
  }

  const token = authHeader.slice(7);

  const options: jwt.VerifyOptions = {
    issuer: keycloakIssuer,
    algorithms: ['RS256'],
  };

  if (env.KEYCLOAK_AUDIENCE) {
    options.audience = env.KEYCLOAK_AUDIENCE;
  }

  jwt.verify(token, getKey, options, (err, decoded) => {
    if (err || !decoded) {
      next(ApiError.unauthorized('Invalid or expired token'));
      return;
    }
    req.user = decoded as KeycloakTokenPayload;
    next();
  });
}
