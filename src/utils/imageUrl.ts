import { z } from 'zod';
import { trustedImageDomains } from '../config/env';

function isTrustedUrl(url: string): boolean {
  if (trustedImageDomains.length === 0) return true; // no allowlist configured → allow all
  try {
    const hostname = new URL(url).hostname;
    return trustedImageDomains.includes(hostname);
  } catch {
    return false;
  }
}

export const trustedImageUrlSchema = z
  .string()
  .url()
  .refine(isTrustedUrl, { message: 'Image URL hostname is not in the trusted domain list' });
