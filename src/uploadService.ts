/**
 * UploadService – orchestrates the offline queue, network monitoring,
 * exponential back-off retries, and success/failure notifications.
 *
 * Acceptance criteria addressed:
 *  - AC1  : images stored in AES-256-encrypted SQLite queue when offline
 *  - AC2  : offline message shown via onOfflineMessage callback
 *  - AC3  : upload starts automatically when network restored
 *  - AC4  : visual confirmation callback after successful upload
 *  - AC5  : pending jobs recovered and continued after app restart
 *  - AC6  : exponential backoff on 5xx / timeout errors
 *  - AC7  : atomic writes (better-sqlite3 WAL mode) prevent data loss on crash
 *  - AC8  : E2E scenario covered by integration test
 */

import { UploadQueue } from "./queue";
import { NetworkMonitor } from "./networkMonitor";
import { EventEmitter } from "events";

export interface UploadServiceOptions {
  queue: UploadQueue;
  networkMonitor: NetworkMonitor;

  /** HTTP uploader – injectable for testing. */
  uploader: ImageUploader;

  /** Max retry attempts before marking a job 'failed'. Default 5. */
  maxAttempts?: number;

  /** Base delay (ms) for exponential back-off. Default 1000. */
  backoffBaseMs?: number;

  /** Max back-off delay cap (ms). Default 30 000. */
  backoffMaxMs?: number;

  /** Called when the device goes offline with the required UI message. */
  onOfflineMessage?: (message: string) => void;

  /** Called after every successful individual upload. */
  onUploadSuccess?: (jobId: string, claimId: string) => void;

  /** Called when all pending jobs have been uploaded. */
  onAllUploaded?: (claimId: string) => void;

  /** Called on permanent failure (exhausted retries). */
  onUploadFailed?: (jobId: string, claimId: string) => void;
}

export interface UploadResult {
  success: boolean;
  /** HTTP status code, if a response was received. */
  statusCode?: number;
  error?: Error;
}

export type ImageUploader = (
  claimId: string,
  imageData: Buffer
) => Promise<UploadResult>;

export const OFFLINE_MESSAGE =
  "Keine Internetverbindung. Die Bilder werden hochgeladen, sobald Du wieder online bist.";

export class UploadService extends EventEmitter {
  private queue: UploadQueue;
  private monitor: NetworkMonitor;
  private uploader: ImageUploader;
  private maxAttempts: number;
  private backoffBaseMs: number;
  private backoffMaxMs: number;
  private onOfflineMessage?: (msg: string) => void;
  private onUploadSuccess?: (jobId: string, claimId: string) => void;
  private onAllUploaded?: (claimId: string) => void;
  private onUploadFailed?: (jobId: string, claimId: string) => void;
  private _processing: boolean = false;

  constructor(options: UploadServiceOptions) {
    super();
    this.queue = options.queue;
    this.monitor = options.networkMonitor;
    this.uploader = options.uploader;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.backoffBaseMs = options.backoffBaseMs ?? 1000;
    this.backoffMaxMs = options.backoffMaxMs ?? 30_000;
    this.onOfflineMessage = options.onOfflineMessage;
    this.onUploadSuccess = options.onUploadSuccess;
    this.onAllUploaded = options.onAllUploaded;
    this.onUploadFailed = options.onUploadFailed;
  }

  /**
   * Call once at app start. Recovers stuck jobs, then wires up network events.
   * AC5: restores pending upload jobs after app restart.
   */
  initialize(): void {
    // AC5 + AC7: recover jobs that were 'uploading' when the app crashed
    const recovered = this.queue.recoverStuckJobs();
    if (recovered > 0) {
      this.emit("recovered", recovered);
    }

    // AC3: start processing immediately if already online
    if (this.monitor.isOnline) {
      this._processQueue();
    }

    // AC3: start processing when network comes back
    this.monitor.on("online", () => {
      this._processQueue();
    });

    // AC2: show offline message when network is lost
    this.monitor.on("offline", () => {
      if (this.queue.count("pending") > 0 || this.queue.count("uploading") > 0) {
        const msg = OFFLINE_MESSAGE;
        this.onOfflineMessage?.(msg);
        this.emit("offlineMessage", msg);
      }
    });
  }

  /**
   * Enqueue an image for upload.
   * If online, starts processing immediately.
   * If offline, stores encrypted in SQLite and shows the offline message. AC1, AC2.
   *
   * Returns the job id.
   */
  enqueueImage(claimId: string, imageData: Buffer): string {
    const jobId = this.queue.enqueue(claimId, imageData);

    if (!this.monitor.isOnline) {
      // AC2: display the mandatory offline message
      const msg = OFFLINE_MESSAGE;
      this.onOfflineMessage?.(msg);
      this.emit("offlineMessage", msg);
    } else {
      // AC3: immediately attempt upload if we are online
      this._processQueue();
    }

    return jobId;
  }

  /**
   * Process all pending jobs in the queue.
   * Serialises uploads (one at a time) for simplicity and crash-safety.
   * Each job handles its own retry loop internally – no re-queuing into
   * the outer loop until the job is fully resolved (done or failed).
   */
  private async _processQueue(): Promise<void> {
    if (this._processing) return;
    this._processing = true;
    try {
      while (this.monitor.isOnline) {
        const jobs = this.queue.getPendingJobs();
        if (jobs.length === 0) break;

        for (const job of jobs) {
          if (!this.monitor.isOnline) break;
          // _uploadWithBackoff handles ALL retries internally before returning
          await this._uploadWithBackoff(job.id, job.claimId, job.imageData);
        }
      }
    } finally {
      this._processing = false;
    }
  }

  /**
   * Upload a single job, applying exponential back-off on transient errors.
   * AC6: 5xx / timeout → retry with exponential delay up to maxAttempts.
   * AC7: status transitions are atomic SQLite writes.
   *
   * All retry attempts are handled here; the job does NOT re-enter the
   * pending state between retries, preventing double-counting by _processQueue.
   */
  private async _uploadWithBackoff(
    jobId: string,
    claimId: string,
    imageData: Buffer
  ): Promise<void> {
    // Atomic: mark as uploading so a concurrent process won't double-upload
    this.queue.markUploading(jobId);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const result = await this.uploader(claimId, imageData);

        if (result.success) {
          // AC7: atomic write – mark done
          this.queue.markDone(jobId);
          // AC4: visual confirmation callback
          this.onUploadSuccess?.(jobId, claimId);
          this.emit("uploadSuccess", { jobId, claimId });

          // Check if all jobs for this claim are now done
          const remaining = this.queue
            .getPendingJobs()
            .filter((j) => j.claimId === claimId).length;
          if (remaining === 0) {
            this.onAllUploaded?.(claimId);
            this.emit("allUploaded", claimId);
          }
          return;
        }

        // Non-transient failure (4xx etc.) – give up immediately, no retry
        if (!this._isTransient(result)) {
          this._markJobFailed(jobId, claimId);
          return;
        }

        // AC6: transient server error (5xx) – apply back-off unless last attempt
        if (attempt < this.maxAttempts) {
          await this._sleep(this._backoffDelay(attempt));
        } else {
          // Exhausted all attempts
          this._markJobFailed(jobId, claimId);
        }
      } catch (_err) {
        // Network-level error / timeout – treat as transient
        if (attempt < this.maxAttempts) {
          await this._sleep(this._backoffDelay(attempt));
        } else {
          this._markJobFailed(jobId, claimId);
        }
      }
    }
  }

  private _markJobFailed(jobId: string, claimId: string): void {
    // Mark directly as failed (exhausted all retries)
    this.queue.markRetry(jobId, 0); // maxAttempts=0 forces 'failed' status immediately
    this.onUploadFailed?.(jobId, claimId);
    this.emit("uploadFailed", { jobId, claimId, permanent: true });
  }

  /** Compute exponential back-off delay with jitter. */
  private _backoffDelay(attempt: number): number {
    const exp = Math.min(
      this.backoffBaseMs * Math.pow(2, attempt - 1),
      this.backoffMaxMs
    );
    // Add up to 20% jitter
    return exp + Math.random() * exp * 0.2;
  }

  private _isTransient(result: UploadResult): boolean {
    if (!result.statusCode) return true; // network error / timeout
    return result.statusCode >= 500 && result.statusCode < 600;
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
