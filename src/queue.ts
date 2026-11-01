/**
 * Persistent, AES-256-encrypted upload queue backed by SQLite (better-sqlite3).
 *
 * Schema
 * ------
 * TABLE upload_queue
 *   id          TEXT PRIMARY KEY   – UUID
 *   claim_id    TEXT NOT NULL      – damage-report identifier
 *   payload     BLOB NOT NULL      – AES-256-GCM encrypted image bytes
 *   status      TEXT NOT NULL      – 'pending' | 'uploading' | 'done' | 'failed'
 *   attempts    INTEGER NOT NULL   – retry counter
 *   created_at  INTEGER NOT NULL   – Unix ms
 *   updated_at  INTEGER NOT NULL   – Unix ms
 */

import Database, { Database as DB } from "better-sqlite3";
import { encrypt, decrypt, deriveKey } from "./crypto";
import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs";

export type JobStatus = "pending" | "uploading" | "done" | "failed";

export interface UploadJob {
  id: string;
  claimId: string;
  imageData: Buffer;   // decrypted in-memory
  status: JobStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface QueueOptions {
  dbPath: string;
  encryptionKey: string; // passphrase; key is derived via SHA-256
}

export class UploadQueue {
  private db: DB;
  private key: Buffer;

  constructor(options: QueueOptions) {
    // Ensure parent directory exists
    const dir = path.dirname(options.dbPath);
    if (dir && dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(options.dbPath);
    this.key = deriveKey(options.encryptionKey);
    this._initSchema();
  }

  private _initSchema(): void {
    // WAL mode for crash-safety; foreign_keys for integrity
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS upload_queue (
        id         TEXT    PRIMARY KEY,
        claim_id   TEXT    NOT NULL,
        payload    BLOB    NOT NULL,
        status     TEXT    NOT NULL DEFAULT 'pending',
        attempts   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_status ON upload_queue(status);
    `);
  }

  /** Add a new image to the queue atomically. Returns the new job id. */
  enqueue(claimId: string, imageData: Buffer): string {
    const id = randomUUID();
    const now = Date.now();
    const encryptedPayload = encrypt(imageData, this.key);

    // Atomic insert – either fully written or not at all
    const stmt = this.db.prepare(`
      INSERT INTO upload_queue (id, claim_id, payload, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', 0, ?, ?)
    `);
    stmt.run(id, claimId, encryptedPayload, now, now);
    return id;
  }

  /** Return all jobs with the given status, decrypted. */
  getByStatus(status: JobStatus): UploadJob[] {
    const rows = this.db
      .prepare("SELECT * FROM upload_queue WHERE status = ? ORDER BY created_at ASC")
      .all(status) as any[];
    return rows.map((r) => this._rowToJob(r));
  }

  /** Return all pending + failed (for restart recovery). */
  getPendingJobs(): UploadJob[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM upload_queue WHERE status IN ('pending','uploading') ORDER BY created_at ASC"
      )
      .all() as any[];
    return rows.map((r) => this._rowToJob(r));
  }

  /** Atomically mark a job as 'uploading' (prevents double-processing). */
  markUploading(id: string): void {
    this.db
      .prepare("UPDATE upload_queue SET status='uploading', updated_at=? WHERE id=? AND status='pending'")
      .run(Date.now(), id);
  }

  /** Mark a job as successfully uploaded. */
  markDone(id: string): void {
    this.db
      .prepare("UPDATE upload_queue SET status='done', updated_at=? WHERE id=?")
      .run(Date.now(), id);
  }

  /** Increment retry counter and revert to pending or mark failed.
   *  Pass maxAttempts=0 to force immediate 'failed' status.
   */
  markRetry(id: string, maxAttempts: number): void {
    const row = this.db.prepare("SELECT attempts FROM upload_queue WHERE id=?").get(id) as
      | { attempts: number }
      | undefined;
    if (!row) return;

    const newAttempts = row.attempts + 1;
    // maxAttempts=0 means "force failed"; otherwise failed when attempts >= max
    const newStatus: JobStatus =
      maxAttempts === 0 || newAttempts >= maxAttempts ? "failed" : "pending";
    this.db
      .prepare("UPDATE upload_queue SET status=?, attempts=?, updated_at=? WHERE id=?")
      .run(newStatus, newAttempts, Date.now(), id);
  }

  /** Reset 'uploading' jobs back to 'pending' (crash recovery on restart). */
  recoverStuckJobs(): number {
    const result = this.db
      .prepare("UPDATE upload_queue SET status='pending', updated_at=? WHERE status='uploading'")
      .run(Date.now());
    return result.changes;
  }

  /** Delete a job by id. */
  remove(id: string): void {
    this.db.prepare("DELETE FROM upload_queue WHERE id=?").run(id);
  }

  /** Count jobs by status. */
  count(status?: JobStatus): number {
    if (status) {
      const row = this.db
        .prepare("SELECT COUNT(*) as c FROM upload_queue WHERE status=?")
        .get(status) as { c: number };
      return row.c;
    }
    const row = this.db
      .prepare("SELECT COUNT(*) as c FROM upload_queue")
      .get() as { c: number };
    return row.c;
  }

  /** Close DB connection (for tests / cleanup). */
  close(): void {
    this.db.close();
  }

  private _rowToJob(row: any): UploadJob {
    const decrypted = decrypt(Buffer.from(row.payload), this.key);
    return {
      id: row.id,
      claimId: row.claim_id,
      imageData: decrypted,
      status: row.status as JobStatus,
      attempts: row.attempts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
