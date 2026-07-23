import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('../../../src/config/r2', () => ({
  r2Client: { send: sendMock },
  R2_BUCKET_NAME: 'test-bucket',
}));

vi.mock('../../../src/config/env', () => ({
  env: { R2_PUBLIC_BASE_URL: 'https://cdn.example.com' },
}));

import {
  buildImageUrl,
  buildImageUrls,
  deleteImage,
  storeImage,
} from '../../../src/modules/storage/storage.service';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);

beforeEach(() => vi.clearAllMocks());

// ─── storeImage ───────────────────────────────────────────────────────────────

describe('storeImage()', () => {
  it('uploads a valid image and returns a relative key scoped to the given folder', async () => {
    sendMock.mockResolvedValue({});

    const key = await storeImage(PNG_BYTES, 'recipes/r1/cover');

    expect(key).toMatch(/^recipes\/r1\/cover\/[0-9a-f-]{36}\.png$/);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('rejects content that is not a recognized image type, without calling R2', async () => {
    const bogus = Buffer.from('not an image');

    await expect(storeImage(bogus, 'recipes/r1/cover')).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

// ─── deleteImage ──────────────────────────────────────────────────────────────

describe('deleteImage()', () => {
  it('sends a delete request for the given key', async () => {
    sendMock.mockResolvedValue({});

    await deleteImage('recipes/r1/cover/old.jpg');

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when the underlying R2 call fails', async () => {
    sendMock.mockRejectedValue(new Error('network error'));

    await expect(deleteImage('recipes/r1/cover/old.jpg')).resolves.toBeUndefined();
  });
});

// ─── buildImageUrl / buildImageUrls ───────────────────────────────────────────

describe('buildImageUrl() / buildImageUrls()', () => {
  it('prepends the configured public base URL to a relative key', () => {
    expect(buildImageUrl('recipes/r1/cover/x.jpg')).toBe(
      'https://cdn.example.com/recipes/r1/cover/x.jpg',
    );
  });

  it('maps an array of relative keys to full URLs', () => {
    expect(buildImageUrls(['a.jpg', 'b.jpg'])).toEqual([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(buildImageUrls([])).toEqual([]);
  });
});
