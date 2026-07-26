import { describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  trustedImageDomains: [] as string[],
}));

import { trustedImageDomains } from '../../../src/config/env';
import { trustedImageUrlSchema } from '../../../src/utils/imageUrl';

beforeEach(() => {
  trustedImageDomains.length = 0;
});

describe('trustedImageUrlSchema', () => {
  it('accepts any syntactically valid https URL when no allowlist is configured', () => {
    const result = trustedImageUrlSchema.safeParse('https://random-cdn.example.com/pic.jpg');
    expect(result.success).toBe(true);
  });

  it('rejects a non-URL string regardless of allowlist configuration', () => {
    const result = trustedImageUrlSchema.safeParse('not-a-url');
    expect(result.success).toBe(false);
  });

  it('accepts a URL whose hostname is in the allowlist', () => {
    trustedImageDomains.push('cdn.example.com');

    const result = trustedImageUrlSchema.safeParse('https://cdn.example.com/pic.jpg');
    expect(result.success).toBe(true);
  });

  it('rejects a URL whose hostname is not in the allowlist', () => {
    trustedImageDomains.push('cdn.example.com');

    const result = trustedImageUrlSchema.safeParse('https://evil.example.com/pic.jpg');
    expect(result.success).toBe(false);
  });
});
