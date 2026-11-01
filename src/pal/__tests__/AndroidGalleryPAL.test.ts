/**
 * Unit tests for the Android Gallery PAL implementation.
 *
 * Covers the Photo Picker / MediaStore path including:
 *  - Runtime permission flow (API 33+ READ_MEDIA_IMAGES, legacy READ_EXTERNAL_STORAGE)
 *  - Successful image selection (JPG, PNG, HEIC)
 *  - Format rejection with clear error messages
 *  - Size rejection (> 15 MB) with clear error messages
 *  - Cancellation, error handling, Settings deep-link
 */

import { AndroidGalleryPAL } from '../gallery/AndroidGalleryPAL';
import { MAX_IMAGE_SIZE_BYTES } from '../gallery/types';
import { launchImageLibrary } from 'react-native-image-picker';
import { Linking, PermissionsAndroid } from 'react-native';

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
    uri: 'content://media/external/images/media/42',
    fileName: 'damage.jpg',
    type: 'image/jpeg',
    fileSize: 2 * 1024 * 1024, // 2 MB
    width: 3024,
    height: 4032,
    ...overrides,
  };
}

function makePickerResponse(
  assets: ReturnType<typeof makeAsset>[],
  didCancel = false,
) {
  return {
    didCancel,
    assets: didCancel ? undefined : assets,
    errorCode: undefined,
    errorMessage: undefined,
  } as unknown as Awaited<ReturnType<typeof launchImageLibrary>>;
}

// Permission results shorthand
const GRANTED = PermissionsAndroid.RESULTS.GRANTED;
const DENIED = PermissionsAndroid.RESULTS.DENIED;
const NEVER_ASK = PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;

// ---------------------------------------------------------------------------
// requestPermission
// ---------------------------------------------------------------------------

describe('AndroidGalleryPAL – requestPermission', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns granted:true when OS grants READ_MEDIA_IMAGES', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    const result = await pal.requestPermission();
    expect(result.granted).toBe(true);
  });

  it('returns granted:false with canAskAgain:true when OS denies', async () => {
    const pal = new AndroidGalleryPAL(async () => DENIED);
    const result = await pal.requestPermission();
    expect(result.granted).toBe(false);
    if (!result.granted) {
      expect(result.canAskAgain).toBe(true);
      expect(result.message).toBeTruthy();
    }
  });

  it('returns granted:false with canAskAgain:false when NEVER_ASK_AGAIN', async () => {
    const pal = new AndroidGalleryPAL(async () => NEVER_ASK);
    const result = await pal.requestPermission();
    expect(result.granted).toBe(false);
    if (!result.granted) {
      expect(result.canAskAgain).toBe(false);
      // Message must mention Einstellungen (Settings) so user knows where to go
      expect(result.message).toContain('Einstellungen');
    }
  });

  it('returns granted:false when permission requester throws', async () => {
    const pal = new AndroidGalleryPAL(async () => { throw new Error('Bridge error'); });
    const result = await pal.requestPermission();
    expect(result.granted).toBe(false);
  });

  it('passes the permission string to the underlying requester', async () => {
    const mockRequester = jest.fn().mockResolvedValue(GRANTED);
    const pal = new AndroidGalleryPAL(mockRequester);
    await pal.requestPermission();
    expect(mockRequester).toHaveBeenCalledTimes(1);
    const calledWith: string = mockRequester.mock.calls[0][0];
    // Should be either READ_MEDIA_IMAGES or READ_EXTERNAL_STORAGE
    expect([
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
    ]).toContain(calledWith);
  });
});

// ---------------------------------------------------------------------------
// openPicker – success paths (Photo Picker / MediaStore)
// ---------------------------------------------------------------------------

describe('AndroidGalleryPAL – openPicker (Photo Picker / MediaStore path)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenSettings.mockResolvedValue(undefined);
  });

  it('opens Android Photo Picker and returns selected JPG image', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce(makePickerResponse([makeAsset()]));

    const result = await pal.openPicker(5);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.images).toHaveLength(1);
      expect(result.images[0].mimeType).toBe('image/jpeg');
      expect(result.images[0].uri).toContain('content://');
    }
  });

  it('opens Android Photo Picker and returns selected PNG image', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([makeAsset({ fileName: 'screenshot.png', type: 'image/png' })])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.images[0].mimeType).toBe('image/png');
    }
  });

  it('opens Android Photo Picker and returns selected HEIC image', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([makeAsset({ fileName: 'photo.heic', type: 'image/heic' })])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.images[0].mimeType).toBe('image/heic');
    }
  });

  it('handles multiple valid images', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([
        makeAsset({ uri: 'content://img/1', fileName: 'img1.jpg' }),
        makeAsset({ uri: 'content://img/2', fileName: 'img2.png', type: 'image/png' }),
      ])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.images).toHaveLength(2);
    }
  });

  it('returns cancelled when user dismisses the picker', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce(makePickerResponse([], true));

    const result = await pal.openPicker(5);
    expect(result.status).toBe('cancelled');
  });

  it('passes correct selectionLimit to launchImageLibrary', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce(makePickerResponse([makeAsset()]));

    await pal.openPicker(4);
    expect(mockLaunchImageLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ selectionLimit: 4 })
    );
  });
});

// ---------------------------------------------------------------------------
// openPicker – permission denied paths
// ---------------------------------------------------------------------------

describe('AndroidGalleryPAL – openPicker – permission denied', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenSettings.mockResolvedValue(undefined);
  });

  it('returns permission_denied when OS denies (canAskAgain)', async () => {
    const pal = new AndroidGalleryPAL(async () => DENIED);

    const result = await pal.openPicker(5);
    expect(result.status).toBe('permission_denied');
    // canAskAgain=true → must NOT open settings
    expect(mockOpenSettings).not.toHaveBeenCalled();
  });

  it('returns permission_denied and opens Settings when NEVER_ASK_AGAIN', async () => {
    const pal = new AndroidGalleryPAL(async () => NEVER_ASK);

    const result = await pal.openPicker(5);
    expect(result.status).toBe('permission_denied');
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    if (result.status === 'permission_denied') {
      expect(result.message).toContain('Einstellungen');
    }
  });
});

// ---------------------------------------------------------------------------
// openPicker – format and size validation
// ---------------------------------------------------------------------------

describe('AndroidGalleryPAL – openPicker – format & size validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects unsupported format (PDF) with clear error message', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([makeAsset({ fileName: 'receipt.pdf', type: 'application/pdf' })])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('JPG');
      expect(result.message).toContain('PNG');
      expect(result.message).toContain('HEIC');
    }
  });

  it('rejects unsupported format (GIF)', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([makeAsset({ fileName: 'anim.gif', type: 'image/gif' })])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('error');
  });

  it('rejects image over 15 MB with clear error message', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
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
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([makeAsset({ fileSize: MAX_IMAGE_SIZE_BYTES })])
    );

    const result = await pal.openPicker(5);
    expect(result.status).toBe('success');
  });

  it('accepts valid images even when some in the batch are invalid (mixed batch)', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce(
      makePickerResponse([
        makeAsset({ uri: 'content://img/valid.jpg', fileName: 'valid.jpg', type: 'image/jpeg' }),
        makeAsset({ uri: 'content://img/bad.gif', fileName: 'bad.gif', type: 'image/gif' }),
      ])
    );

    const result = await pal.openPicker(5);
    // At least one valid → success with partial results
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.images).toHaveLength(1);
      expect(result.images[0].fileName).toBe('valid.jpg');
    }
  });
});

// ---------------------------------------------------------------------------
// openPicker – error handling
// ---------------------------------------------------------------------------

describe('AndroidGalleryPAL – openPicker – error handling', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns error when launchImageLibrary throws', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockRejectedValueOnce(new Error('Bridge crash'));

    const result = await pal.openPicker(5);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('Bridge crash');
    }
  });

  it('returns error when picker responds with an errorCode', async () => {
    const pal = new AndroidGalleryPAL(async () => GRANTED);
    mockLaunchImageLibrary.mockResolvedValueOnce({
      didCancel: false,
      errorCode: 'camera_unavailable',
      errorMessage: 'Camera not available',
    } as unknown as Awaited<ReturnType<typeof launchImageLibrary>>);

    const result = await pal.openPicker(5);
    expect(result.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// validateImage (direct delegation to shared validation)
// ---------------------------------------------------------------------------

describe('AndroidGalleryPAL – validateImage', () => {
  const pal = new AndroidGalleryPAL();

  it('accepts JPG', () => {
    expect(pal.validateImage({ fileName: 'p.jpg', mimeType: 'image/jpeg', fileSizeBytes: 1000 }).valid).toBe(true);
  });

  it('accepts PNG', () => {
    expect(pal.validateImage({ fileName: 'p.png', mimeType: 'image/png', fileSizeBytes: 1000 }).valid).toBe(true);
  });

  it('accepts HEIC', () => {
    expect(pal.validateImage({ fileName: 'p.heic', mimeType: 'image/heic', fileSizeBytes: 1000 }).valid).toBe(true);
  });

  it('rejects unsupported format', () => {
    const result = pal.validateImage({ fileName: 'doc.pdf', mimeType: 'application/pdf', fileSizeBytes: 1000 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('unsupported_format');
  });

  it('rejects oversized file', () => {
    const result = pal.validateImage({ fileName: 'big.jpg', mimeType: 'image/jpeg', fileSizeBytes: MAX_IMAGE_SIZE_BYTES + 1 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('file_too_large');
  });
});
