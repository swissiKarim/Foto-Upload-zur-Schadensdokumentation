/**
 * PAL Gallery – public entry point.
 *
 * Consumers import from here; they never depend on the platform-specific
 * implementation files directly. This is the seam that fulfils the
 * "iOS and Android implementations are encapsulated behind the PAL" criterion.
 */

import { Platform } from 'react-native';
import { AndroidGalleryPAL } from './AndroidGalleryPAL';
import { IOSGalleryPAL } from './IOSGalleryPAL';
import type { IGalleryPAL } from './types';

export type { IGalleryPAL, GalleryPickerResult, PermissionResult, SelectedImage, ValidationResult } from './types';
export { ACCEPTED_EXTENSIONS, ACCEPTED_MIME_TYPES, MAX_IMAGE_SIZE_BYTES, MAX_IMAGES_PER_CLAIM } from './types';
export { validateImage, getExtension } from './validation';
export { IOSGalleryPAL } from './IOSGalleryPAL';
export { AndroidGalleryPAL } from './AndroidGalleryPAL';

/**
 * Factory – returns the correct IGalleryPAL implementation for the current platform.
 *
 * Usage:
 *   const pal = createGalleryPAL();
 *   const permission = await pal.requestPermission();
 *   const result = await pal.openPicker(remainingSlots);
 */
export function createGalleryPAL(): IGalleryPAL {
  if (Platform.OS === 'android') {
    return new AndroidGalleryPAL();
  }
  // Default: iOS (and any future Apple platform)
  return new IOSGalleryPAL();
}
