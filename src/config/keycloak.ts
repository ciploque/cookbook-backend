import JwksRsa from 'jwks-rsa';
import { keycloakJwksUri } from './env';

export const jwksClient = JwksRsa({
  jwksUri: keycloakJwksUri,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600_000, // 10 minutes
  rateLimit: true,
});
