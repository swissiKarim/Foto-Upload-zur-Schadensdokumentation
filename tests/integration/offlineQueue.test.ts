/**
 * Integration tests – Offline Queue
 *
 * AC: "Bei fehlender Internetverbindung müssen die Fotos lokal zwischengespeichert
 *      und automatisch hochgeladen werden, sobald die Verbindung wieder verfügbar ist."
 * AC: Offline message: "Keine Internetverbindung. Die Bilder werden hochgeladen,
 *      sobald Du wieder online bist."
 * AC: "Lokal zwischengespeicherte Bilder werden ausschließlich AES-256-verschlüsselt
 *      im App-privaten Bereich abgelegt."
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as net from 'net';
import sharp from 'sharp';
import { OfflinePhotoQueue, OFFLINE_MESSAGE } from '../../src/offline/offlineQueue';
import { listAllPendingPhotos, generateKey } from '../../src/storage/encryptedLocalStorage';
import type { StorageConfig } from '../../src/storage/encryptedLocalStorage';
import type { UploadConfig } from '../../src/upload/photoUploadService';
import { TEST_CERT, TEST_KEY, TEST_SPKI_PIN } from '../fixtures/tlsCerts';

async function makeJpegBuffer(w = 100, h = 100): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 80, g: 120, b: 200 } },
  }).jpeg({ quality: 70 }).toBuffer();
}

async function startServer(
  status: number
): Promise<{ server: https.Server; port: number; pin: string }> {
  const server = https.createServer(
    { cert: TEST_CERT, key: TEST_KEY, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' },
    (_req, res) => {
      res.writeHead(status);
      res.end(JSON.stringify({ photoId: 'srv-id' }));
    }
  );
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as net.AddressInfo).port)
    );
    server.on('error', reject);
  });
  return { server, port, pin: TEST_SPKI_PIN };
}

// ─── Offline storage ──────────────────────────────────────────────────────────

describe('OfflinePhotoQueue – offline storage', () => {
  let tmpDir: string;
  let storageConfig: StorageConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-queue-test-'));
    storageConfig = { privateStorageDir: tmpDir, encryptionKey: generateKey() };
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('returns the offline message when connectivity checker reports offline', async () => {
    const uploadConfig: UploadConfig = {
      baseUrl: 'https://api.insurance.example.com',
      authToken: 'token',
      pinnedCertificates: ['pin=='],
    };
    const queue = new OfflinePhotoQueue(storageConfig, uploadConfig, {
      connectivityChecker: async () => false,
    });

    const result = await queue.enqueue(await makeJpegBuffer(), 'photo.jpg', 'claim-1');

    expect('queued' in result && result.queued).toBe(true);
    if ('queued' in result) {
      expect(result.message).toBe(OFFLINE_MESSAGE);
      expect(result.photoId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/i);
    }
  });

  it('stores the photo encrypted locally when offline', async () => {
    const uploadConfig: UploadConfig = {
      baseUrl: 'https://api.insurance.example.com',
      authToken: 'token',
      pinnedCertificates: ['pin=='],
    };
    const queue = new OfflinePhotoQueue(storageConfig, uploadConfig, {
      connectivityChecker: async () => false,
    });

    await queue.enqueue(await makeJpegBuffer(), 'photo.jpg', 'claim-1');

    const pending = listAllPendingPhotos(storageConfig);
    expect(pending).toHaveLength(1);
    expect(pending[0].claimId).toBe('claim-1');
  });

  it('pending count increments per enqueued photo', async () => {
    const uploadConfig: UploadConfig = {
      baseUrl: 'https://api.insurance.example.com',
      authToken: 'token',
      pinnedCertificates: ['pin=='],
    };
    const queue = new OfflinePhotoQueue(storageConfig, uploadConfig, {
      connectivityChecker: async () => false,
    });

    expect(queue.pendingCount()).toBe(0);
    await queue.enqueue(await makeJpegBuffer(), 'a.jpg', 'claim-1');
    expect(queue.pendingCount()).toBe(1);
    await queue.enqueue(await makeJpegBuffer(), 'b.jpg', 'claim-1');
    expect(queue.pendingCount()).toBe(2);
  });

  it('stored file is encrypted (not plaintext) on disk', async () => {
    const uploadConfig: UploadConfig = {
      baseUrl: 'https://api.insurance.example.com',
      authToken: 'token',
      pinnedCertificates: ['pin=='],
    };
    const queue = new OfflinePhotoQueue(storageConfig, uploadConfig, {
      connectivityChecker: async () => false,
    });

    const imageBuffer = await makeJpegBuffer();
    await queue.enqueue(imageBuffer, 'photo.jpg', 'claim-1');

    const pending = listAllPendingPhotos(storageConfig);
    const filePath = path.join(tmpDir, pending[0].encryptedFilename);
    const onDisk = fs.readFileSync(filePath);

    // Must not contain raw JPEG magic bytes (FF D8 FF) unencrypted
    expect(onDisk.includes(imageBuffer.slice(0, 3))).toBe(false);
    // Must be valid JSON envelope (our encrypted payload format)
    expect(() => JSON.parse(onDisk.toString('utf8'))).not.toThrow();
  });
});

// ─── Auto-upload on reconnect ─────────────────────────────────────────────────

describe('OfflinePhotoQueue – auto-upload on reconnect', () => {
  let tmpDir: string;
  let storageConfig: StorageConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-retry-test-'));
    storageConfig = { privateStorageDir: tmpDir, encryptionKey: generateKey() };
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('uploads pending photos when processPendingUploads is called while online', async () => {
    const { server, port, pin } = await startServer(201);
    try {
      const uploadConfig: UploadConfig = {
        baseUrl: `https://127.0.0.1:${port}`,
        authToken: 'token',
        pinnedCertificates: [pin],
        _testCaCert: TEST_CERT,
      };

      const queue = new OfflinePhotoQueue(storageConfig, uploadConfig, {
        connectivityChecker: async () => false,
      });

      await queue.enqueue(await makeJpegBuffer(), 'photo.jpg', 'claim-2');
      expect(queue.pendingCount()).toBe(1);

      const results = await queue.processPendingUploads();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
      expect(results[0].httpStatus).toBe(201);
      // Local encrypted copy should be deleted after successful upload
      expect(queue.pendingCount()).toBe(0);
    } finally {
      server.close();
    }
  });

  it('calls onUploadResult callback after successful deferred upload', async () => {
    const { server, port, pin } = await startServer(201);
    try {
      const uploadConfig: UploadConfig = {
        baseUrl: `https://127.0.0.1:${port}`,
        authToken: 'token',
        pinnedCertificates: [pin],
        _testCaCert: TEST_CERT,
      };

      const callbackResults: string[] = [];
      const queue = new OfflinePhotoQueue(storageConfig, uploadConfig, {
        connectivityChecker: async () => false,
        onUploadResult: (r) => callbackResults.push(r.status),
      });

      await queue.enqueue(await makeJpegBuffer(), 'photo.jpg', 'claim-3');
      await queue.processPendingUploads();

      expect(callbackResults).toContain('success');
    } finally {
      server.close();
    }
  });

  it('keeps photo in queue when upload fails during processing', async () => {
    const uploadConfig: UploadConfig = {
      baseUrl: 'https://127.0.0.1:19999', // no server running
      authToken: 'token',
      pinnedCertificates: ['anypin=='],
    };

    const queue = new OfflinePhotoQueue(storageConfig, uploadConfig, {
      connectivityChecker: async () => false,
    });

    await queue.enqueue(await makeJpegBuffer(), 'photo.jpg', 'claim-4');
    expect(queue.pendingCount()).toBe(1);

    await queue.processPendingUploads();

    // Still in queue because upload failed
    expect(queue.pendingCount()).toBe(1);
  });
});

// ─── OFFLINE_MESSAGE constant ─────────────────────────────────────────────────

describe('OFFLINE_MESSAGE constant', () => {
  it('matches the specified German offline message exactly', () => {
    expect(OFFLINE_MESSAGE).toBe(
      'Keine Internetverbindung. Die Bilder werden hochgeladen, sobald Du wieder online bist.'
    );
  });
});
