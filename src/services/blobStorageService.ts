/**
 * BlobStorageService – abstraction over encrypted EU blob storage.
 *
 * Production implementation must:
 *  - Use AES-256 encryption at rest (AC1)
 *  - Store data exclusively in EU regions (DSGVO / AC1)
 *  - Transmit data exclusively over TLS 1.3 (brief requirement)
 *
 * This implementation is an in-memory stub suitable for integration tests.
 * Swap `InMemoryBlobStorageService` for a real Azure Blob / S3-compatible
 * implementation behind the same interface in production.
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface BlobStorageService {
  /**
   * Store encrypted bytes and return a storage key.
   * The key uniquely identifies the object in the EU blob storage.
   */
  store(key: string, data: Buffer): Promise<void>;

  /**
   * Retrieve and decrypt bytes by storage key.
   */
  retrieve(key: string): Promise<Buffer>;

  /**
   * Permanently delete a blob – fulfils Art. 17 DSGVO (AC3).
   * Must remove ALL copies including backups within the agreed retention window.
   */
  delete(key: string): Promise<void>;

  /** Check whether a blob exists */
  exists(key: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// AES-256-GCM helper (simulates at-rest encryption; key derived from env)
// ---------------------------------------------------------------------------

const AES_KEY_HEX =
  process.env.BLOB_ENCRYPTION_KEY_HEX ||
  'a'.repeat(64); // 32-byte key as 64 hex chars – MUST be overridden in production

function getEncryptionKey(): Buffer {
  const hex = AES_KEY_HEX;
  if (hex.length !== 64) {
    throw new Error('BLOB_ENCRYPTION_KEY_HEX must be exactly 64 hex characters (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptAES256GCM(plaintext: Buffer): Buffer {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16-byte auth tag
  // Layout: [IV (12)] [authTag (16)] [ciphertext]
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptAES256GCM(blob: Buffer): Buffer {
  const key = getEncryptionKey();
  const iv = blob.subarray(0, 12);
  const authTag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ---------------------------------------------------------------------------
// In-memory implementation (test / local)
// ---------------------------------------------------------------------------

export class InMemoryBlobStorageService implements BlobStorageService {
  /** Stores encrypted blobs keyed by storage key */
  private readonly store_: Map<string, Buffer> = new Map();

  async store(key: string, data: Buffer): Promise<void> {
    const encrypted = encryptAES256GCM(data);
    this.store_.set(key, encrypted);
  }

  async retrieve(key: string): Promise<Buffer> {
    const blob = this.store_.get(key);
    if (!blob) throw new Error(`Blob not found: ${key}`);
    return decryptAES256GCM(blob);
  }

  async delete(key: string): Promise<void> {
    // Permanent deletion – no soft-delete, fulfils Art. 17 DSGVO (AC3)
    this.store_.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store_.has(key);
  }

  /** For testing: raw access to verify encryption */
  getRawBlob(key: string): Buffer | undefined {
    return this.store_.get(key);
  }
}
