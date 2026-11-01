/**
 * Shared image validation logic used by both iOS and Android PAL implementations.
 */

import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  SelectedImage,
  ValidationResult,
} from './types';

/**
 * Extracts the lower-cased file extension from a file name.
 * Returns empty string if no extension is found.
 */
export function getExtension(fileName: string): string {
  const parts = fileName.split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Validates a single image against format and size constraints.
 *
 * Rules:
 *  - Accepted MIME types: image/jpeg, image/png, image/heic, image/heif
 *  - Accepted extensions: jpg, jpeg, png, heic, heif
 *  - Maximum size: 15 MB
 *
 * Format check uses the MIME type when available; falls back to file extension.
 */
export function validateImage(
  image: Pick<SelectedImage, 'fileName' | 'mimeType' | 'fileSizeBytes'>
): ValidationResult {
  // --- Format check ---
  const mimeOk = image.mimeType ? ACCEPTED_MIME_TYPES.has(image.mimeType.toLowerCase()) : false;
  const ext = getExtension(image.fileName);
  const extOk = ACCEPTED_EXTENSIONS.has(ext);

  if (!mimeOk && !extOk) {
    return {
      valid: false,
      reason: 'unsupported_format',
      message: `Das Format „${image.mimeType || ext || 'unbekannt'}" wird nicht unterstützt. ` +
        'Bitte wähle ein Bild im Format JPG, PNG oder HEIC.',
    };
  }

  // --- Size check ---
  if (image.fileSizeBytes > MAX_IMAGE_SIZE_BYTES) {
    const sizeMB = (image.fileSizeBytes / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      reason: 'file_too_large',
      message: `Das Bild ist ${sizeMB} MB groß und überschreitet die maximale Dateigröße von 15 MB. ` +
        'Bitte wähle ein kleineres Bild.',
    };
  }

  return { valid: true };
}
