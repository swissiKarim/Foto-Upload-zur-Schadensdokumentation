/**
 * IosCameraAdapter
 *
 * iOS implementation of ICameraAdapter.
 * Uses AVFoundation (via react-native-image-picker which wraps AVFoundation
 * under the hood on iOS) and stores results in the AES-256 encrypted
 * app-private staging area.
 *
 * Info.plist must include NSCameraUsageDescription.
 */

import { launchCamera, ImagePickerResponse, CameraOptions } from 'react-native-image-picker';
import { Platform, Linking } from 'react-native';
import { ICameraAdapter, CaptureResult, PermissionResult, SupportedFormat } from './CameraTypes';
import { storeEncrypted } from './EncryptedStagingStorage';

const PASSPHRASE_PLACEHOLDER = 'REPLACE_WITH_KEYCHAIN_SECRET';

function mimeFromExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png':  return 'image/png';
    case 'heic': return 'image/heic';
    default:     return 'image/jpeg';
  }
}

function formatFromExtension(ext: string): SupportedFormat {
  switch (ext.toLowerCase()) {
    case 'png':  return 'png';
    case 'heic': return 'heic';
    default:     return 'jpg';
  }
}

export class IosCameraAdapter implements ICameraAdapter {
  readonly platformName = 'AVFoundation' as const;

  async requestPermission(): Promise<PermissionResult> {
    if (Platform.OS !== 'ios') {
      return { status: 'unavailable' };
    }

    return new Promise((resolve) => {
      const options: CameraOptions = {
        mediaType: 'photo',
        saveToPhotos: false, // never write to public Camera Roll
        includeBase64: false,
      };

      // react-native-image-picker triggers the AVFoundation permission dialog
      // on first call; subsequent calls respect the stored decision.
      launchCamera(options, (response: ImagePickerResponse) => {
        if (response.errorCode === 'permission') {
          resolve({
            status: 'blocked',
            denialMessage:
              'Die Kamera-Berechtigung wurde verweigert. ' +
              'Bitte erlaube den Kamerazugriff in den Einstellungen, ' +
              'um Fotos für die Schadensmeldung aufnehmen zu können.',
            settingsUrl: 'app-settings:',
          });
        } else if (response.errorCode === 'camera_unavailable') {
          resolve({ status: 'unavailable' });
        } else {
          resolve({ status: 'granted' });
        }
      });
    });
  }

  async capturePhoto(): Promise<CaptureResult> {
    const permission = await this.requestPermission();
    if (permission.status !== 'granted') {
      throw new Error(
        `Camera permission not granted (status: ${permission.status}). ` +
        (permission.denialMessage ?? ''),
      );
    }

    return new Promise((resolve, reject) => {
      const options: CameraOptions = {
        mediaType: 'photo',
        saveToPhotos: false, // CRITICAL: do not write to public Camera Roll
        includeBase64: false,
        quality: 0.85 as never,  // PhotoQuality union – cast to bypass strict typing in tests
      };

      launchCamera(options, async (response: ImagePickerResponse) => {
        if (response.didCancel) {
          reject(new Error('User cancelled camera'));
          return;
        }
        if (response.errorCode) {
          reject(new Error(`Camera error: ${response.errorCode} – ${response.errorMessage}`));
          return;
        }

        const asset = response.assets?.[0];
        if (!asset?.uri || !asset.fileName) {
          reject(new Error('No image asset returned from camera'));
          return;
        }

        const ext = asset.fileName.split('.').pop() ?? 'jpg';
        const format = formatFromExtension(ext);
        const mimeType = mimeFromExtension(ext);

        // Strip file:// prefix for RNFS
        const sourcePath = asset.uri.replace('file://', '');

        try {
          const staging = await storeEncrypted(
            sourcePath,
            `capture_${Date.now()}`,
            PASSPHRASE_PLACEHOLDER,
          );

          resolve({
            encryptedStagingPath: staging.encryptedPath,
            fileName: asset.fileName,
            mimeType,
            originalSizeBytes: asset.fileSize ?? 0,
            format,
            capturedAt: new Date(),
          });
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /** Opens iOS Settings for this app so the user can grant camera access. */
  openSettings(): void {
    Linking.openURL('app-settings:').catch(() => {
      console.warn('Could not open iOS Settings');
    });
  }
}
