import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('../../../src/config/r2', () => ({
  r2Client: { send: sendMock },
  R2_BUCKET_NAME: 'test-bucket',
}));

import { buildImageUrl, deleteImage, storeImage } from '../../../src/modules/storage/storage.service';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);

beforeEach(() => vi.clearAllMocks());

// ─── storeImage ───────────────────────────────────────────────────────────────

describe('storeImage()', () => {
  it('returns a leading-slash path scoped to the given folder', async () => {
    sendMock.mockResolvedValue({});

    const path = await storeImage(PNG_BYTES, 'recipes/r1/cover');

    expect(path).toMatch(/^\/recipes\/r1\/cover\/[0-9a-f-]{36}\.png$/);
  });

  it('uploads to R2 using the unprefixed key (no leading slash)', async () => {
    sendMock.mockResolvedValue({});

    const path = await storeImage(PNG_BYTES, 'recipes/r1/cover');
    const unprefixedKey = path.slice(1);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command.input).toMatchObject({ Bucket: 'test-bucket', Key: unprefixedKey });
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
  it('strips the leading slash before building the delete request', async () => {
    sendMock.mockResolvedValue({});

    await deleteImage('/recipes/r1/cover/old.jpg');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'recipes/r1/cover/old.jpg',
    });
  });

  it('never throws, even when the underlying R2 call fails', async () => {
    sendMock.mockRejectedValue(new Error('network error'));

    await expect(deleteImage('/recipes/r1/cover/old.jpg')).resolves.toBeUndefined();
  });
});

// ─── buildImageUrl ─────────────────────────────────────────────────────────────

describe('buildImageUrl()', () => {
  it('prepends a leading slash to a raw key', () => {
    expect(buildImageUrl('recipes/r1/cover/x.jpg')).toBe('/recipes/r1/cover/x.jpg');
  });
});
