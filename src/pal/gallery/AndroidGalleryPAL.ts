/**
 * Android Gallery PAL Implementation
 *
 * Uses the Android Photo Picker API (Android 13+ / API 33) via
 * react-native-image-picker's launchImageLibrary, which on Android maps to
 * the system Photo Picker or falls back to MediaStore for older API levels.
 *
 * Permissions:
 *  - Android 13+ (API 33+): READ_MEDIA_IMAGES (no READ_EXTERNAL_STORAGE needed)
 *  - Android 12 and below:  READ_EXTERNAL_STORAGE
 *
 * Both are requested at runtime via PermissionsAndroid.
 *
 * Format support: JPG, PNG, HEIC (HEIC support depends on device/Android version).
 */

import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  GalleryPickerResult,
  IGalleryPAL,
  PermissionResult,
  SelectedImage,
  ValidationResult,
} from './types';
import { validateImage } from './validation';

// ---------------------------------------------------------------------------
// Android permission helpers
// ---------------------------------------------------------------------------

/**
 * Returns the correct storage permission name based on Android API level.
 * API 33+ → READ_MEDIA_IMAGES
 * Below   → READ_EXTERNAL_STORAGE
 */
function resolveStoragePermission(): string {
  // Platform.Version is the Android API level (number) on Android.
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : 0;
  if (apiLevel >= 33) {
    return PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES;
  }
  return PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
}

/** Dependency-injected permission requester – makes unit testing easy. */
export type AndroidPermissionRequester = (permission: string) => Promise<string>;

async function defaultAndroidPermissionRequester(permission: string): Promise<string> {
  return PermissionsAndroid.request(permission as never, {
    title: 'Zugriff auf Fotos',
    message:
      'Die App benötigt Zugriff auf deine Fotogalerie, ' +
      'um Schadensfotos auswählen zu können.',
    buttonPositive: 'Erlauben',
    buttonNegative: 'Ablehnen',
    buttonNeutral: 'Später fragen',
  });
}

// ---------------------------------------------------------------------------
// AndroidGalleryPAL
// ---------------------------------------------------------------------------

export class AndroidGalleryPAL implements IGalleryPAL {
  private readonly requestPermission_: AndroidPermissionRequester;

  constructor(requestPermission: AndroidPermissionRequester = defaultAndroidPermissionRequester) {
    this.requestPermission_ = requestPermission;
  }

  // -------------------------------------------------------------------------
  // IGalleryPAL – requestPermission
  // -------------------------------------------------------------------------

  async requestPermission(): Promise<PermissionResult> {
    const permission = resolveStoragePermission();
    let result: string;

    try {
      result = await this.requestPermission_(permission);
    } catch (err: unknown) {
      return {
        granted: false,
        canAskAgain: false,
        message: 'Berechtigung konnte nicht abgefragt werden.',
      };
    }

    switch (result) {
      case PermissionsAndroid.RESULTS.GRANTED:
        return { granted: true };

      case PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN:
        return {
          granted: false,
          canAskAgain: false,
          message:
            'Der Zugriff auf deine Fotos wurde dauerhaft verweigert. ' +
            'Bitte erlaube den Zugriff in den Einstellungen, um Fotos auswählen zu können.',
        };

      case PermissionsAndroid.RESULTS.DENIED:
      default:
        return {
          granted: false,
          canAskAgain: true,
          message:
            'Die App benötigt Zugriff auf deine Fotogalerie, um Schadensfotos auszuwählen.',
        };
    }
  }

  // -------------------------------------------------------------------------
  // IGalleryPAL – openPicker
  // -------------------------------------------------------------------------

  async openPicker(maxImages: number): Promise<GalleryPickerResult> {
    // 1. Request permission
    const permission = await this.requestPermission();

    if (!permission.granted) {
      if (!permission.canAskAgain) {
        // Open system settings so the user can grant permission manually
        await Linking.openSettings();
      }
      return {
        status: 'permission_denied',
        message: permission.message,
      };
    }

    // 2. Open the Android Photo Picker via launchImageLibrary
    let response: Awaited<ReturnType<typeof launchImageLibrary>>;
    try {
      response = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: maxImages,
        quality: 1,
        includeBase64: false,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unbekannter Fehler beim Öffnen der Galerie.';
      return { status: 'error', message };
    }

    // 3. Handle cancellation
    if (response.didCancel) {
      return { status: 'cancelled' };
    }

    if (response.errorCode) {
      return {
        status: 'error',
        message: response.errorMessage ?? `Fehler beim Öffnen der Galerie (${response.errorCode}).`,
      };
    }

    // 4. Validate and map each asset
    const assets = response.assets ?? [];
    const validImages: SelectedImage[] = [];
    const errors: string[] = [];

    for (const asset of assets) {
      const candidate = {
        fileName: asset.fileName ?? 'unbekannt',
        mimeType: asset.type ?? '',
        fileSizeBytes: asset.fileSize ?? 0,
      };

      const validation = validateImage(candidate);
      if (!validation.valid) {
        errors.push(validation.message);
        continue;
      }

      validImages.push({
        uri: asset.uri ?? '',
        fileName: candidate.fileName,
        mimeType: candidate.mimeType,
        fileSizeBytes: candidate.fileSizeBytes,
        width: asset.width,
        height: asset.height,
      });
    }

    if (errors.length > 0 && validImages.length === 0) {
      return { status: 'error', message: errors.join('\n') };
    }

    return { status: 'success', images: validImages };
  }

  // -------------------------------------------------------------------------
  // IGalleryPAL – validateImage
  // -------------------------------------------------------------------------

  validateImage(
    image: Pick<SelectedImage, 'fileName' | 'mimeType' | 'fileSizeBytes'>
  ): ValidationResult {
    return validateImage(image);
  }
}
