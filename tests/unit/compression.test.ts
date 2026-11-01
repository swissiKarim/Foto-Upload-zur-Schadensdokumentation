/**
 * Unit tests – Image Compression
 *
 * AC: "Vor dem Upload komprimiert die App jedes Bild automatisch, asynchron
 *      im Hintergrund-Thread, ohne Nutzerinteraktion."
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  compressImage,
  validateFormat,
  validateSize,
} from '../../src/compression/imageCompressor';

/** Creates a minimal valid JPEG buffer using sharp */
async function makeJpegBuffer(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Creates a minimal valid PNG buffer */
async function makePngBuffer(width = 100, height = 100): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe('validateFormat', () => {
  it('accepts .jpg', () => expect(() => validateFormat('damage.jpg')).not.toThrow());
  it('accepts .jpeg', () => expect(() => validateFormat('damage.jpeg')).not.toThrow());
  it('accepts .png', () => expect(() => validateFormat('scan.PNG')).not.toThrow());
  it('accepts .heic', () => expect(() => validateFormat('photo.heic')).not.toThrow());
  it('rejects .gif', () =>
    expect(() => validateFormat('anim.gif')).toThrow(/Unsupported file format/));
  it('rejects .bmp', () =>
    expect(() => validateFormat('img.bmp')).toThrow(/Unsupported file format/));
  it('rejects .pdf', () =>
    expect(() => validateFormat('doc.pdf')).toThrow(/Unsupported file format/));
});

describe('validateSize', () => {
  it('accepts buffer ≤ 15 MB', () => {
    const buf = Buffer.alloc(14 * 1024 * 1024);
    expect(() => validateSize(buf)).not.toThrow();
  });
  it('rejects buffer > 15 MB', () => {
    const buf = Buffer.alloc(16 * 1024 * 1024);
    expect(() => validateSize(buf)).toThrow(/15 MB/);
  });
  it('accepts exactly 15 MB', () => {
    const buf = Buffer.alloc(15 * 1024 * 1024);
    expect(() => validateSize(buf)).not.toThrow();
  });
});

describe('compressImage', () => {
  it('compresses a JPEG asynchronously and returns a smaller buffer', async () => {
    const input = await makeJpegBuffer(1920, 1080);
    const result = await compressImage(input, 'photo.jpg', { jpegQuality: 60 });

    expect(result.data).toBeInstanceOf(Buffer);
    expect(result.compressedSize).toBeLessThan(result.originalSize);
    expect(result.compressionRatio).toBeLessThan(1);
    expect(result.format).toBe('jpeg');
  });

  it('compresses a PNG and outputs JPEG', async () => {
    const input = await makePngBuffer(500, 500);
    const result = await compressImage(input, 'img.png');

    expect(result.format).toBe('jpeg');
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('resizes images wider than maxDimension', async () => {
    const input = await makeJpegBuffer(4000, 3000);
    const result = await compressImage(input, 'large.jpg', { maxDimension: 1024 });

    const meta = await sharp(result.data).metadata();
    expect(meta.width).toBeLessThanOrEqual(1024);
    expect(meta.height).toBeLessThanOrEqual(1024);
  });

  it('does not enlarge images smaller than maxDimension', async () => {
    const input = await makeJpegBuffer(200, 150);
    const result = await compressImage(input, 'small.jpg', { maxDimension: 2048 });

    const meta = await sharp(result.data).metadata();
    expect(meta.width).toBeLessThanOrEqual(200);
    expect(meta.height).toBeLessThanOrEqual(150);
  });

  it('rejects unsupported format', async () => {
    const buf = Buffer.from('fake');
    await expect(compressImage(buf, 'file.gif')).rejects.toThrow(/Unsupported file format/);
  });

  it('rejects images over 15 MB', async () => {
    const buf = Buffer.alloc(16 * 1024 * 1024);
    await expect(compressImage(buf, 'huge.jpg')).rejects.toThrow(/15 MB/);
  });

  it('is async (returns a Promise)', async () => {
    const input = await makeJpegBuffer(100, 100);
    const promise = compressImage(input, 'test.jpg');
    expect(promise).toBeInstanceOf(Promise);
    await promise;
  });
});
