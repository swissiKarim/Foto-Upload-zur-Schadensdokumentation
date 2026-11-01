/**
 * Unit tests for AndroidCameraAdapter (CameraX / Android PAL branch)
 *
 * Acceptance criteria covered:
 *   - Request camera permission per Android guidelines (CameraX / runtime permission)
 *   - GRANTED / DENIED / NEVER_ASK_AGAIN flows
 *   - Denial returns message + settings URL
 *   - Capture stores result in encrypted staging (not public storage)
 *   - Supported formats: JPG, PNG, HEIC
 *   - platformName === 'CameraX'
 */

import { Platform, PermissionsAndroid } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import Aes from 'react-native-aes-crypto';
import { AndroidCameraAdapter } from '../../pal/camera/AndroidCameraAdapter';

// Force Android platform
(Platform as { OS: string }).OS = 'android';

const mockPermissionsAndroid = PermissionsAndroid as jest.Mocked<typeof PermissionsAndroid>;
const mockLaunchCamera = launchCamera as jest.Mock;
const mockRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockAes = Aes as jest.Mocked<typeof Aes>;

describe('AndroidCameraAdapter – PAL Android branch', () => {
  let adapter: AndroidCameraAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as { OS: string }).OS = 'android';
    adapter = new AndroidCameraAdapter();
  });

  // ── platformName ────────────────────────────────────────────────────────
  it('exposes platformName = CameraX', () => {
    expect(adapter.platformName).toBe('CameraX');
  });

  // ── requestPermission – granted ─────────────────────────────────────────
  it('returns granted when PermissionsAndroid resolves GRANTED', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED as 'granted',
    );

    const result = await adapter.requestPermission();
    expect(result.status).toBe('granted');
  });

  it('requests the CAMERA permission from PermissionsAndroid', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED as 'granted',
    );

    await adapter.requestPermission();

    expect(mockPermissionsAndroid.request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      expect.objectContaining({ title: expect.any(String) }),
    );
  });

  // ── requestPermission – denied ──────────────────────────────────────────
  it('returns denied with denialMessage when user taps Ablehnen', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.DENIED as 'denied',
    );

    const result = await adapter.requestPermission();
    expect(result.status).toBe('denied');
    expect(result.denialMessage).toBeDefined();
    expect(result.denialMessage!.length).toBeGreaterThan(10);
  });

  // ── requestPermission – never_ask_again (blocked) ───────────────────────
  it('returns blocked with denialMessage and settingsUrl for NEVER_ASK_AGAIN', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN as 'never_ask_again',
    );

    const result = await adapter.requestPermission();
    expect(result.status).toBe('blocked');
    expect(result.denialMessage).toBeDefined();
    expect(result.settingsUrl).toBeDefined();
  });

  // ── requestPermission – unavailable on non-Android ──────────────────────
  it('returns unavailable when Platform.OS is not android', async () => {
    (Platform as { OS: string }).OS = 'ios';
    const result = await adapter.requestPermission();
    expect(result.status).toBe('unavailable');
  });

  // ── capturePhoto – happy path (JPG) ────────────────────────────────────
  it('captures a JPG and returns an encrypted staging path', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED as 'granted',
    );
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({
        assets: [{
          uri: 'file:///tmp/android_photo.jpg',
          fileName: 'android_photo.jpg',
          fileSize: 750_000,
        }],
      });
    });

    const result = await adapter.capturePhoto();

    expect(result.format).toBe('jpg');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.encryptedStagingPath).toMatch(/\.enc$/);
    expect(result.originalSizeBytes).toBe(750_000);
  });

  // ── capturePhoto – PNG ──────────────────────────────────────────────────
  it('captures a PNG with correct mime type', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED as 'granted',
    );
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({
        assets: [{ uri: 'file:///tmp/d.png', fileName: 'damage.png', fileSize: 400_000 }],
      });
    });

    const result = await adapter.capturePhoto();
    expect(result.format).toBe('png');
    expect(result.mimeType).toBe('image/png');
  });

  // ── capturePhoto – HEIC ─────────────────────────────────────────────────
  it('captures a HEIC with correct mime type', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED as 'granted',
    );
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({
        assets: [{ uri: 'file:///tmp/d.heic', fileName: 'damage.heic', fileSize: 300_000 }],
      });
    });

    const result = await adapter.capturePhoto();
    expect(result.format).toBe('heic');
    expect(result.mimeType).toBe('image/heic');
  });

  // ── capturePhoto – saveToPhotos must be false ────────────────────────────
  it('always passes saveToPhotos=false to prevent public storage', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED as 'granted',
    );
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ assets: [{ uri: 'file:///tmp/p.jpg', fileName: 'p.jpg', fileSize: 100 }] });
    });

    await adapter.capturePhoto();

    const callArgs = mockLaunchCamera.mock.calls[0][0];
    expect(callArgs.saveToPhotos).toBe(false);
  });

  // ── capturePhoto – original file deleted after encryption ───────────────
  it('unlinks the original temp file after storing encrypted', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED as 'granted',
    );
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ assets: [{ uri: 'file:///tmp/todel.jpg', fileName: 'todel.jpg', fileSize: 100 }] });
    });

    await adapter.capturePhoto();

    expect(mockRNFS.unlink).toHaveBeenCalledWith('/tmp/todel.jpg');
  });

  // ── capturePhoto – encrypted file in app-private area ───────────────────
  it('writes the encrypted file inside DocumentDirectoryPath', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED as 'granted',
    );
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ assets: [{ uri: 'file:///tmp/priv.jpg', fileName: 'priv.jpg', fileSize: 200 }] });
    });

    const result = await adapter.capturePhoto();
    expect(result.encryptedStagingPath).toContain(RNFS.DocumentDirectoryPath);
  });

  // ── capturePhoto – AES encryption invoked ──────────────────────────────
  it('calls AES encrypt to protect image data', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED as 'granted',
    );
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ assets: [{ uri: 'file:///tmp/enc.jpg', fileName: 'enc.jpg', fileSize: 100 }] });
    });

    await adapter.capturePhoto();
    expect(mockAes.encrypt).toHaveBeenCalled();
  });

  // ── capturePhoto – user cancel ──────────────────────────────────────────
  it('rejects with cancellation error when user cancels', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED as 'granted',
    );
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ didCancel: true });
    });

    await expect(adapter.capturePhoto()).rejects.toThrow(/cancelled/i);
  });

  // ── capturePhoto – throws when permission denied ────────────────────────
  it('throws when permission is denied before capture', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.DENIED as 'denied',
    );

    await expect(adapter.capturePhoto()).rejects.toThrow(/permission/i);
  });

  // ── capturePhoto – throws when permission blocked ───────────────────────
  it('throws when permission is permanently blocked', async () => {
    mockPermissionsAndroid.request.mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN as 'never_ask_again',
    );

    await expect(adapter.capturePhoto()).rejects.toThrow(/permission/i);
  });
});
