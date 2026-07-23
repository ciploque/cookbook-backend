import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET_NAME } from '../../config/r2';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { detectImageType, extensionForImageType } from '../../utils/imageSignature';

const CONTENT_TYPE_BY_TYPE: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Generic, provider-agnostic image storage — reusable by any module (recipes today,
// avatars/reviews later). Returns/accepts relative keys only; callers persist the key,
// never a full URL, so the storage provider can change without a data migration.
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

  return key;
}

export async function deleteImage(key: string): Promise<void> {
  await r2Client
    .send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }))
    .catch((err: unknown) => console.error('[storage] deleteImage failed:', key, err));
}

export function buildImageUrl(key: string): string {
  return `${env.R2_PUBLIC_BASE_URL}/${key}`;
}

export function buildImageUrls(keys: string[]): string[] {
  return keys.map(buildImageUrl);
}
