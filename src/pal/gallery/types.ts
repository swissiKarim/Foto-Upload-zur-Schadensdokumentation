/**
 * Platform Abstraction Layer – Gallery types
 *
 * All platform-specific gallery implementations must conform to this interface.
 * This ensures that iOS (PHPickerViewController) and Android (Photo Picker /
 * MediaStore) details are fully encapsulated behind the PAL boundary.
 */

// ---------------------------------------------------------------------------
// Supported image formats
// ---------------------------------------------------------------------------

/** MIME types accepted for gallery uploads. */
export type AcceptedMimeType = 'image/jpeg' | 'image/png' | 'image/heic' | 'image/heif';

/** File extensions accepted for gallery uploads (lower-case). */
export type AcceptedExtension = 'jpg' | 'jpeg' | 'png' | 'heic' | 'heif';

export const ACCEPTED_MIME_TYPES: ReadonlySet<string> = new Set<AcceptedMimeType>([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
]);

export const ACCEPTED_EXTENSIONS: ReadonlySet<string> = new Set<AcceptedExtension>([
  'jpg',
  'jpeg',
  'png',
  'heic',
  'heif',
]);

/** Maximum allowed file size for a single image (15 MB in bytes). */
export const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/** Maximum number of images per claim report. */
export const MAX_IMAGES_PER_CLAIM = 10;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** A successfully selected image asset returned by the PAL. */
export interface SelectedImage {
  /** Platform URI (file:// or content://) */
  uri: string;
  /** Original file name, if available */
  fileName: string;
  /** MIME type as reported by the OS */
  mimeType: string;
  /** File size in bytes */
  fileSizeBytes: number;
  /** Width in pixels, if available */
  width?: number;
  /** Height in pixels, if available */
  height?: number;
}

/** The result of opening the gallery picker. */
export type GalleryPickerResult =
  | { status: 'success'; images: SelectedImage[] }
  | { status: 'cancelled' }
  | { status: 'permission_denied'; message: string }
  | { status: 'error'; message: string };

/** Result of a format/size validation. */
export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: 'unsupported_format'; message: string }
  | { valid: false; reason: 'file_too_large'; message: string };

// ---------------------------------------------------------------------------
// PAL interface
// ---------------------------------------------------------------------------

/**
 * Platform Abstraction Layer interface for gallery access.
 *
 * Implementations:
 *  - `IOSGalleryPAL`    → uses PHPickerViewController (iOS 14+)
 *  - `AndroidGalleryPAL` → uses Photo Picker API / MediaStore (Android)
 */
export interface IGalleryPAL {
  /**
   * Request the platform gallery permission.
   * Must be called before `openPicker`.
   * Returns `true` if permission was granted (or is already granted).
   */
  requestPermission(): Promise<PermissionResult>;

  /**
   * Open the native gallery picker and return selected images.
   * Performs format and size validation before returning.
   *
   * @param maxImages  Maximum number of images the user may select in this
   *                   session (must be ≤ remaining slots for the claim).
   */
  openPicker(maxImages: number): Promise<GalleryPickerResult>;

  /**
   * Validate a single image asset (format + size) without opening the picker.
   * Useful for re-validating items loaded from cache.
   */
  validateImage(image: Pick<SelectedImage, 'fileName' | 'mimeType' | 'fileSizeBytes'>): ValidationResult;
}

/** Result of a permission request. */
export type PermissionResult =
  | { granted: true }
  | { granted: false; canAskAgain: boolean; message: string };
