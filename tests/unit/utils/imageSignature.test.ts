import { describe, it, expect } from 'vitest';
import { detectImageType, extensionForImageType } from '../../../src/utils/imageSignature';

describe('detectImageType()', () => {
  it('detects JPEG from its magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(detectImageType(buf)).toBe('jpeg');
  });

  it('detects PNG from its magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(detectImageType(buf)).toBe('png');
  });

  it('detects WEBP from its RIFF/WEBP header', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP', 'ascii'),
    ]);
    expect(detectImageType(buf)).toBe('webp');
  });

  it('detects GIF87a', () => {
    expect(detectImageType(Buffer.from('GIF87a' + 'xx', 'ascii'))).toBe('gif');
  });

  it('detects GIF89a', () => {
    expect(detectImageType(Buffer.from('GIF89a' + 'xx', 'ascii'))).toBe('gif');
  });

  it('returns null for unrecognized content', () => {
    expect(detectImageType(Buffer.from('just some plain text'))).toBeNull();
  });

  it('returns null for SVG content (explicitly not treated as an image type)', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf-8');
    expect(detectImageType(svg)).toBeNull();
  });

  it('returns null for an empty or too-short buffer', () => {
    expect(detectImageType(Buffer.from([]))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('extensionForImageType()', () => {
  it('maps each detected type to its file extension', () => {
    expect(extensionForImageType('jpeg')).toBe('jpg');
    expect(extensionForImageType('png')).toBe('png');
    expect(extensionForImageType('webp')).toBe('webp');
    expect(extensionForImageType('gif')).toBe('gif');
  });
});
