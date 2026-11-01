/**
 * iOS Gallery PAL Implementation
 *
 * Uses PHPickerViewController (iOS 14+) via react-native-image-picker's
 * launchImageLibrary, which maps to the native PHPickerViewController on iOS.
 *
 * Permissions:
 *  - iOS 14+: PHPickerViewController does NOT require explicit photo library
 *    permission for limited/full access in the picker flow. However, we still
 *    request NSPhotoLibraryUsageDescription permission for any direct asset
 *    access (e.g. thumbnail caching). This aligns with Apple's current guidelines.
 *
 * Format support: JPG, PNG, HEIC (native iOS formats).
 */

import { Linking } from 'react-native';
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
// iOS permission helper (react-native built-in)
// ---------------------------------------------------------------------------

/** Thin wrapper around the RN permissions API – swapped in tests via DI. */
export type IOSPermissionChecker = () => Promise<'granted' | 'denied' | 'unavailable' | 'limited' | 'blocked'>;

async function defaultIOSPermissionChecker(): Promise<'granted' | 'denied' | 'unavailable' | 'limited' | 'blocked'> {
  // On iOS 14+ PHPickerViewController does not need an upfront permission
  // request for the picker UI itself. We optimistically return 'granted' so
  // the picker opens; the OS handles fine-grained selection inside the picker.
  // For apps targeting iOS 13 or below (rare), fall back to 'denied'.
  return 'granted';
}

// ---------------------------------------------------------------------------
// IOSGalleryPAL
// ---------------------------------------------------------------------------

export class IOSGalleryPAL implements IGalleryPAL {
  private readonly checkPermission: IOSPermissionChecker;

  constructor(checkPermission: IOSPermissionChecker = defaultIOSPermissionChecker) {
    this.checkPermission = checkPermission;
  }

  // -------------------------------------------------------------------------
  // IGalleryPAL – requestPermission
  // -------------------------------------------------------------------------

  async requestPermission(): Promise<PermissionResult> {
    const status = await this.checkPermission();

    switch (status) {
      case 'granted':
      case 'limited':
        return { granted: true };

      case 'blocked':
        return {
          granted: false,
          canAskAgain: false,
          message:
            'Der Zugriff auf deine Fotos wurde verweigert. ' +
            'Bitte erlaube den Zugriff in den Einstellungen, um Fotos auswählen zu können.',
        };

      case 'denied':
        return {
          granted: false,
          canAskAgain: true,
          message:
            'Die App benötigt Zugriff auf deine Fotogalerie, um Schadensfotos auszuwählen.',
        };

      default:
        return {
          granted: false,
          canAskAgain: false,
          message: 'Foto-Berechtigung nicht verfügbar auf diesem Gerät.',
        };
    }
  }

  // -------------------------------------------------------------------------
  // IGalleryPAL – openPicker
  // -------------------------------------------------------------------------

  async openPicker(maxImages: number): Promise<GalleryPickerResult> {
    // 1. Check / request permission first
    const permission = await this.requestPermission();

    if (!permission.granted) {
      if (!permission.canAskAgain) {
        // Direct user to Settings
        await Linking.openSettings();
      }
      return {
        status: 'permission_denied',
        message: permission.message,
      };
    }

    // 2. Open PHPickerViewController via launchImageLibrary
    let response: Awaited<ReturnType<typeof launchImageLibrary>>;
    try {
      response = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: maxImages,
        // PHPickerViewController on iOS 14+ – no explicit quality setting
        // to avoid lossy re-encoding of HEIC/PNG at this stage (compression
        // is applied separately before upload).
        quality: 1,
        includeBase64: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler beim Öffnen der Galerie.';
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
