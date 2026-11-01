/**
 * Platform Abstraction Layer (PAL) – Camera Types
 *
 * All platform-specific camera implementations (iOS/AVFoundation, Android/CameraX)
 * are hidden behind these shared types and the ICameraAdapter interface.
 */

/** Supported image formats per brief */
export type SupportedFormat = 'jpg' | 'png' | 'heic';

export interface CaptureResult {
  /** Absolute path inside the app-private encrypted staging area */
  encryptedStagingPath: string;
  /** Original file name before encryption */
  fileName: string;
  /** MIME type derived from the format */
  mimeType: string;
  /** File size in bytes of the original (before compression) */
  originalSizeBytes: number;
  /** Format of the captured image */
  format: SupportedFormat;
  /** Timestamp of capture */
  capturedAt: Date;
}

export type PermissionStatus =
  | 'granted'
  | 'denied'
  | 'blocked'   // permanently denied – must go to settings
  | 'unavailable'; // hardware not available

export interface PermissionResult {
  status: PermissionStatus;
  /** Human-readable explanation shown when permission is denied/blocked */
  denialMessage?: string;
  /** Deep-link URI to device settings (populated when status === 'blocked') */
  settingsUrl?: string;
}

export interface ICameraAdapter {
  /**
   * Request camera permission according to platform guidelines.
   * iOS: NSCameraUsageDescription / AVFoundation
   * Android: CameraX runtime permission (Manifest.permission.CAMERA)
   */
  requestPermission(): Promise<PermissionResult>;

  /**
   * Launch the in-app camera, capture a photo and store it in the
   * app-private AES-256 encrypted staging area.
   * Throws if permission has not been granted.
   */
  capturePhoto(): Promise<CaptureResult>;

  /** Name of the underlying platform / framework for diagnostics */
  readonly platformName: 'AVFoundation' | 'CameraX';
}
