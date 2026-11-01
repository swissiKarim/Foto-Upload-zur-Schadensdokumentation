/**
 * Unit tests – Encrypted Local Storage
 *
 * AC: "Lokal zwischengespeicherte Bilder werden ausschließlich AES-256-verschlüsselt
 *      im App-privaten Bereich abgelegt."
 * AC: "In-App-Kamera-Fotos verbleiben zu keinem Zeitpunkt unverschlüsselt im
 *      öffentlichen Speicherbereich des Smartphones."
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import {
  storeEncryptedPhoto,
  loadEncryptedPhoto,
  deleteStoredPhoto,
  listPendingPhotos,
  listAllPendingPhotos,
  generateKey,
} from '../../src/storage/encryptedLocalStorage';
import { deserialiseEncryptedPayload } from '../../src/encryption/aes256';
import type { StorageConfig } from '../../src/storage/encryptedLocalStorage';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'insurance-photo-test-'));
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('storeEncryptedPhoto', () => {
  let tmpDir: string;
  let config: StorageConfig;

  beforeEach(() => {
    tmpDir = makeTempDir();
    config = { privateStorageDir: tmpDir, encryptionKey: generateKey() };
  });

  afterEach(() => removeDir(tmpDir));

  it('creates an encrypted file in the private directory', () => {
    const buf = Buffer.from('fake-image-data');
    const photoId = uuidv4();
    const entry = storeEncryptedPhoto(photoId, 'claim-1', buf, 'photo.jpg', config);

    expect(entry.photoId).toBe(photoId);
    const filePath = path.join(tmpDir, entry.encryptedFilename);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('stored file is NOT the raw plaintext (it is encrypted)', () => {
    const buf = Buffer.from('sensitive-pixel-data');
    const photoId = uuidv4();
    const entry = storeEncryptedPhoto(photoId, 'claim-1', buf, 'photo.jpg', config);

    const filePath = path.join(tmpDir, entry.encryptedFilename);
    const onDisk = fs.readFileSync(filePath);

    // The on-disk content must not contain the plaintext
    expect(onDisk.includes(buf)).toBe(false);
    // It must be valid encrypted JSON
    expect(() => deserialiseEncryptedPayload(onDisk)).not.toThrow();
  });

  it('stored file uses AES-256-GCM algorithm tag', () => {
    const buf = Buffer.from('image bytes');
    const photoId = uuidv4();
    const entry = storeEncryptedPhoto(photoId, 'claim-1', buf, 'photo.jpg', config);

    const filePath = path.join(tmpDir, entry.encryptedFilename);
    const onDisk = fs.readFileSync(filePath);
    const payload = deserialiseEncryptedPayload(onDisk);
    expect(payload.algorithm).toBe('aes-256-gcm');
  });

  it('creates directory with restrictive permissions (no world-read)', () => {
    const subDir = path.join(tmpDir, 'photos');
    const cfg: StorageConfig = { privateStorageDir: subDir, encryptionKey: generateKey() };
    storeEncryptedPhoto(uuidv4(), 'c1', Buffer.from('x'), 'f.jpg', cfg);

    const stat = fs.statSync(subDir);
    const worldReadable = (stat.mode & 0o004) !== 0;
    expect(worldReadable).toBe(false);
  });

  it('upserts existing entries in the manifest', () => {
    const photoId = uuidv4();
    storeEncryptedPhoto(photoId, 'claim-1', Buffer.from('v1'), 'p.jpg', config);
    storeEncryptedPhoto(photoId, 'claim-1', Buffer.from('v2'), 'p.jpg', config);

    const all = listAllPendingPhotos(config);
    const entries = all.filter((e) => e.photoId === photoId);
    expect(entries).toHaveLength(1);
  });
});

describe('loadEncryptedPhoto', () => {
  let tmpDir: string;
  let config: StorageConfig;

  beforeEach(() => {
    tmpDir = makeTempDir();
    config = { privateStorageDir: tmpDir, encryptionKey: generateKey() };
  });

  afterEach(() => removeDir(tmpDir));

  it('decrypts and returns the original plaintext', () => {
    const original = Buffer.from('original-image-data-🖼️');
    const photoId = uuidv4();
    storeEncryptedPhoto(photoId, 'claim-1', original, 'photo.jpg', config);

    const loaded = loadEncryptedPhoto(photoId, config);
    expect(loaded.equals(original)).toBe(true);
  });

  it('throws when photoId is not found', () => {
    expect(() => loadEncryptedPhoto(uuidv4(), config)).toThrow(/No stored photo/);
  });

  it('throws when decrypted with wrong key', () => {
    const photoId = uuidv4();
    storeEncryptedPhoto(photoId, 'claim-1', Buffer.from('secret'), 'photo.jpg', config);

    const wrongConfig: StorageConfig = {
      privateStorageDir: tmpDir,
      encryptionKey: generateKey(), // different key
    };
    expect(() => loadEncryptedPhoto(photoId, wrongConfig)).toThrow();
  });
});

describe('deleteStoredPhoto', () => {
  let tmpDir: string;
  let config: StorageConfig;

  beforeEach(() => {
    tmpDir = makeTempDir();
    config = { privateStorageDir: tmpDir, encryptionKey: generateKey() };
  });

  afterEach(() => removeDir(tmpDir));

  it('removes the encrypted file from disk', () => {
    const photoId = uuidv4();
    const entry = storeEncryptedPhoto(photoId, 'c1', Buffer.from('x'), 'f.jpg', config);
    const filePath = path.join(tmpDir, entry.encryptedFilename);

    deleteStoredPhoto(photoId, config);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('removes the entry from the manifest', () => {
    const photoId = uuidv4();
    storeEncryptedPhoto(photoId, 'c1', Buffer.from('x'), 'f.jpg', config);
    deleteStoredPhoto(photoId, config);

    const all = listAllPendingPhotos(config);
    expect(all.find((e) => e.photoId === photoId)).toBeUndefined();
  });

  it('does not throw when photoId does not exist', () => {
    expect(() => deleteStoredPhoto(uuidv4(), config)).not.toThrow();
  });
});

describe('listPendingPhotos / listAllPendingPhotos', () => {
  let tmpDir: string;
  let config: StorageConfig;

  beforeEach(() => {
    tmpDir = makeTempDir();
    config = { privateStorageDir: tmpDir, encryptionKey: generateKey() };
  });

  afterEach(() => removeDir(tmpDir));

  it('listPendingPhotos returns only photos for the given claimId', () => {
    storeEncryptedPhoto(uuidv4(), 'claim-A', Buffer.from('1'), 'a.jpg', config);
    storeEncryptedPhoto(uuidv4(), 'claim-A', Buffer.from('2'), 'b.jpg', config);
    storeEncryptedPhoto(uuidv4(), 'claim-B', Buffer.from('3'), 'c.jpg', config);

    const forA = listPendingPhotos('claim-A', config);
    expect(forA).toHaveLength(2);
    expect(forA.every((e) => e.claimId === 'claim-A')).toBe(true);
  });

  it('listAllPendingPhotos returns photos across all claims', () => {
    storeEncryptedPhoto(uuidv4(), 'claim-A', Buffer.from('1'), 'a.jpg', config);
    storeEncryptedPhoto(uuidv4(), 'claim-B', Buffer.from('2'), 'b.jpg', config);

    const all = listAllPendingPhotos(config);
    expect(all).toHaveLength(2);
  });

  it('returns empty array when no photos are stored', () => {
    expect(listAllPendingPhotos(config)).toHaveLength(0);
  });
});
