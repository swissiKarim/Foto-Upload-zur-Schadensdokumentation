/**
 * DamageReportCameraService
 *
 * Orchestrates camera capture within the damage report flow.
 * Ties together:
 *   - CameraAdapterFactory (PAL)
 *   - ImageManager (business rules)
 *   - Permission handling
 *
 * Acceptance criteria covered:
 *   - Start in-app camera from damage report view
 *   - Request permission on first access (iOS AVFoundation / Android CameraX)
 *   - Show denial message with settings link when permission denied
 *   - Store capture in AES-256 encrypted app-private staging area
 *   - Immediately visible as thumbnail after capture
 *   - Supported formats: JPG, PNG, HEIC
 */

import { getCameraAdapter } from '../../pal/camera/CameraAdapterFactory';
import { ICameraAdapter, PermissionResult, CaptureResult } from '../../pal/camera/CameraTypes';
import { ImageManager, ManagedImage } from './ImageManager';

export interface CameraServiceResult {
  success: boolean;
  managedImage?: ManagedImage;
  permissionResult?: PermissionResult;
  error?: string;
}

export class DamageReportCameraService {
  private adapter: ICameraAdapter;
  private imageManager: ImageManager;

  constructor(imageManager: ImageManager, adapter?: ICameraAdapter) {
    this.imageManager = imageManager;
    // Allow injection for testing; default to factory (platform-specific)
    this.adapter = adapter ?? getCameraAdapter();
  }

  get platformName(): string {
    return this.adapter.platformName;
  }

  /**
   * Main entry point called when user taps "Foto aufnehmen" in the damage
   * report view.
   *
   * Flow:
   *  1. Check if more images can be added
   *  2. Request camera permission
   *  3. On grant: capture photo → store encrypted → add to ImageManager
   *  4. On denial: return permission result for UI to show denial view
   */
  async startCapture(): Promise<CameraServiceResult> {
    if (!this.imageManager.canAddMore) {
      return {
        success: false,
        error: `Maximale Anzahl von ${this.imageManager.count} Bildern erreicht.`,
      };
    }

    // Step 1: Request permission
    let permissionResult: PermissionResult;
    try {
      permissionResult = await this.adapter.requestPermission();
    } catch (err) {
      return {
        success: false,
        error: `Fehler beim Anfordern der Kameraberechtigung: ${String(err)}`,
      };
    }

    if (permissionResult.status !== 'granted') {
      return {
        success: false,
        permissionResult,
        error: permissionResult.denialMessage,
      };
    }

    // Step 2: Capture photo (stored encrypted in staging)
    let captureResult: CaptureResult;
    try {
      captureResult = await this.adapter.capturePhoto();
    } catch (err) {
      const message = String(err);
      if (message.includes('cancelled')) {
        return { success: false, error: 'Aufnahme abgebrochen.' };
      }
      return {
        success: false,
        error: `Fehler bei der Fotoaufnahme: ${message}`,
      };
    }

    // Step 3: Add to image manager (validates format + size)
    let managedImage: ManagedImage;
    try {
      managedImage = this.imageManager.add(captureResult);
    } catch (err) {
      return { success: false, error: String(err) };
    }

    return { success: true, managedImage };
  }

  /** Remove an image from the damage report */
  removeImage(id: string): boolean {
    return this.imageManager.remove(id);
  }

  /** Current image list for thumbnail display */
  get images(): ReadonlyArray<ManagedImage> {
    return this.imageManager.all;
  }

  /** Counter string for display, e.g. "2 / 10" */
  get counterDisplay(): string {
    return this.imageManager.counterDisplay;
  }
}
