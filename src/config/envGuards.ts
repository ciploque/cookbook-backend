// Pure, side-effect-free env guards, kept separate from `env.ts` so they can be unit-tested
// without triggering env.ts's load-time validation + process.exit.

/**
 * A wildcard CORS origin (`ALLOWED_ORIGINS=*`) makes the server reflect any request origin
 * while `credentials: true` is set — letting any website make credentialed cross-site calls.
 * Convenient in dev, dangerous in production. Returns an error message when the combination is
 * present in production, otherwise `null`.
 */
export function assertProductionOrigins(nodeEnv: string, allowedOrigins: string): string | null {
  if (nodeEnv === 'production' && allowedOrigins.trim() === '*') {
    return 'ALLOWED_ORIGINS="*" is not permitted when NODE_ENV=production — it reflects any origin with credentials enabled. Set an explicit comma-separated allowlist.';
  }
  return null;
}
