/**
 * ClaimImageManager
 *
 * Orchestrates gallery image selection for a single claim report.
 * Enforces the 10-image limit, delegates to the PAL for platform-specific
 * gallery access, and exposes a clean API for the UI layer.
 */

import {
  createGalleryPAL,
  GalleryPickerResult,
  IGalleryPAL,
  MAX_IMAGES_PER_CLAIM,
  PermissionResult,
  SelectedImage,
} from '../../pal/gallery';

export interface ClaimImageManagerState {
  images: SelectedImage[];
  count: number;
  remainingSlots: number;
  isAtLimit: boolean;
}

export type AddImagesResult =
  | { status: 'success'; added: SelectedImage[]; skippedErrors: string[] }
  | { status: 'cancelled' }
  | { status: 'permission_denied'; message: string; canOpenSettings: boolean }
  | { status: 'at_limit'; message: string }
  | { status: 'error'; message: string };

export class ClaimImageManager {
  private readonly pal: IGalleryPAL;
  private images: SelectedImage[] = [];

  constructor(pal: IGalleryPAL = createGalleryPAL()) {
    this.pal = pal;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  getState(): ClaimImageManagerState {
    return {
      images: [...this.images],
      count: this.images.length,
      remainingSlots: MAX_IMAGES_PER_CLAIM - this.images.length,
      isAtLimit: this.images.length >= MAX_IMAGES_PER_CLAIM,
    };
  }

  // ---------------------------------------------------------------------------
  // Permission
  // ---------------------------------------------------------------------------

  async requestGalleryPermission(): Promise<PermissionResult> {
    return this.pal.requestPermission();
  }

  // ---------------------------------------------------------------------------
  // Open gallery picker and add selected images
  // ---------------------------------------------------------------------------

  async addImagesFromGallery(): Promise<AddImagesResult> {
    const state = this.getState();

    if (state.isAtLimit) {
      return {
        status: 'at_limit',
        message: `Du hast bereits die maximale Anzahl von ${MAX_IMAGES_PER_CLAIM} Bildern hinzugefügt.`,
      };
    }

    // Open picker with remaining slots
    const pickerResult: GalleryPickerResult = await this.pal.openPicker(state.remainingSlots);

    switch (pickerResult.status) {
      case 'cancelled':
        return { status: 'cancelled' };

      case 'permission_denied':
        return {
          status: 'permission_denied',
          message: pickerResult.message,
          canOpenSettings: true,
        };

      case 'error':
        return { status: 'error', message: pickerResult.message };

      case 'success': {
        const toAdd = pickerResult.images;
        const skippedErrors: string[] = [];

        // Re-enforce limit in case PAL returned more than allowed
        const freeSlots = MAX_IMAGES_PER_CLAIM - this.images.length;
        const accepted = toAdd.slice(0, freeSlots);
        if (toAdd.length > freeSlots) {
          skippedErrors.push(
            `${toAdd.length - freeSlots} Bild(er) konnten nicht hinzugefügt werden, ` +
              `da das Limit von ${MAX_IMAGES_PER_CLAIM} Bildern erreicht wurde.`
          );
        }

        this.images = [...this.images, ...accepted];

        return { status: 'success', added: accepted, skippedErrors };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Remove image
  // ---------------------------------------------------------------------------

  removeImage(uri: string): boolean {
    const before = this.images.length;
    this.images = this.images.filter((img) => img.uri !== uri);
    return this.images.length < before;
  }

  // ---------------------------------------------------------------------------
  // Reset (e.g. after successful claim submission)
  // ---------------------------------------------------------------------------

  reset(): void {
    this.images = [];
  }
}
