/**
 * ImageManager
 *
 * Manages the list of captured/selected images for a single damage report.
 *
 * Acceptance criteria covered:
 *   - Max 10 images per damage report
 *   - Counter display support (via count getter)
 *   - Supported formats: JPG, PNG, HEIC
 *   - Max original file size: 15 MB
 *   - Remove individual images
 *   - After capture, image immediately visible as thumbnail
 */

import { CaptureResult, SupportedFormat } from '../../pal/camera/CameraTypes';

export const MAX_IMAGES = 10;
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
export const SUPPORTED_FORMATS: SupportedFormat[] = ['jpg', 'png', 'heic'];

export interface ManagedImage {
  id: string;
  captureResult: CaptureResult;
  thumbnailPath: string; // points to encrypted staging path (decrypted for display)
  addedAt: Date;
}

export class ImageManager {
  private images: ManagedImage[] = [];

  /** Current number of images added */
  get count(): number {
    return this.images.length;
  }

  /** Whether more images can be added */
  get canAddMore(): boolean {
    return this.images.length < MAX_IMAGES;
  }

  /** Read-only snapshot of current images */
  get all(): ReadonlyArray<ManagedImage> {
    return [...this.images];
  }

  /**
   * Add a capture result to the manager.
   * Validates format and file size before adding.
   * Throws if limit is reached or validation fails.
   */
  add(captureResult: CaptureResult): ManagedImage {
    if (this.images.length >= MAX_IMAGES) {
      throw new Error(
        `Maximale Anzahl von ${MAX_IMAGES} Bildern erreicht. ` +
        'Bitte entferne ein Bild, bevor du ein neues hinzufügst.',
      );
    }

    if (!SUPPORTED_FORMATS.includes(captureResult.format)) {
      throw new Error(
        `Dateiformat "${captureResult.format}" wird nicht unterstützt. ` +
        `Unterstützte Formate: ${SUPPORTED_FORMATS.join(', ')}.`,
      );
    }

    if (captureResult.originalSizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (captureResult.originalSizeBytes / (1024 * 1024)).toFixed(1);
      throw new Error(
        `Das Bild ist zu groß (${sizeMb} MB). ` +
        `Die maximale Dateigröße beträgt ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
      );
    }

    const managed: ManagedImage = {
      id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      captureResult,
      thumbnailPath: captureResult.encryptedStagingPath,
      addedAt: new Date(),
    };

    this.images.push(managed);
    return managed;
  }

  /**
   * Remove an image by its id.
   * Returns true if found and removed, false otherwise.
   */
  remove(id: string): boolean {
    const index = this.images.findIndex((img) => img.id === id);
    if (index === -1) return false;
    this.images.splice(index, 1);
    return true;
  }

  /** Reset all images (e.g. after successful submission) */
  clear(): void {
    this.images = [];
  }

  /**
   * Returns counter display string, e.g. "3 / 10"
   */
  get counterDisplay(): string {
    return `${this.images.length} / ${MAX_IMAGES}`;
  }
}
