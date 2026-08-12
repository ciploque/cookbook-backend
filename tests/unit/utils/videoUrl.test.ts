import { describe, it, expect } from 'vitest';
import { trustedVideoUrlSchema } from '../../../src/utils/videoUrl';

describe('trustedVideoUrlSchema', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube.com'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtu.be'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'youtube-nocookie.com'],
    ['https://vimeo.com/12345', 'vimeo.com'],
    ['https://player.vimeo.com/video/12345', 'player.vimeo.com'],
    ['https://www.tiktok.com/@user/video/12345', 'tiktok.com'],
    ['https://www.instagram.com/reel/abc123/', 'instagram.com'],
    ['https://www.facebook.com/watch/?v=12345', 'facebook.com'],
    ['https://fb.watch/abc123/', 'fb.watch'],
    ['https://www.loom.com/share/abc123', 'loom.com'],
  ])('accepts %s (%s)', (url) => {
    const result = trustedVideoUrlSchema.safeParse(url);
    expect(result.success).toBe(true);
  });

  it('rejects a non-URL string', () => {
    const result = trustedVideoUrlSchema.safeParse('not-a-url');
    expect(result.success).toBe(false);
  });

  it('rejects http:// (non-https) even for an allowed host', () => {
    const result = trustedVideoUrlSchema.safeParse('http://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.success).toBe(false);
  });

  it('rejects a disallowed host', () => {
    const result = trustedVideoUrlSchema.safeParse('https://evil.com/video.mp4');
    expect(result.success).toBe(false);
  });

  it('rejects the userinfo bypass (hostname resolves to the part after @)', () => {
    const result = trustedVideoUrlSchema.safeParse('https://youtube.com@evil.com/');
    expect(result.success).toBe(false);
  });

  it('rejects a lookalike host that merely starts with an allowed domain name', () => {
    const result = trustedVideoUrlSchema.safeParse('https://evilyoutube.com/watch?v=1');
    expect(result.success).toBe(false);
  });

  it('rejects a suffix bypass where the allowed domain is a prefix of a longer host', () => {
    const result = trustedVideoUrlSchema.safeParse('https://youtube.com.evil.com/watch?v=1');
    expect(result.success).toBe(false);
  });

  it('rejects a javascript: scheme', () => {
    const result = trustedVideoUrlSchema.safeParse('javascript:alert(1)');
    expect(result.success).toBe(false);
  });
});
