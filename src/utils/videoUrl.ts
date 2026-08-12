import { z } from 'zod';

// Fixed, hard-coded allowlist (not env-configurable, unlike trustedImageUrlSchema) —
// video URLs are always validated, with no "allow all" fallback. Cloudflare R2 origin
// support is planned but intentionally not included yet: it needs a public R2 domain
// that doesn't exist in this deployment yet (see CLAUDE.md "Schema decisions").
const ALLOWED_VIDEO_HOSTS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'vimeo.com',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'fb.watch',
  'loom.com',
];

// Exact match or subdomain match (`.` boundary) — rejects lookalikes like
// "evilyoutube.com" or "youtube.com.evil.com" that a naive substring/endsWith
// check without the boundary would let through.
function hostMatchesAllowedDomain(hostname: string, allowedDomain: string): boolean {
  return hostname === allowedDomain || hostname.endsWith(`.${allowedDomain}`);
}

function isAllowedVideoUrl(value: string): boolean {
  let url: URL;
  try {
    // WHATWG URL parsing (not regex) correctly resolves userinfo tricks like
    // "https://youtube.com@evil.com/" to hostname "evil.com", not "youtube.com".
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;

  return ALLOWED_VIDEO_HOSTS.some((domain) => hostMatchesAllowedDomain(url.hostname, domain));
}

export const trustedVideoUrlSchema = z.string().url().refine(isAllowedVideoUrl, {
  message:
    'Video URL must be an https link from YouTube, Vimeo, TikTok, Instagram, Facebook, or Loom',
});
