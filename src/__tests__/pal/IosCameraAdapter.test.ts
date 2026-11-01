/**
 * Unit tests for IosCameraAdapter (AVFoundation / iOS PAL branch)
 *
 * Acceptance criteria covered:
 *   - Request camera permission per iOS guidelines (NSCameraUsageDescription / AVFoundation)
 *   - Denial returns message + settings link
 *   - Capture stores result in encrypted staging (not public storage)
 *   - Supported formats: JPG, PNG, HEIC
 *   - platformName === 'AVFoundation'
 */

import { Platform } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import Aes from 'react-native-aes-crypto';
import { IosCameraAdapter } from '../../pal/camera/IosCameraAdapter';

(Platform as { OS: string }).OS = 'ios';

const mockLaunchCamera = launchCamera as jest.Mock;
const mockRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockAes = Aes as jest.Mocked<typeof Aes>;

/** Grant permission then return a capture asset */
function mockGrantThenCapture(asset: {
  uri: string;
  fileName: string;
  fileSize: number;
}) {
  // First call: requestPermission (returns granted)
  mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
    cb({ assets: [asset] });
  });
  // Second call: capturePhoto
  mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
    cb({ assets: [asset] });
  });
}

describe('IosCameraAdapter – PAL iOS branch', () => {
  let adapter: IosCameraAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as { OS: string }).OS = 'ios';
    adapter = new IosCameraAdapter();
  });

  // ── platformName ────────────────────────────────────────────────────────
  it('exposes platformName = AVFoundation', () => {
    expect(adapter.platformName).toBe('AVFoundation');
  });

  // ── requestPermission – granted ─────────────────────────────────────────
  it('returns granted when launchCamera succeeds (no errorCode)', async () => {
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ assets: [{ uri: 'file:///tmp/photo.jpg', fileName: 'photo.jpg', fileSize: 1000 }] });
    });

    const result = await adapter.requestPermission();
    expect(result.status).toBe('granted');
  });

  // ── requestPermission – blocked (permanently denied) ────────────────────
  it('returns blocked with denialMessage and settingsUrl when permission denied', async () => {
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ errorCode: 'permission', errorMessage: 'permission denied' });
    });

    const result = await adapter.requestPermission();
    expect(result.status).toBe('blocked');
    expect(result.denialMessage).toBeDefined();
    expect(result.denialMessage!.length).toBeGreaterThan(10);
    expect(result.settingsUrl).toBe('app-settings:');
  });

  // ── requestPermission – camera unavailable ──────────────────────────────
  it('returns unavailable when camera hardware is not accessible', async () => {
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ errorCode: 'camera_unavailable' });
    });

    const result = await adapter.requestPermission();
    expect(result.status).toBe('unavailable');
  });

  // ── capturePhoto – happy path (JPG) ────────────────────────────────────
  it('captures a JPG and returns an encrypted staging path', async () => {
    const asset = { uri: 'file:///tmp/photo.jpg', fileName: 'photo.jpg', fileSize: 500_000 };
    mockGrantThenCapture(asset);

    const result = await adapter.capturePhoto();

    expect(result.format).toBe('jpg');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.encryptedStagingPath).toMatch(/\.enc$/);
    expect(result.originalSizeBytes).toBe(500_000);
    expect(result.capturedAt).toBeInstanceOf(Date);
  });

  // ── capturePhoto – PNG format ───────────────────────────────────────────
  it('captures a PNG and sets correct mimeType', async () => {
    const asset = { uri: 'file:///tmp/photo.png', fileName: 'damage.png', fileSize: 800_000 };
    mockGrantThenCapture(asset);

    const result = await adapter.capturePhoto();
    expect(result.format).toBe('png');
    expect(result.mimeType).toBe('image/png');
  });

  // ── capturePhoto – HEIC format ──────────────────────────────────────────
  it('captures a HEIC and sets correct mimeType', async () => {
    const asset = { uri: 'file:///tmp/photo.heic', fileName: 'damage.heic', fileSize: 600_000 };
    mockGrantThenCapture(asset);

    const result = await adapter.capturePhoto();
    expect(result.format).toBe('heic');
    expect(result.mimeType).toBe('image/heic');
  });

  // ── capturePhoto – saveToPhotos must be false (no public storage) ───────
  it('always passes saveToPhotos=false to launchCamera', async () => {
    const asset = { uri: 'file:///tmp/p.jpg', fileName: 'p.jpg', fileSize: 100 };
    mockGrantThenCapture(asset);

    await adapter.capturePhoto();

    // Both calls (permission check + capture) must have saveToPhotos=false
    for (const call of mockLaunchCamera.mock.calls) {
      expect(call[0].saveToPhotos).toBe(false);
    }
  });

  // ── capturePhoto – original temp file deleted after encryption ──────────
  it('unlinks the original temp file after storing encrypted', async () => {
    const asset = { uri: 'file:///tmp/del_test.jpg', fileName: 'del_test.jpg', fileSize: 100 };
    mockGrantThenCapture(asset);

    await adapter.capturePhoto();

    expect(mockRNFS.unlink).toHaveBeenCalledWith('/tmp/del_test.jpg');
  });

  // ── capturePhoto – encrypted file written to app-private staging ────────
  it('writes the encrypted file inside DocumentDirectoryPath (app-private)', async () => {
    const asset = { uri: 'file:///tmp/private.jpg', fileName: 'private.jpg', fileSize: 200 };
    mockGrantThenCapture(asset);

    const result = await adapter.capturePhoto();

    expect(result.encryptedStagingPath).toContain(RNFS.DocumentDirectoryPath);
  });

  // ── capturePhoto – AES encryption invoked ──────────────────────────────
  it('calls AES encrypt to protect the image data', async () => {
    const asset = { uri: 'file:///tmp/enc.jpg', fileName: 'enc.jpg', fileSize: 100 };
    mockGrantThenCapture(asset);

    await adapter.capturePhoto();

    expect(mockAes.encrypt).toHaveBeenCalled();
  });

  // ── capturePhoto – user cancel ──────────────────────────────────────────
  it('rejects with cancellation error when user cancels', async () => {
    // permission check: granted
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ assets: [{ uri: 'file:///tmp/ok.jpg', fileName: 'ok.jpg', fileSize: 100 }] });
    });
    // capture call: cancelled
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ didCancel: true });
    });

    await expect(adapter.capturePhoto()).rejects.toThrow(/cancelled/i);
  });

  // ── capturePhoto – permission denied throws ─────────────────────────────
  it('throws when permission is not granted before capture', async () => {
    // permission check: denied
    mockLaunchCamera.mockImplementationOnce((_opts: unknown, cb: Function) => {
      cb({ errorCode: 'permission' });
    });

    await expect(adapter.capturePhoto()).rejects.toThrow(/permission/i);
  });
});
