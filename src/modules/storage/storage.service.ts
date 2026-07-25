import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET_NAME } from '../../config/r2';
import { ApiError } from '../../utils/ApiError';
import { detectImageType, extensionForImageType } from '../../utils/imageSignature';

const CONTENT_TYPE_BY_TYPE: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Generic, provider-agnostic image storage — reusable by any module (recipes today,
// avatars/reviews later). Returns/accepts relative paths only (leading "/", e.g.
// "/recipes/<id>/cover/<uuid>.jpg"); callers persist that path as-is. The frontend
// prepends its own base URL — this backend never builds a full URL — so the storage
// provider can change without a data migration or a frontend contract change.
export async function storeImage(buffer: Buffer, folder: string): Promise<string> {
  const imageType = detectImageType(buffer);
  if (!imageType) {
    throw ApiError.validation({ image: ['File is not a valid JPEG, PNG, WEBP, or GIF image'] });
  }

  const extension = extensionForImageType(imageType);
  const key = `${folder}/${randomUUID()}.${extension}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: CONTENT_TYPE_BY_TYPE[imageType],
    }),
  );

  return buildImageUrl(key);
}

// Accepts the stored path (leading "/", as persisted/returned by storeImage) and
// strips it back off to reconstruct the real R2 object key before deleting — the
// object itself was never uploaded with a leading slash in its key.
export async function deleteImage(path: string): Promise<void> {
  const key = path.replace(/^\/+/, '');
  await r2Client
    .send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }))
    .catch((err: unknown) => console.error('[storage] deleteImage failed:', path, err));
}

export function buildImageUrl(key: string): string {
  return `/${key}`;
}
