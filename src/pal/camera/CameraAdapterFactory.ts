/**
 * CameraAdapterFactory
 *
 * Returns the correct platform-specific ICameraAdapter at runtime.
 * This is the single entry-point for all camera operations across the app –
 * consumer code never imports IosCameraAdapter or AndroidCameraAdapter directly.
 *
 * iOS  → IosCameraAdapter  (AVFoundation)
 * Android → AndroidCameraAdapter (CameraX)
 */

import { Platform } from 'react-native';
import { ICameraAdapter } from './CameraTypes';
import { IosCameraAdapter } from './IosCameraAdapter';
import { AndroidCameraAdapter } from './AndroidCameraAdapter';

let _instance: ICameraAdapter | null = null;

/**
 * Returns a singleton camera adapter for the current platform.
 * Throws on unsupported platforms.
 */
export function getCameraAdapter(): ICameraAdapter {
  if (_instance) return _instance;

  switch (Platform.OS) {
    case 'ios':
      _instance = new IosCameraAdapter();
      break;
    case 'android':
      _instance = new AndroidCameraAdapter();
      break;
    default:
      throw new Error(
        `CameraAdapterFactory: unsupported platform "${Platform.OS}". ` +
        'Only ios and android are supported.',
      );
  }

  return _instance;
}

/**
 * Reset the singleton – used in tests to inject a different platform adapter.
 */
export function _resetCameraAdapter(): void {
  _instance = null;
}
