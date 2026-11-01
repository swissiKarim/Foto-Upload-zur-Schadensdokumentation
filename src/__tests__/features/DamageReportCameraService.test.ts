/**
 * Unit tests for DamageReportCameraService
 *
 * Acceptance criteria covered:
 *   - Start in-app camera from damage report view
 *   - Request permission on first access
 *   - Denial returns permission result for UI
 *   - Blocked returns denial message + settings URL
 *   - Capture result immediately visible in image list (thumbnail)
 *   - Remove image by id
 *   - Counter display
 *   - Platform name exposed (AVFoundation / CameraX)
 */

import { DamageReportCameraService } from '../../features/damageReport/DamageReportCameraService';
import { ImageManager, MAX_IMAGES } from '../../features/damageReport/ImageManager';
import { ICameraAdapter, CaptureResult, PermissionResult } from '../../pal/camera/CameraTypes';

function makeCaptureResult(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    encryptedStagingPath: '/app/private/documents/damage_staging/capture_999.enc',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    originalSizeBytes: 1_000_000,
    format: 'jpg',
    capturedAt: new Date(),
    ...overrides,
  };
}

function makeAdapter(
  permissionStatus: PermissionResult['status'] = 'granted',
  captureResult?: CaptureResult,
  throwOnCapture?: string,
): ICameraAdapter {
  return {
    platformName: 'AVFoundation',
    requestPermission: jest.fn(async (): Promise<PermissionResult> => {
      if (permissionStatus === 'granted') return { status: 'granted' };
      if (permissionStatus === 'blocked') {
        return {
          status: 'blocked',
          denialMessage: 'Bitte erlaube den Kamerazugriff in den Einstellungen.',
          settingsUrl: 'app-settings:',
        };
      }
      return {
        status: 'denied',
        denialMessage: 'Die Kamera-Berechtigung wurde verweigert.',
      };
    }),
    capturePhoto: jest.fn(async (): Promise<CaptureResult> => {
      if (throwOnCapture) throw new Error(throwOnCapture);
      return captureResult ?? makeCaptureResult();
    }),
  };
}

describe('DamageReportCameraService', () => {
  let imageManager: ImageManager;

  beforeEach(() => {
    imageManager = new ImageManager();
  });

  // ── startCapture – happy path ───────────────────────────────────────────
  it('startCapture succeeds and returns managedImage', async () => {
    const adapter = makeAdapter('granted');
    const service = new DamageReportCameraService(imageManager, adapter);

    const result = await service.startCapture();

    expect(result.success).toBe(true);
    expect(result.managedImage).toBeDefined();
    expect(result.managedImage!.captureResult.format).toBe('jpg');
  });

  it('requests permission before capturing', async () => {
    const adapter = makeAdapter('granted');
    const service = new DamageReportCameraService(imageManager, adapter);

    await service.startCapture();

    expect(adapter.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('calls capturePhoto after permission granted', async () => {
    const adapter = makeAdapter('granted');
    const service = new DamageReportCameraService(imageManager, adapter);

    await service.startCapture();

    expect(adapter.capturePhoto).toHaveBeenCalledTimes(1);
  });

  // ── thumbnail immediately visible ───────────────────────────────────────
  it('captured image appears immediately in images list (thumbnail)', async () => {
    const adapter = makeAdapter('granted');
    const service = new DamageReportCameraService(imageManager, adapter);

    const result = await service.startCapture();

    expect(service.images).toContain(result.managedImage);
    expect(service.images[0].thumbnailPath).toBeDefined();
  });

  // ── permission denied ───────────────────────────────────────────────────
  it('returns failure with permissionResult when permission denied', async () => {
    const adapter = makeAdapter('denied');
    const service = new DamageReportCameraService(imageManager, adapter);

    const result = await service.startCapture();

    expect(result.success).toBe(false);
    expect(result.permissionResult).toBeDefined();
    expect(result.permissionResult!.status).toBe('denied');
    expect(result.permissionResult!.denialMessage).toBeDefined();
    expect(adapter.capturePhoto).not.toHaveBeenCalled();
  });

  // ── permission blocked ──────────────────────────────────────────────────
  it('returns blocked status with denialMessage and settingsUrl', async () => {
    const adapter = makeAdapter('blocked');
    const service = new DamageReportCameraService(imageManager, adapter);

    const result = await service.startCapture();

    expect(result.success).toBe(false);
    expect(result.permissionResult!.status).toBe('blocked');
    expect(result.permissionResult!.settingsUrl).toBeDefined();
    expect(result.error).toBeDefined();
  });

  // ── max images limit ────────────────────────────────────────────────────
  it('returns failure when max images already reached', async () => {
    const adapter = makeAdapter('granted');
    const service = new DamageReportCameraService(imageManager, adapter);

    // Fill up to max
    for (let i = 0; i < MAX_IMAGES; i++) {
      await service.startCapture();
    }

    const result = await service.startCapture();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/maximale/i);
    // Permission should not even be requested
    expect(adapter.requestPermission).toHaveBeenCalledTimes(MAX_IMAGES);
  });

  // ── user cancel ─────────────────────────────────────────────────────────
  it('returns failure when user cancels capture', async () => {
    const adapter = makeAdapter('granted', undefined, 'User cancelled camera');
    const service = new DamageReportCameraService(imageManager, adapter);

    const result = await service.startCapture();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/abgebrochen/i);
    expect(imageManager.count).toBe(0);
  });

  // ── removeImage ─────────────────────────────────────────────────────────
  it('removeImage removes image from list', async () => {
    const adapter = makeAdapter('granted');
    const service = new DamageReportCameraService(imageManager, adapter);

    const { managedImage } = await service.startCapture();
    expect(service.images.length).toBe(1);

    const removed = service.removeImage(managedImage!.id);
    expect(removed).toBe(true);
    expect(service.images.length).toBe(0);
  });

  it('removeImage returns false for unknown id', async () => {
    const adapter = makeAdapter('granted');
    const service = new DamageReportCameraService(imageManager, adapter);

    expect(service.removeImage('nonexistent')).toBe(false);
  });

  // ── counterDisplay ──────────────────────────────────────────────────────
  it('counterDisplay reflects current image count', async () => {
    const adapter = makeAdapter('granted');
    const service = new DamageReportCameraService(imageManager, adapter);

    expect(service.counterDisplay).toBe('0 / 10');

    await service.startCapture();
    expect(service.counterDisplay).toBe('1 / 10');

    await service.startCapture();
    expect(service.counterDisplay).toBe('2 / 10');
  });

  // ── platformName ────────────────────────────────────────────────────────
  it('exposes platformName from underlying adapter', () => {
    const adapter = makeAdapter('granted');
    const service = new DamageReportCameraService(imageManager, adapter);
    expect(service.platformName).toBe('AVFoundation');
  });

  // ── Android adapter ─────────────────────────────────────────────────────
  it('works with a CameraX adapter (Android)', async () => {
    const androidAdapter: ICameraAdapter = {
      ...makeAdapter('granted'),
      platformName: 'CameraX',
    };
    const service = new DamageReportCameraService(imageManager, androidAdapter);

    const result = await service.startCapture();
    expect(result.success).toBe(true);
    expect(service.platformName).toBe('CameraX');
  });
});
