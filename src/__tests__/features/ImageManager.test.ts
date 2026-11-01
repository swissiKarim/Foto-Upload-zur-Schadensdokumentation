/**
 * Unit tests for ImageManager
 *
 * Acceptance criteria covered:
 *   - Max 10 images per damage report
 *   - Counter display (count / counterDisplay)
 *   - Supported formats: JPG, PNG, HEIC
 *   - Max file size 15 MB
 *   - Remove individual images
 *   - Thumbnail immediately visible after add
 */

import { ImageManager, MAX_IMAGES, MAX_FILE_SIZE_BYTES } from '../../features/damageReport/ImageManager';
import { CaptureResult } from '../../pal/camera/CameraTypes';

function makeCapture(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    encryptedStagingPath: '/app/private/documents/damage_staging/capture_123.enc',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    originalSizeBytes: 1_000_000, // 1 MB
    format: 'jpg',
    capturedAt: new Date(),
    ...overrides,
  };
}

describe('ImageManager', () => {
  let manager: ImageManager;

  beforeEach(() => {
    manager = new ImageManager();
  });

  // ── initial state ───────────────────────────────────────────────────────
  it('starts with count 0', () => {
    expect(manager.count).toBe(0);
  });

  it('starts with canAddMore = true', () => {
    expect(manager.canAddMore).toBe(true);
  });

  it('counterDisplay shows "0 / 10" initially', () => {
    expect(manager.counterDisplay).toBe('0 / 10');
  });

  // ── add – happy path ────────────────────────────────────────────────────
  it('adds a JPG capture and increments count', () => {
    manager.add(makeCapture({ format: 'jpg' }));
    expect(manager.count).toBe(1);
    expect(manager.counterDisplay).toBe('1 / 10');
  });

  it('adds a PNG capture', () => {
    manager.add(makeCapture({ format: 'png' }));
    expect(manager.count).toBe(1);
  });

  it('adds a HEIC capture', () => {
    manager.add(makeCapture({ format: 'heic' }));
    expect(manager.count).toBe(1);
  });

  it('returns a ManagedImage with thumbnailPath after add', () => {
    const capture = makeCapture();
    const managed = manager.add(capture);
    expect(managed.thumbnailPath).toBe(capture.encryptedStagingPath);
    expect(managed.id).toBeDefined();
    expect(managed.addedAt).toBeInstanceOf(Date);
  });

  it('image is immediately visible in all() after add', () => {
    const capture = makeCapture();
    const managed = manager.add(capture);
    expect(manager.all).toContain(managed);
  });

  // ── add – max limit ─────────────────────────────────────────────────────
  it(`allows up to ${MAX_IMAGES} images`, () => {
    for (let i = 0; i < MAX_IMAGES; i++) {
      manager.add(makeCapture({ fileName: `photo_${i}.jpg` }));
    }
    expect(manager.count).toBe(MAX_IMAGES);
    expect(manager.canAddMore).toBe(false);
    expect(manager.counterDisplay).toBe(`${MAX_IMAGES} / ${MAX_IMAGES}`);
  });

  it(`throws when trying to add more than ${MAX_IMAGES} images`, () => {
    for (let i = 0; i < MAX_IMAGES; i++) {
      manager.add(makeCapture());
    }
    expect(() => manager.add(makeCapture())).toThrow(/maximale anzahl/i);
  });

  // ── add – format validation ──────────────────────────────────────────────
  it('throws for unsupported format', () => {
    expect(() =>
      manager.add(makeCapture({ format: 'bmp' as 'jpg' })),
    ).toThrow(/format/i);
  });

  // ── add – file size validation ───────────────────────────────────────────
  it('throws when file exceeds 15 MB', () => {
    expect(() =>
      manager.add(makeCapture({ originalSizeBytes: MAX_FILE_SIZE_BYTES + 1 })),
    ).toThrow(/zu groß/i);
  });

  it('accepts a file exactly at the 15 MB limit', () => {
    expect(() =>
      manager.add(makeCapture({ originalSizeBytes: MAX_FILE_SIZE_BYTES })),
    ).not.toThrow();
  });

  // ── remove ──────────────────────────────────────────────────────────────
  it('removes an image by id and decrements count', () => {
    const managed = manager.add(makeCapture());
    const removed = manager.remove(managed.id);
    expect(removed).toBe(true);
    expect(manager.count).toBe(0);
    expect(manager.all).not.toContain(managed);
  });

  it('returns false when removing a non-existent id', () => {
    expect(manager.remove('nonexistent-id')).toBe(false);
  });

  it('can add more after removing an image when at max', () => {
    for (let i = 0; i < MAX_IMAGES; i++) {
      manager.add(makeCapture());
    }
    const first = manager.all[0];
    manager.remove(first.id);
    expect(manager.canAddMore).toBe(true);
  });

  // ── clear ────────────────────────────────────────────────────────────────
  it('clear() resets count to 0', () => {
    manager.add(makeCapture());
    manager.add(makeCapture());
    manager.clear();
    expect(manager.count).toBe(0);
    expect(manager.all.length).toBe(0);
  });

  // ── counterDisplay accuracy ──────────────────────────────────────────────
  it('counterDisplay updates correctly after adds and removes', () => {
    const a = manager.add(makeCapture());
    manager.add(makeCapture());
    expect(manager.counterDisplay).toBe('2 / 10');
    manager.remove(a.id);
    expect(manager.counterDisplay).toBe('1 / 10');
  });
});
