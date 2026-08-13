import { z } from 'zod';
import { trustedImageDomains } from '../config/env';

function isTrustedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // https-only regardless of allowlist config — closes off javascript:/data: schemes,
  // which a bare z.string().url() happily accepts since it only checks the string parses.
  if (parsed.protocol !== 'https:') return false;
  if (trustedImageDomains.length === 0) return true; // no domain allowlist configured → allow any https host
  return trustedImageDomains.includes(parsed.hostname);
}

export const trustedImageUrlSchema = z
  .string()
  .url()
  .refine(isTrustedUrl, { message: 'Image URL hostname is not in the trusted domain list' });
