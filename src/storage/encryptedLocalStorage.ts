/**
 * Encrypted Local Storage
 *
 * Writes and reads image buffers encrypted with AES-256-GCM in the
 * app-private directory. The public storage area is never touched.
 *
 * AC: "Lokal zwischengespeicherte Bilder werden ausschließlich AES-256-verschlüsselt
 *      im App-privaten Bereich abgelegt."
 * AC: "In-App-Kamera-Fotos verbleiben zu keinem Zeitpunkt unverschlüsselt im
 *      öffentlichen Speicherbereich des Smartphones."
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  encryptBuffer,
  decryptBuffer,
  generateKey,
  serialiseEncryptedPayload,
  deserialiseEncryptedPayload,
} from '../encryption/aes256';

export interface StorageConfig {
  /**
   * Absolute path to the app-private storage directory.
   * On Android this maps to getFilesDir(); on iOS to the app's Documents/Library dir.
   * Must NOT be a publicly accessible location.
   */
  privateStorageDir: string;
  /** AES-256 key (32 bytes). Caller is responsible for secure key management. */
  encryptionKey: Buffer;
}

export interface StoredPhotoEntry {
  photoId: string;
  claimId: string;
  /** Relative filename inside privateStorageDir */
  encryptedFilename: string;
  storedAt: string; // ISO 8601
  originalFilename: string;
}

const MANIFEST_FILENAME = 'photo_manifest.json';

/**
 * Ensures the private storage directory exists.
 * Sets permissions to 0700 (owner-only) to prevent other apps from reading files.
 */
function ensurePrivateDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Reads the manifest of stored photos. Returns an empty array if none exists.
 */
function readManifest(dir: string): StoredPhotoEntry[] {
  const manifestPath = path.join(dir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as StoredPhotoEntry[];
  } catch {
    return [];
  }
}

/**
 * Persists the manifest atomically (write-to-temp + rename).
 */
function writeManifest(dir: string, entries: StoredPhotoEntry[]): void {
  const manifestPath = path.join(dir, MANIFEST_FILENAME);
  const tmpPath = manifestPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, manifestPath);
}

/**
 * Encrypts a raw image buffer and writes it to the app-private directory.
 * The file is NEVER written unencrypted to disk.
 *
 * @returns The storage entry metadata.
 */
export function storeEncryptedPhoto(
  photoId: string,
  claimId: string,
  imageBuffer: Buffer,
  originalFilename: string,
  config: StorageConfig
): StoredPhotoEntry {
  ensurePrivateDir(config.privateStorageDir);

  // Encrypt in memory – plaintext never touches the filesystem
  const encrypted = encryptBuffer(imageBuffer, config.encryptionKey);
  const serialised = serialiseEncryptedPayload(encrypted);

  const encryptedFilename = `${photoId}.enc`;
  const filePath = path.join(config.privateStorageDir, encryptedFilename);

  // Write with restrictive permissions (owner r/w only)
  fs.writeFileSync(filePath, serialised, { mode: 0o600 });

  const entry: StoredPhotoEntry = {
    photoId,
    claimId,
    encryptedFilename,
    storedAt: new Date().toISOString(),
    originalFilename,
  };

  const manifest = readManifest(config.privateStorageDir);
  // Upsert: replace existing entry with same photoId if present
  const idx = manifest.findIndex((e) => e.photoId === photoId);
  if (idx >= 0) {
    manifest[idx] = entry;
  } else {
    manifest.push(entry);
  }
  writeManifest(config.privateStorageDir, manifest);

  return entry;
}

/**
 * Reads and decrypts a stored photo by photoId.
 * Throws if the file is missing or the ciphertext is corrupt/tampered.
 */
export function loadEncryptedPhoto(
  photoId: string,
  config: StorageConfig
): Buffer {
  const manifest = readManifest(config.privateStorageDir);
  const entry = manifest.find((e) => e.photoId === photoId);
  if (!entry) {
    throw new Error(`No stored photo found for photoId: ${photoId}`);
  }

  const filePath = path.join(config.privateStorageDir, entry.encryptedFilename);
  const raw = fs.readFileSync(filePath);
  const payload = deserialiseEncryptedPayload(raw);
  return decryptBuffer(payload, config.encryptionKey);
}

/**
 * Removes a stored photo and its manifest entry after a successful upload.
 */
export function deleteStoredPhoto(
  photoId: string,
  config: StorageConfig
): void {
  const manifest = readManifest(config.privateStorageDir);
  const entry = manifest.find((e) => e.photoId === photoId);
  if (entry) {
    const filePath = path.join(config.privateStorageDir, entry.encryptedFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  const updated = manifest.filter((e) => e.photoId !== photoId);
  writeManifest(config.privateStorageDir, updated);
}

/**
 * Lists all pending (stored but not yet uploaded) photo entries for a claim.
 */
export function listPendingPhotos(
  claimId: string,
  config: StorageConfig
): StoredPhotoEntry[] {
  return readManifest(config.privateStorageDir).filter(
    (e) => e.claimId === claimId
  );
}

/**
 * Lists ALL pending photo entries across all claims.
 */
export function listAllPendingPhotos(config: StorageConfig): StoredPhotoEntry[] {
  return readManifest(config.privateStorageDir);
}

/**
 * Generates a new AES-256 key. Expose so callers can create and store keys
 * via the platform secure keystore (iOS Keychain / Android Keystore).
 */
export { generateKey };
