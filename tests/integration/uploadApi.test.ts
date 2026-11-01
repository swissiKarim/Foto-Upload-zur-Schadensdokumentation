/**
 * Integration tests – Upload API
 *
 * AC: "Integrationstests prüfen TLS-1.3-Erzwingung, Komprimierungsverhalten
 *      und erfolgreiche HTTP-201-Antwort der Upload-API."
 * AC: "Die Übertragung erfolgt ausschließlich über HTTPS mit TLS 1.3."
 * AC: "Jedes Bild erhält eine clientseitig generierte UUID zur Idempotenz-Sicherung."
 * AC: "Nach erfolgreichem Upload zeigt die App eine direkte visuelle Bestätigung."
 * AC: "Certificate Pinning ist implementiert."
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as net from 'net';
import sharp from 'sharp';
import { uploadPhoto } from '../../src/upload/photoUploadService';
import { compressImage } from '../../src/compression/imageCompressor';
import type { UploadConfig } from '../../src/upload/photoUploadService';
import { TEST_CERT, TEST_KEY, TEST_SPKI_PIN, makeSpkiPin } from '../fixtures/tlsCerts';

// ─── Test server helper ───────────────────────────────────────────────────────

interface TestServer {
  server: https.Server;
  port: number;
  lastRequest: {
    method: string;
    path: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  } | null;
}

async function startTls13TestServer(
  responseStatus = 201,
  responseBody = JSON.stringify({ photoId: 'server-photo-uuid-123' })
): Promise<TestServer> {
  const state: TestServer = { server: null as any, port: 0, lastRequest: null };

  state.server = https.createServer(
    { cert: TEST_CERT, key: TEST_KEY, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' },
    (req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        state.lastRequest = {
          method: req.method ?? '',
          path: req.url ?? '',
          headers: req.headers,
          body,
        };
        res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
        res.end(responseBody);
      });
    }
  );

  state.port = await new Promise<number>((resolve, reject) => {
    state.server.listen(0, '127.0.0.1', () =>
      resolve((state.server.address() as net.AddressInfo).port)
    );
    state.server.on('error', reject);
  });

  return state;
}

// ─── Image helper ─────────────────────────────────────────────────────────────

async function makeJpegBuffer(w = 200, h = 150): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 100, g: 150, b: 200 } },
  }).jpeg({ quality: 80 }).toBuffer();
}

// ─── HTTP-201 success ─────────────────────────────────────────────────────────

describe('Upload API – HTTP 201 success', () => {
  let ts: TestServer;

  beforeAll(async () => { ts = await startTls13TestServer(201); });
  afterAll(() => ts.server.close());

  const cfg = (): UploadConfig => ({
    baseUrl: `https://127.0.0.1:${ts.port}`,
    authToken: 'test-bearer-token',
    pinnedCertificates: [TEST_SPKI_PIN],
    _testCaCert: TEST_CERT,
  });

  it('returns status=success and HTTP 201 for a valid JPEG upload', async () => {
    const result = await uploadPhoto(
      { imageBuffer: await makeJpegBuffer(), filename: 'damage.jpg', claimId: 'claim-001' },
      cfg()
    );
    expect(result.status).toBe('success');
    expect(result.httpStatus).toBe(201);
    expect(result.showSuccessConfirmation).toBe(true);
  });

  it('sends request to POST /claims/{claimId}/photos', async () => {
    await uploadPhoto(
      { imageBuffer: await makeJpegBuffer(), filename: 'damage.jpg', claimId: 'claim-42' },
      cfg()
    );
    expect(ts.lastRequest?.method).toBe('POST');
    expect(ts.lastRequest?.path).toBe('/claims/claim-42/photos');
  });

  it('includes X-Photo-Id UUID header (idempotency key)', async () => {
    const result = await uploadPhoto(
      { imageBuffer: await makeJpegBuffer(), filename: 'damage.jpg', claimId: 'claim-001' },
      cfg()
    );
    // UUID v4 pattern
    expect(result.photoId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(ts.lastRequest?.headers['x-photo-id']).toBe(result.photoId);
  });

  it('includes Authorization Bearer token', async () => {
    await uploadPhoto(
      { imageBuffer: await makeJpegBuffer(), filename: 'damage.jpg', claimId: 'claim-001' },
      { ...cfg(), authToken: 'super-secret-token', _testCaCert: TEST_CERT }
    );
    expect(ts.lastRequest?.headers['authorization']).toBe('Bearer super-secret-token');
  });

  it('each upload generates a unique UUID (idempotency – no duplicates)', async () => {
    const r1 = await uploadPhoto({ imageBuffer: await makeJpegBuffer(), filename: 'a.jpg', claimId: 'c1' }, cfg());
    const r2 = await uploadPhoto({ imageBuffer: await makeJpegBuffer(), filename: 'b.jpg', claimId: 'c1' }, cfg());
    expect(r1.photoId).not.toBe(r2.photoId);
  });

  it('compresses the image before upload (compressionRatio ≤ 1)', async () => {
    const result = await uploadPhoto(
      { imageBuffer: await makeJpegBuffer(1920, 1080), filename: 'hd.jpg', claimId: 'c1' },
      cfg()
    );
    expect(result.status).toBe('success');
    expect(result.compressionRatio).toBeDefined();
    expect(result.compressionRatio!).toBeLessThanOrEqual(1);
  });

  it('showSuccessConfirmation is true on HTTP 201 (visual confirmation AC)', async () => {
    const result = await uploadPhoto(
      { imageBuffer: await makeJpegBuffer(), filename: 'photo.jpg', claimId: 'c1' },
      cfg()
    );
    expect(result.showSuccessConfirmation).toBe(true);
  });
});

// ─── TLS 1.3 enforcement ─────────────────────────────────────────────────────

describe('Upload API – TLS 1.3 enforcement', () => {
  it('fails when server only offers TLS 1.2 (client requires TLS 1.3)', async () => {
    const tls12Server = https.createServer(
      { cert: TEST_CERT, key: TEST_KEY, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' },
      (_req, res) => { res.writeHead(201); res.end('{}'); }
    );

    await new Promise<void>((resolve, reject) => {
      tls12Server.listen(0, '127.0.0.1', () => resolve());
      tls12Server.on('error', reject);
    });

    const port = (tls12Server.address() as net.AddressInfo).port;

    try {
      const result = await uploadPhoto(
        { imageBuffer: await makeJpegBuffer(), filename: 'photo.jpg', claimId: 'c1' },
        {
          baseUrl: `https://127.0.0.1:${port}`,
          authToken: 'token',
          pinnedCertificates: [TEST_SPKI_PIN],
          _testCaCert: TEST_CERT,
        }
      );
      // Connection must fail: client only allows TLS 1.3, server only offers 1.2
      expect(result.status).toBe('network_error');
      expect(result.showSuccessConfirmation).toBe(false);
    } finally {
      tls12Server.close();
    }
  });
});

// ─── Certificate Pinning ──────────────────────────────────────────────────────

describe('Upload API – Certificate Pinning', () => {
  let ts: TestServer;

  beforeAll(async () => { ts = await startTls13TestServer(201); });
  afterAll(() => ts.server.close());

  it('returns pin_error and showSuccessConfirmation=false when pin mismatches', async () => {
    const wrongPin = crypto.createHash('sha256').update(crypto.randomBytes(294)).digest('base64');
    const result = await uploadPhoto(
      { imageBuffer: await makeJpegBuffer(), filename: 'photo.jpg', claimId: 'c1' },
      {
        baseUrl: `https://127.0.0.1:${ts.port}`,
        authToken: 'token',
        pinnedCertificates: [wrongPin],
        _testCaCert: TEST_CERT,
      }
    );
    expect(result.status).toBe('pin_error');
    expect(result.showSuccessConfirmation).toBe(false);
    expect(result.errorMessage).toMatch(/Sicherheitsprüfung fehlgeschlagen/);
  });

  it('succeeds when the correct pin is provided', async () => {
    const result = await uploadPhoto(
      { imageBuffer: await makeJpegBuffer(), filename: 'photo.jpg', claimId: 'c1' },
      { baseUrl: `https://127.0.0.1:${ts.port}`, authToken: 'token', pinnedCertificates: [TEST_SPKI_PIN], _testCaCert: TEST_CERT }
    );
    expect(result.status).toBe('success');
  });

  it('succeeds when correct pin is among multiple backup pins', async () => {
    const backupPin = crypto.createHash('sha256').update(crypto.randomBytes(294)).digest('base64');
    const result = await uploadPhoto(
      { imageBuffer: await makeJpegBuffer(), filename: 'photo.jpg', claimId: 'c1' },
      {
        baseUrl: `https://127.0.0.1:${ts.port}`,
        authToken: 'token',
        pinnedCertificates: [backupPin, TEST_SPKI_PIN],
        _testCaCert: TEST_CERT,
      }
    );
    expect(result.status).toBe('success');
  });
});

// ─── Compression behaviour ────────────────────────────────────────────────────

describe('Compression behaviour', () => {
  it('compresses JPEG to smaller size', async () => {
    const input = await makeJpegBuffer(1024, 768);
    const result = await compressImage(input, 'photo.jpg', { jpegQuality: 60 });
    expect(result.compressedSize).toBeLessThan(result.originalSize);
  });

  it('compresses PNG and converts to JPEG', async () => {
    const input = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();
    const result = await compressImage(input, 'photo.png');
    expect(result.format).toBe('jpeg');
    expect(result.compressedSize).toBeGreaterThan(0);
  });

  it('scales down oversized images proportionally', async () => {
    const input = await makeJpegBuffer(3000, 2000);
    const result = await compressImage(input, 'big.jpg', { maxDimension: 800 });
    const meta = await sharp(result.data).metadata();
    expect(meta.width).toBeLessThanOrEqual(800);
    expect(meta.height).toBeLessThanOrEqual(800);
  });

  it('compression is async (Promise-based)', async () => {
    const input = await makeJpegBuffer(200, 200);
    const promise = compressImage(input, 'photo.jpg');
    expect(promise).toBeInstanceOf(Promise);
    await promise;
  });
});

// ─── Server error responses ───────────────────────────────────────────────────

describe('Upload API – Server error responses', () => {
  it('returns server_error on HTTP 500', async () => {
    const ts500 = await startTls13TestServer(500, 'Internal Error');
    try {
      const result = await uploadPhoto(
        { imageBuffer: await makeJpegBuffer(), filename: 'photo.jpg', claimId: 'c1' },
        { baseUrl: `https://127.0.0.1:${ts500.port}`, authToken: 'token', pinnedCertificates: [TEST_SPKI_PIN], _testCaCert: TEST_CERT }
      );
      expect(result.status).toBe('server_error');
      expect(result.httpStatus).toBe(500);
      expect(result.showSuccessConfirmation).toBe(false);
    } finally {
      ts500.server.close();
    }
  });

  it('returns server_error on HTTP 409 (duplicate)', async () => {
    const ts409 = await startTls13TestServer(409, 'Conflict');
    try {
      const result = await uploadPhoto(
        { imageBuffer: await makeJpegBuffer(), filename: 'photo.jpg', claimId: 'c1' },
        { baseUrl: `https://127.0.0.1:${ts409.port}`, authToken: 'token', pinnedCertificates: [TEST_SPKI_PIN], _testCaCert: TEST_CERT }
      );
      expect(result.status).toBe('server_error');
      expect(result.httpStatus).toBe(409);
    } finally {
      ts409.server.close();
    }
  });
});
