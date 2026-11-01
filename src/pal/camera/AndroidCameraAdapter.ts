/**
 * AndroidCameraAdapter
 *
 * Android implementation of ICameraAdapter.
 * Uses CameraX (via react-native-image-picker which delegates to CameraX on
 * Android ≥ API 21) with the Android runtime permission model.
 *
 * AndroidManifest.xml must include:
 *   <uses-permission android:name="android.permission.CAMERA" />
 */

import { launchCamera, ImagePickerResponse, CameraOptions } from 'react-native-image-picker';
import { Platform, PermissionsAndroid, Linking } from 'react-native';
import { ICameraAdapter, CaptureResult, PermissionResult, SupportedFormat } from './CameraTypes';
import { storeEncrypted } from './EncryptedStagingStorage';

const PASSPHRASE_PLACEHOLDER = 'REPLACE_WITH_KEYSTORE_SECRET';

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

export class AndroidCameraAdapter implements ICameraAdapter {
  readonly platformName = 'CameraX' as const;

  async requestPermission(): Promise<PermissionResult> {
    if (Platform.OS !== 'android') {
      return { status: 'unavailable' };
    }

    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Kamerazugriff erforderlich',
          message:
            'Die App benötigt Zugriff auf deine Kamera, ' +
            'um Fotos für die Schadensmeldung aufnehmen zu können.',
          buttonPositive: 'Erlauben',
          buttonNegative: 'Ablehnen',
          buttonNeutral: 'Später fragen',
        },
      );

      switch (result) {
        case PermissionsAndroid.RESULTS.GRANTED:
          return { status: 'granted' };

        case PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN:
          return {
            status: 'blocked',
            denialMessage:
              'Die Kamera-Berechtigung wurde dauerhaft verweigert. ' +
              'Bitte erlaube den Kamerazugriff in den Einstellungen, ' +
              'um Fotos für die Schadensmeldung aufnehmen zu können.',
            settingsUrl: 'android.settings.APPLICATION_DETAILS_SETTINGS',
          };

        default:
          return {
            status: 'denied',
            denialMessage:
              'Die Kamera-Berechtigung wurde verweigert. ' +
              'Bitte erlaube den Kamerazugriff, ' +
              'um Fotos für die Schadensmeldung aufnehmen zu können.',
          };
      }
    } catch (err) {
      return { status: 'unavailable' };
    }
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
        saveToPhotos: false, // CRITICAL: do not write to public gallery
        includeBase64: false,
        quality: 0.85 as never,
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

  /** Opens Android App Settings so the user can grant camera access. */
  openSettings(): void {
    Linking.openSettings().catch(() => {
      console.warn('Could not open Android Settings');
    });
  }
}
