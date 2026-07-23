export type DetectedImageType = 'jpeg' | 'png' | 'webp' | 'gif';

const SIGNATURES: { type: DetectedImageType; extension: string; matches: (buf: Buffer) => boolean }[] = [
  {
    type: 'jpeg',
    extension: 'jpg',
    matches: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    type: 'png',
    extension: 'png',
    matches: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    type: 'webp',
    extension: 'webp',
    matches: (buf) =>
      buf.length >= 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    type: 'gif',
    extension: 'gif',
    matches: (buf) => {
      const header = buf.toString('ascii', 0, 6);
      return header === 'GIF87a' || header === 'GIF89a';
    },
  },
];

// Verifies the *actual* file content via magic bytes rather than trusting the
// client-declared multer mimetype, which is easily spoofed. Deliberately
// excludes SVG (script-capable, XSS risk if ever served inline).
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  const signature = SIGNATURES.find((s) => s.matches(buffer));
  return signature?.type ?? null;
}

export function extensionForImageType(type: DetectedImageType): string {
  return SIGNATURES.find((s) => s.type === type)!.extension;
}
