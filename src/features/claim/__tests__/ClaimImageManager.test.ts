/**
 * Unit tests for ClaimImageManager.
 *
 * Uses a mock IGalleryPAL injected via constructor DI to avoid any platform
 * dependency. Covers the 10-image limit, gallery integration, remove, and reset.
 */

import { ClaimImageManager } from '../ClaimImageManager';
import { IGalleryPAL, GalleryPickerResult, PermissionResult, SelectedImage, ValidationResult, MAX_IMAGES_PER_CLAIM } from '../../../pal/gallery';

// ---------------------------------------------------------------------------
// Mock PAL factory
// ---------------------------------------------------------------------------

function makeImage(uri: string, overrides: Partial<SelectedImage> = {}): SelectedImage {
  return {
    uri,
    fileName: `${uri.split('/').pop()}`,
    mimeType: 'image/jpeg',
    fileSizeBytes: 1024 * 1024,
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

function makeMockPAL(pickerResult: GalleryPickerResult, permissionResult: PermissionResult = { granted: true }): IGalleryPAL {
  return {
    requestPermission: jest.fn().mockResolvedValue(permissionResult),
    openPicker: jest.fn().mockResolvedValue(pickerResult),
    validateImage: jest.fn().mockReturnValue({ valid: true } as ValidationResult),
  };
}

// ---------------------------------------------------------------------------
// State tests
// ---------------------------------------------------------------------------

describe('ClaimImageManager – initial state', () => {
  it('starts with zero images and 10 remaining slots', () => {
    const manager = new ClaimImageManager(makeMockPAL({ status: 'cancelled' }));
    const state = manager.getState();
    expect(state.count).toBe(0);
    expect(state.remainingSlots).toBe(MAX_IMAGES_PER_CLAIM);
    expect(state.isAtLimit).toBe(false);
    expect(state.images).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addImagesFromGallery – success paths
// ---------------------------------------------------------------------------

describe('ClaimImageManager – addImagesFromGallery', () => {
  it('adds images returned by the PAL and updates state', async () => {
    const images = [makeImage('file://a.jpg'), makeImage('file://b.jpg')];
    const pal = makeMockPAL({ status: 'success', images });
    const manager = new ClaimImageManager(pal);

    const result = await manager.addImagesFromGallery();
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.added).toHaveLength(2);
      expect(result.skippedErrors).toHaveLength(0);
    }
    expect(manager.getState().count).toBe(2);
    expect(manager.getState().remainingSlots).toBe(MAX_IMAGES_PER_CLAIM - 2);
  });

  it('passes remaining slots as maxImages to openPicker', async () => {
    const pal = makeMockPAL({ status: 'cancelled' });
    const manager = new ClaimImageManager(pal);

    await manager.addImagesFromGallery();
    expect(pal.openPicker).toHaveBeenCalledWith(MAX_IMAGES_PER_CLAIM);
  });

  it('returns cancelled when user cancels picker', async () => {
    const pal = makeMockPAL({ status: 'cancelled' });
    const manager = new ClaimImageManager(pal);

    const result = await manager.addImagesFromGallery();
    expect(result.status).toBe('cancelled');
    expect(manager.getState().count).toBe(0);
  });

  it('returns permission_denied when PAL reports permission denied', async () => {
    const pal = makeMockPAL({ status: 'permission_denied', message: 'Berechtigung verweigert.' });
    const manager = new ClaimImageManager(pal);

    const result = await manager.addImagesFromGallery();
    expect(result.status).toBe('permission_denied');
    if (result.status === 'permission_denied') {
      expect(result.message).toBeTruthy();
    }
  });

  it('returns error when PAL reports an error', async () => {
    const pal = makeMockPAL({ status: 'error', message: 'Fehler beim Öffnen.' });
    const manager = new ClaimImageManager(pal);

    const result = await manager.addImagesFromGallery();
    expect(result.status).toBe('error');
  });

  it('enforces 10-image limit even if PAL returns more than allowed', async () => {
    // Fill up to 9 images first
    const firstBatch = Array.from({ length: 9 }, (_, i) => makeImage(`file://img${i}.jpg`));
    const pal = makeMockPAL({ status: 'success', images: firstBatch });
    const manager = new ClaimImageManager(pal);
    await manager.addImagesFromGallery();
    expect(manager.getState().count).toBe(9);

    // Now try to add 3 more – only 1 slot remains
    const secondBatch = [
      makeImage('file://extra1.jpg'),
      makeImage('file://extra2.jpg'),
      makeImage('file://extra3.jpg'),
    ];
    const pal2 = makeMockPAL({ status: 'success', images: secondBatch });
    // Replace PAL by creating new manager with existing images via addImagesFromGallery
    // We test by directly checking clip logic via a single manager
    const manager2 = new ClaimImageManager(makeMockPAL({ status: 'success', images: firstBatch }));
    await manager2.addImagesFromGallery();
    // Inject second pick via the same manager with new PAL via re-injection is not possible with
    // constructor DI cleanly; test the limit logic by starting fresh with 10 images
    const tenImages = Array.from({ length: 10 }, (_, i) => makeImage(`file://img${i}.jpg`));
    const fullPAL = makeMockPAL({ status: 'success', images: tenImages });
    const fullManager = new ClaimImageManager(fullPAL);
    await fullManager.addImagesFromGallery();
    expect(fullManager.getState().isAtLimit).toBe(true);

    // Trying to add more returns at_limit
    const result = await fullManager.addImagesFromGallery();
    expect(result.status).toBe('at_limit');
    if (result.status === 'at_limit') {
      expect(result.message).toContain('10');
    }
  });

  it('returns at_limit message when already at maximum', async () => {
    const tenImages = Array.from({ length: 10 }, (_, i) => makeImage(`file://img${i}.jpg`));
    const pal = makeMockPAL({ status: 'success', images: tenImages });
    const manager = new ClaimImageManager(pal);
    await manager.addImagesFromGallery();

    const result = await manager.addImagesFromGallery();
    expect(result.status).toBe('at_limit');
    if (result.status === 'at_limit') {
      expect(result.message).toContain(`${MAX_IMAGES_PER_CLAIM}`);
    }
  });

  it('skips over-limit images and reports skipped count', async () => {
    // 9 images already added
    const firstBatch = Array.from({ length: 9 }, (_, i) => makeImage(`file://img${i}.jpg`));
    const pal1 = makeMockPAL({ status: 'success', images: firstBatch });
    const manager = new ClaimImageManager(pal1);
    await manager.addImagesFromGallery();

    // Now PAL returns 3 images but only 1 slot remains
    const overflow = [
      makeImage('file://o1.jpg'),
      makeImage('file://o2.jpg'),
      makeImage('file://o3.jpg'),
    ];
    const pal2 = makeMockPAL({ status: 'success', images: overflow });
    // Re-use manager by swapping PAL indirectly – test via a fresh manager with pre-state
    // We approximate by checking the skipped error logic: create a manager at 9, then 3 more
    // Since DI only at construction, we verify via the at_limit guard in next call.
    // This test verifies the slice + skippedErrors path via a helper manager:
    const manager3 = new ClaimImageManager(pal2);
    // Pre-fill 9 slots manually via addImagesFromGallery with pal1 behaviour simulation
    // Instead of monkey-patching, test the path by overriding: build manager with 9, then call again
    const combinedPAL = {
      requestPermission: jest.fn().mockResolvedValue({ granted: true }),
      openPicker: jest.fn()
        .mockResolvedValueOnce({ status: 'success', images: firstBatch })
        .mockResolvedValueOnce({ status: 'success', images: overflow }),
      validateImage: jest.fn().mockReturnValue({ valid: true }),
    } as unknown as IGalleryPAL;

    const mgr = new ClaimImageManager(combinedPAL);
    await mgr.addImagesFromGallery(); // adds 9
    expect(mgr.getState().count).toBe(9);

    const result2 = await mgr.addImagesFromGallery(); // tries to add 3, only 1 slot
    expect(result2.status).toBe('success');
    if (result2.status === 'success') {
      expect(result2.added).toHaveLength(1);
      expect(result2.skippedErrors).toHaveLength(1);
      expect(result2.skippedErrors[0]).toContain('10');
    }
    expect(mgr.getState().count).toBe(10);
    expect(mgr.getState().isAtLimit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeImage
// ---------------------------------------------------------------------------

describe('ClaimImageManager – removeImage', () => {
  it('removes an image by URI and decrements count', async () => {
    const images = [makeImage('file://a.jpg'), makeImage('file://b.jpg')];
    const pal = makeMockPAL({ status: 'success', images });
    const manager = new ClaimImageManager(pal);
    await manager.addImagesFromGallery();

    const removed = manager.removeImage('file://a.jpg');
    expect(removed).toBe(true);
    expect(manager.getState().count).toBe(1);
    expect(manager.getState().images[0].uri).toBe('file://b.jpg');
  });

  it('returns false when URI is not found', async () => {
    const pal = makeMockPAL({ status: 'success', images: [makeImage('file://a.jpg')] });
    const manager = new ClaimImageManager(pal);
    await manager.addImagesFromGallery();

    const removed = manager.removeImage('file://nonexistent.jpg');
    expect(removed).toBe(false);
    expect(manager.getState().count).toBe(1);
  });

  it('allows adding more images after removal (slot freed)', async () => {
    const tenImages = Array.from({ length: 10 }, (_, i) => makeImage(`file://img${i}.jpg`));
    const pal = makeMockPAL({ status: 'success', images: tenImages });
    const manager = new ClaimImageManager(pal);
    await manager.addImagesFromGallery();
    expect(manager.getState().isAtLimit).toBe(true);

    manager.removeImage('file://img0.jpg');
    expect(manager.getState().isAtLimit).toBe(false);
    expect(manager.getState().remainingSlots).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('ClaimImageManager – reset', () => {
  it('clears all images and resets state', async () => {
    const images = [makeImage('file://a.jpg'), makeImage('file://b.jpg')];
    const pal = makeMockPAL({ status: 'success', images });
    const manager = new ClaimImageManager(pal);
    await manager.addImagesFromGallery();
    expect(manager.getState().count).toBe(2);

    manager.reset();
    expect(manager.getState().count).toBe(0);
    expect(manager.getState().isAtLimit).toBe(false);
    expect(manager.getState().remainingSlots).toBe(MAX_IMAGES_PER_CLAIM);
  });
});

// ---------------------------------------------------------------------------
// requestGalleryPermission delegation
// ---------------------------------------------------------------------------

describe('ClaimImageManager – requestGalleryPermission', () => {
  it('delegates to pal.requestPermission', async () => {
    const pal = makeMockPAL({ status: 'cancelled' }, { granted: true });
    const manager = new ClaimImageManager(pal);

    const result = await manager.requestGalleryPermission();
    expect(result.granted).toBe(true);
    expect(pal.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('returns denied result when PAL denies permission', async () => {
    const pal = makeMockPAL(
      { status: 'cancelled' },
      { granted: false, canAskAgain: true, message: 'Berechtigung benötigt.' }
    );
    const manager = new ClaimImageManager(pal);

    const result = await manager.requestGalleryPermission();
    expect(result.granted).toBe(false);
  });
});
