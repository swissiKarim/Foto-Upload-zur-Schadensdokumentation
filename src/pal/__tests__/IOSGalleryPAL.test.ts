/**
 * Unit tests for the iOS Gallery PAL implementation.
 *
 * PHPickerViewController behaviour is simulated through the
 * react-native-image-picker mock and an injected permission checker.
 */

import { IOSGalleryPAL } from '../gallery/IOSGalleryPAL';
import { MAX_IMAGE_SIZE_BYTES } from '../gallery/types';
import { launchImageLibrary } from 'react-native-image-picker';
import { Linking } from 'react-native';

const mockLaunchImageLibrary = launchImageLibrary as jest.MockedFunction<typeof launchImageLibrary>;
const mockOpenSettings = Linking.openSettings as jest.MockedFunction<typeof Linking.openSettings>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAsset(overrides: Partial<{
  uri: string;
  fileName: string;
  type: string;
  fileSize: number;
  width: number;
  height: number;
}> = {}) {
  return {
    uri: 'file://photo.jpg',
    fileName: 'photo.jpg',
    type: 'image/jpeg',
    fileSize: 1024 * 1024, // 1 MB
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

function makePickerResponse(assets: ReturnType<typeof makeAsset>[], didCancel = false) {
  return {
    didCancel,
    assets: didCancel ? undefined : assets,
    errorCode: undefined,
    errorMessage: undefined,
  } as unknown as Awaited<ReturnType<typeof launchImageLibrary>>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IOSGalleryPAL – requestPermission', () => {
  it('returns granted:true when checker returns "granted"', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    const result = await pal.requestPermission();
    expect(result.granted).toBe(true);
  });

  it('returns granted:true when checker returns "limited" (iOS partial access)', async () => {
    const pal = new IOSGalleryPAL(async () => 'limited');
    const result = await pal.requestPermission();
    expect(result.granted).toBe(true);
  });

  it('returns granted:false with canAskAgain:false when checker returns "blocked"', async () => {
    const pal = new IOSGalleryPAL(async () => 'blocked');
    const result = await pal.requestPermission();
    expect(result.granted).toBe(false);
    if (!result.granted) {
      expect(result.canAskAgain).toBe(false);
      expect(result.message).toContain('Einstellungen');
    }
  });

  it('returns granted:false with canAskAgain:true when checker returns "denied"', async () => {
    const pal = new IOSGalleryPAL(async () => 'denied');
    const result = await pal.requestPermission();
    expect(result.granted).toBe(false);
    if (!result.granted) {
      expect(result.canAskAgain).toBe(true);
    }
  });

  it('returns granted:false when checker returns "unavailable"', async () => {
    const pal = new IOSGalleryPAL(async () => 'unavailable');
    const result = await pal.requestPermission();
    expect(result.granted).toBe(false);
  });
});

describe('IOSGalleryPAL – openPicker (PHPickerViewController path)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenSettings.mockResolvedValue(undefined);
  });

  it('opens PHPickerViewController and returns selected JPG image', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockResolvedValueOnce(makePickerResponse([makeAsset()]));

    const result = await pal.openPicker(5);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.images).toHaveLength(1);
      expect(result.images[0].fileName).toBe('photo.jpg');
      expect(result.images[0].mimeType).toBe('image/jpeg');
    }
  });

  it('opens PHPickerViewController and returns selected PNG image', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([makeAsset({ fileName: 'screenshot.png', type: 'image/png', uri: 'file://screenshot.png' })])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.images[0].mimeType).toBe('image/png');
    }
  });

  it('opens PHPickerViewController and returns selected HEIC image', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([makeAsset({ fileName: 'iphone_photo.heic', type: 'image/heic', uri: 'file://iphone_photo.heic' })])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.images[0].mimeType).toBe('image/heic');
    }
  });

  it('returns cancelled when user dismisses PHPickerViewController', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockResolvedValueOnce(makePickerResponse([], true));

    const result = await pal.openPicker(5);
    expect(result.status).toBe('cancelled');
  });

  it('returns permission_denied and opens Settings when permission is blocked', async () => {
    const pal = new IOSGalleryPAL(async () => 'blocked');

    const result = await pal.openPicker(5);
    expect(result.status).toBe('permission_denied');
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    if (result.status === 'permission_denied') {
      expect(result.message).toContain('Einstellungen');
    }
  });

  it('returns permission_denied (without opening Settings) when permission is denied', async () => {
    const pal = new IOSGalleryPAL(async () => 'denied');

    const result = await pal.openPicker(5);
    expect(result.status).toBe('permission_denied');
    // canAskAgain=true → should NOT open settings
    expect(mockOpenSettings).not.toHaveBeenCalled();
  });

  it('rejects images with unsupported format (GIF) with clear error message', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([makeAsset({ fileName: 'anim.gif', type: 'image/gif' })])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('JPG');
      expect(result.message).toContain('PNG');
      expect(result.message).toContain('HEIC');
    }
  });

  it('rejects images exceeding 15 MB with clear error message', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([makeAsset({ fileSize: MAX_IMAGE_SIZE_BYTES + 1 })])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('15 MB');
    }
  });

  it('accepts image exactly at 15 MB boundary', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([makeAsset({ fileSize: MAX_IMAGE_SIZE_BYTES })])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('success');
  });

  it('returns error when launchImageLibrary throws', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockRejectedValueOnce(new Error('Native bridge failure'));

    const result = await pal.openPicker(5);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('Native bridge failure');
    }
  });

  it('returns error when picker responds with an errorCode', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockResolvedValueOnce({
      didCancel: false,
      errorCode: 'others',
      errorMessage: 'Something went wrong',
    } as unknown as Awaited<ReturnType<typeof launchImageLibrary>>);

    const result = await pal.openPicker(5);
    expect(result.status).toBe('error');
  });

  it('passes correct selectionLimit to launchImageLibrary', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockResolvedValueOnce(makePickerResponse([makeAsset()]));

    await pal.openPicker(3);
    expect(mockLaunchImageLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ selectionLimit: 3 })
    );
  });

  it('handles multiple valid images returned from picker', async () => {
    const pal = new IOSGalleryPAL(async () => 'granted');
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([
        makeAsset({ uri: 'file://a.jpg', fileName: 'a.jpg' }),
        makeAsset({ uri: 'file://b.png', fileName: 'b.png', type: 'image/png' }),
        makeAsset({ uri: 'file://c.heic', fileName: 'c.heic', type: 'image/heic' }),
      ])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.images).toHaveLength(3);
    }
  });
});

describe('IOSGalleryPAL – validateImage', () => {
  const pal = new IOSGalleryPAL();

  it('validates accepted formats correctly', () => {
    expect(pal.validateImage({ fileName: 'p.jpg', mimeType: 'image/jpeg', fileSizeBytes: 1000 }).valid).toBe(true);
    expect(pal.validateImage({ fileName: 'p.png', mimeType: 'image/png', fileSizeBytes: 1000 }).valid).toBe(true);
    expect(pal.validateImage({ fileName: 'p.heic', mimeType: 'image/heic', fileSizeBytes: 1000 }).valid).toBe(true);
  });

  it('rejects unsupported formats', () => {
    const result = pal.validateImage({ fileName: 'doc.pdf', mimeType: 'application/pdf', fileSizeBytes: 1000 });
    expect(result.valid).toBe(false);
  });

  it('rejects oversized files', () => {
    const result = pal.validateImage({ fileName: 'big.jpg', mimeType: 'image/jpeg', fileSizeBytes: MAX_IMAGE_SIZE_BYTES + 1 });
    expect(result.valid).toBe(false);
  });
});
