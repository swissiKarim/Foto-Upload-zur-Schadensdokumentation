/**
 * Unit tests for shared gallery image validation logic.
 */

import { validateImage, getExtension } from '../gallery/validation';
import { MAX_IMAGE_SIZE_BYTES } from '../gallery/types';

describe('getExtension', () => {
  it('returns lower-cased extension for standard filenames', () => {
    expect(getExtension('photo.jpg')).toBe('jpg');
    expect(getExtension('PHOTO.JPG')).toBe('jpg');
    expect(getExtension('damage.PNG')).toBe('png');
    expect(getExtension('car.HEIC')).toBe('heic');
  });

  it('returns empty string when there is no extension', () => {
    expect(getExtension('photonoext')).toBe('');
    expect(getExtension('')).toBe('');
  });

  it('handles multiple dots correctly (returns last segment)', () => {
    expect(getExtension('my.damage.photo.jpg')).toBe('jpg');
  });
});

describe('validateImage – format validation', () => {
  const baseSize = 1024 * 1024; // 1 MB – safely under limit

  it('accepts image/jpeg MIME type', () => {
    const result = validateImage({ fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSizeBytes: baseSize });
    expect(result.valid).toBe(true);
  });

  it('accepts image/png MIME type', () => {
    const result = validateImage({ fileName: 'photo.png', mimeType: 'image/png', fileSizeBytes: baseSize });
    expect(result.valid).toBe(true);
  });

  it('accepts image/heic MIME type', () => {
    const result = validateImage({ fileName: 'photo.heic', mimeType: 'image/heic', fileSizeBytes: baseSize });
    expect(result.valid).toBe(true);
  });

  it('accepts image/heif MIME type', () => {
    const result = validateImage({ fileName: 'photo.heif', mimeType: 'image/heif', fileSizeBytes: baseSize });
    expect(result.valid).toBe(true);
  });

  it('accepts jpg by extension when MIME type is empty', () => {
    const result = validateImage({ fileName: 'photo.jpg', mimeType: '', fileSizeBytes: baseSize });
    expect(result.valid).toBe(true);
  });

  it('accepts png by extension when MIME type is empty', () => {
    const result = validateImage({ fileName: 'photo.png', mimeType: '', fileSizeBytes: baseSize });
    expect(result.valid).toBe(true);
  });

  it('accepts heic by extension when MIME type is empty', () => {
    const result = validateImage({ fileName: 'photo.heic', mimeType: '', fileSizeBytes: baseSize });
    expect(result.valid).toBe(true);
  });

  it('rejects unsupported format (PDF) with clear error message', () => {
    const result = validateImage({ fileName: 'document.pdf', mimeType: 'application/pdf', fileSizeBytes: baseSize });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('unsupported_format');
      expect(result.message).toContain('JPG');
      expect(result.message).toContain('PNG');
      expect(result.message).toContain('HEIC');
    }
  });

  it('rejects unsupported format (GIF) with clear error message', () => {
    const result = validateImage({ fileName: 'anim.gif', mimeType: 'image/gif', fileSizeBytes: baseSize });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('unsupported_format');
    }
  });

  it('rejects unsupported format (BMP) with clear error message', () => {
    const result = validateImage({ fileName: 'image.bmp', mimeType: 'image/bmp', fileSizeBytes: baseSize });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('unsupported_format');
    }
  });

  it('rejects unsupported format (TIFF) with clear error message', () => {
    const result = validateImage({ fileName: 'scan.tiff', mimeType: 'image/tiff', fileSizeBytes: baseSize });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('unsupported_format');
    }
  });

  it('is case-insensitive for MIME type', () => {
    const result = validateImage({ fileName: 'photo.jpg', mimeType: 'IMAGE/JPEG', fileSizeBytes: baseSize });
    expect(result.valid).toBe(true);
  });
});

describe('validateImage – size validation', () => {
  const validMime = 'image/jpeg';
  const validName = 'photo.jpg';

  it('accepts image exactly at 15 MB limit', () => {
    const result = validateImage({ fileName: validName, mimeType: validMime, fileSizeBytes: MAX_IMAGE_SIZE_BYTES });
    expect(result.valid).toBe(true);
  });

  it('rejects image 1 byte over 15 MB', () => {
    const result = validateImage({ fileName: validName, mimeType: validMime, fileSizeBytes: MAX_IMAGE_SIZE_BYTES + 1 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('file_too_large');
      expect(result.message).toContain('15 MB');
    }
  });

  it('rejects a 20 MB image and mentions the actual size', () => {
    const twentyMB = 20 * 1024 * 1024;
    const result = validateImage({ fileName: validName, mimeType: validMime, fileSizeBytes: twentyMB });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('file_too_large');
      expect(result.message).toContain('20.0');
    }
  });

  it('accepts a small 500 KB image', () => {
    const result = validateImage({ fileName: validName, mimeType: validMime, fileSizeBytes: 500 * 1024 });
    expect(result.valid).toBe(true);
  });
});
