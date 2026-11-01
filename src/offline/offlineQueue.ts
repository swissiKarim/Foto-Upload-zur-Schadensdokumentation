/**
 * Offline Queue Manager
 *
 * When no internet connection is available, photos are stored locally
 * (AES-256 encrypted in app-private storage) and uploaded automatically
 * once connectivity is restored.
 *
 * AC: "Bei fehlender Internetverbindung müssen die Fotos lokal zwischengespeichert
 *      und automatisch hochgeladen werden, sobald die Verbindung wieder verfügbar ist."
 * AC: User-facing message: "Keine Internetverbindung. Die Bilder werden hochgeladen,
 *      sobald Du wieder online bist."
 */

import { v4 as uuidv4 } from 'uuid';
import {
  storeEncryptedPhoto,
  loadEncryptedPhoto,
  deleteStoredPhoto,
  listAllPendingPhotos,
  StorageConfig,
} from '../storage/encryptedLocalStorage';
import {
  uploadPhoto,
  UploadConfig,
  PhotoUploadResult,
} from '../upload/photoUploadService';

export const OFFLINE_MESSAGE =
  'Keine Internetverbindung. Die Bilder werden hochgeladen, sobald Du wieder online bist.';

export interface QueuedPhoto {
  photoId: string;
  claimId: string;
  filename: string;
  queuedAt: string;
}

export type ConnectivityChecker = () => Promise<boolean>;
export type UploadResultCallback = (result: PhotoUploadResult) => void;

/**
 * Checks connectivity by attempting a HEAD request to the base URL.
 * Returns true if the server is reachable.
 */
export async function defaultConnectivityCheck(baseUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(baseUrl);
      const mod = url.protocol === 'https:' ? require('https') : require('http');
      const req = mod.request(
        { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: '/health', method: 'HEAD', timeout: 5000 },
        () => resolve(true)
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

export class OfflinePhotoQueue {
  private storageConfig: StorageConfig;
  private uploadConfig: UploadConfig;
  private connectivityChecker: ConnectivityChecker;
  private onUploadResult?: UploadResultCallback;
  private retryIntervalMs: number;
  private retryTimer?: ReturnType<typeof setInterval>;
  private isProcessing = false;

  constructor(
    storageConfig: StorageConfig,
    uploadConfig: UploadConfig,
    options: {
      connectivityChecker?: ConnectivityChecker;
      onUploadResult?: UploadResultCallback;
      /** How often to retry pending uploads when online (default 30 000 ms) */
      retryIntervalMs?: number;
    } = {}
  ) {
    this.storageConfig = storageConfig;
    this.uploadConfig = uploadConfig;
    this.connectivityChecker =
      options.connectivityChecker ??
      (() => defaultConnectivityCheck(uploadConfig.baseUrl));
    this.onUploadResult = options.onUploadResult;
    this.retryIntervalMs = options.retryIntervalMs ?? 30_000;
  }

  /**
   * Enqueues a photo for upload.
   * - If online: attempt immediate upload; on failure, persist to encrypted local storage.
   * - If offline: persist directly, show offline message.
   *
   * @returns { queued: true } with the offline message if stored locally,
   *          or the upload result if immediately uploaded.
   */
  async enqueue(
    imageBuffer: Buffer,
    filename: string,
    claimId: string
  ): Promise<{ queued: true; message: string; photoId: string } | PhotoUploadResult> {
    const photoId = uuidv4();
    const isOnline = await this.connectivityChecker();

    if (isOnline) {
      const result = await uploadPhoto(
        { imageBuffer, filename, claimId },
        this.uploadConfig
      );
      if (result.status === 'success') {
        this.onUploadResult?.(result);
        return result;
      }
      // Upload failed despite connectivity – queue for retry
    }

    // Store encrypted locally
    storeEncryptedPhoto(
      photoId,
      claimId,
      imageBuffer,
      filename,
      this.storageConfig
    );

    return {
      queued: true,
      message: OFFLINE_MESSAGE,
      photoId,
    };
  }

  /**
   * Processes all pending queued photos.
   * Should be called when the app regains connectivity.
   */
  async processPendingUploads(): Promise<PhotoUploadResult[]> {
    if (this.isProcessing) return [];
    this.isProcessing = true;
    const results: PhotoUploadResult[] = [];

    try {
      const pending = listAllPendingPhotos(this.storageConfig);

      for (const entry of pending) {
        let imageBuffer: Buffer;
        try {
          imageBuffer = loadEncryptedPhoto(entry.photoId, this.storageConfig);
        } catch (err) {
          // Corrupted entry – skip
          continue;
        }

        const result = await uploadPhoto(
          {
            imageBuffer,
            filename: entry.originalFilename,
            claimId: entry.claimId,
          },
          {
            ...this.uploadConfig,
          }
        );

        if (result.status === 'success') {
          // Clean up local encrypted copy after successful upload
          deleteStoredPhoto(entry.photoId, this.storageConfig);
          this.onUploadResult?.(result);
        }

        results.push(result);
      }
    } finally {
      this.isProcessing = false;
    }

    return results;
  }

  /**
   * Starts the periodic retry timer.
   * Call this when the app becomes active / foreground.
   */
  startRetryScheduler(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(async () => {
      const online = await this.connectivityChecker();
      if (online) {
        await this.processPendingUploads();
      }
    }, this.retryIntervalMs);
  }

  /**
   * Stops the retry timer.
   * Call when the app goes to background or the component is unmounted.
   */
  stopRetryScheduler(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  /**
   * Returns the number of photos currently waiting in the local queue.
   */
  pendingCount(): number {
    return listAllPendingPhotos(this.storageConfig).length;
  }
}
