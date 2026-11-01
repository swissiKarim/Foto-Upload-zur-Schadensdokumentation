/**
 * Unit tests for CameraAdapterFactory
 *
 * Verifies that the correct platform adapter is returned and that
 * both adapters are properly hidden behind the PAL.
 */

import { Platform } from 'react-native';
import { getCameraAdapter, _resetCameraAdapter } from '../../pal/camera/CameraAdapterFactory';

describe('CameraAdapterFactory', () => {
  beforeEach(() => {
    _resetCameraAdapter();
  });

  it('returns IosCameraAdapter with platformName AVFoundation on iOS', () => {
    (Platform as { OS: string }).OS = 'ios';
    const adapter = getCameraAdapter();
    expect(adapter.platformName).toBe('AVFoundation');
  });

  it('returns AndroidCameraAdapter with platformName CameraX on Android', () => {
    (Platform as { OS: string }).OS = 'android';
    const adapter = getCameraAdapter();
    expect(adapter.platformName).toBe('CameraX');
  });

  it('returns the same singleton instance on repeated calls', () => {
    (Platform as { OS: string }).OS = 'ios';
    const a = getCameraAdapter();
    const b = getCameraAdapter();
    expect(a).toBe(b);
  });

  it('throws for unsupported platform', () => {
    (Platform as { OS: string }).OS = 'web';
    expect(() => getCameraAdapter()).toThrow(/unsupported platform/i);
  });

  it('_resetCameraAdapter clears singleton so new platform is picked up', () => {
    (Platform as { OS: string }).OS = 'ios';
    const ios = getCameraAdapter();
    expect(ios.platformName).toBe('AVFoundation');

    _resetCameraAdapter();
    (Platform as { OS: string }).OS = 'android';
    const android = getCameraAdapter();
    expect(android.platformName).toBe('CameraX');
  });
});
