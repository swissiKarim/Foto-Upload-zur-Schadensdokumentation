/**
 * Photo Upload Service
 *
 * Handles the full upload pipeline:
 *  1. Compress image (async, background)
 *  2. Assign client-side UUID for idempotency
 *  3. POST to /claims/{claimId}/photos over HTTPS with TLS 1.3
 *  4. Certificate pinning check
 *  5. Return structured result for UI confirmation display
 *
 * AC: "Die Übertragung erfolgt ausschließlich über HTTPS mit TLS 1.3 via
 *      POST /claims/{claimId}/photos; ältere TLS-Versionen werden serverseitig abgewiesen."
 * AC: "Jedes Bild erhält eine clientseitig generierte UUID zur Idempotenz-Sicherung."
 * AC: "Nach erfolgreichem Upload zeigt die App eine direkte visuelle Bestätigung."
 */

import * as https from 'https';
import * as http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { compressImage, CompressOptions } from '../compression/imageCompressor';
import {
  buildPinCheckCallback,
  CertificatePinError,
} from './certificatePinning';

export interface UploadConfig {
  /** Base URL of the insurance backend, e.g. https://api.insurance.example.com */
  baseUrl: string;
  /** Bearer token for authorisation */
  authToken: string;
  /** Base64-encoded SHA-256 SPKI pins for certificate pinning */
  pinnedCertificates: string[];
  /** Compression options forwarded to imageCompressor */
  compressionOptions?: CompressOptions;
  /** Request timeout in ms (default 30 000) */
  timeoutMs?: number;
  /**
   * Optional PEM-encoded CA certificate(s) to trust.
   * Use ONLY in tests with self-signed certs; in production leave undefined
   * so the system CA store is used.
   */
  _testCaCert?: string;
}

export interface PhotoUploadRequest {
  /** Raw image buffer (jpg / png / heic, max 15 MB) */
  imageBuffer: Buffer;
  /** Original filename – used for format validation */
  filename: string;
  /** Insurance claim ID */
  claimId: string;
}

export type UploadStatus = 'success' | 'pin_error' | 'network_error' | 'server_error';

export interface PhotoUploadResult {
  /** Client-generated UUID sent with the request (idempotency key) */
  photoId: string;
  status: UploadStatus;
  /** HTTP status code (undefined on network/pin errors) */
  httpStatus?: number;
  /** Server-assigned location header or similar confirmation */
  serverPhotoId?: string;
  /** Human-readable error message for UI display */
  errorMessage?: string;
  /** Compression statistics */
  compressionRatio?: number;
  /** Whether the UI should show a success checkmark */
  showSuccessConfirmation: boolean;
}

/**
 * Uploads a single photo for a claim.
 * Compression runs asynchronously before the network request.
 */
export async function uploadPhoto(
  request: PhotoUploadRequest,
  config: UploadConfig
): Promise<PhotoUploadResult> {
  const photoId = uuidv4();

  // ── Step 1: Compress asynchronously ────────────────────────────────────────
  let compressResult: Awaited<ReturnType<typeof compressImage>>;
  try {
    compressResult = await compressImage(
      request.imageBuffer,
      request.filename,
      config.compressionOptions
    );
  } catch (err) {
    return {
      photoId,
      status: 'network_error',
      errorMessage: `Komprimierung fehlgeschlagen: ${(err as Error).message}`,
      showSuccessConfirmation: false,
    };
  }

  // ── Step 2: Build HTTPS agent with TLS 1.3 + cert pinning ──────────────────
  const pinnedPins = new Set(config.pinnedCertificates);
  const agent = new https.Agent({
    minVersion: 'TLSv1.3',       // Reject TLS < 1.3 on the client side too
    maxVersion: 'TLSv1.3',
    // _testCaCert is ONLY for unit/integration tests with self-signed certs.
    // In production this is undefined and the system CA store is used.
    ...(config._testCaCert ? { ca: config._testCaCert } : {}),
    checkServerIdentity: buildPinCheckCallback(pinnedPins),
    keepAlive: false,
  });

  // ── Step 3: Build multipart body ───────────────────────────────────────────
  const boundary = `----FormBoundary${photoId.replace(/-/g, '')}`;
  const filename = `photo-${photoId}.jpg`;
  const bodyParts: Buffer[] = [];

  // photoId field (idempotency key)
  bodyParts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="photoId"\r\n\r\n` +
        `${photoId}\r\n`
    )
  );

  // image file field
  bodyParts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="photo"; filename="${filename}"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n`
    )
  );
  bodyParts.push(compressResult.data);
  bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(bodyParts);

  const url = new URL(`${config.baseUrl}/claims/${request.claimId}/photos`);

  const requestOptions: https.RequestOptions = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    method: 'POST',
    agent,
    headers: {
      Authorization: `Bearer ${config.authToken}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
      'X-Photo-Id': photoId,           // Idempotency header
      'X-Client-Version': '1.0.0',
    },
    timeout: config.timeoutMs ?? 30_000,
  };

  // ── Step 4: Execute request ────────────────────────────────────────────────
  return new Promise<PhotoUploadResult>((resolve) => {
    const req = https.request(requestOptions, (res: http.IncomingMessage) => {
      let responseBody = '';
      res.on('data', (chunk: Buffer) => {
        responseBody += chunk.toString();
      });
      res.on('end', () => {
        const httpStatus = res.statusCode ?? 0;
        if (httpStatus === 201) {
          let serverPhotoId: string | undefined;
          try {
            const json = JSON.parse(responseBody) as { photoId?: string };
            serverPhotoId = json.photoId;
          } catch {
            // body may not be JSON in all environments
          }
          resolve({
            photoId,
            status: 'success',
            httpStatus,
            serverPhotoId,
            compressionRatio: compressResult.compressionRatio,
            showSuccessConfirmation: true,
          });
        } else {
          resolve({
            photoId,
            status: 'server_error',
            httpStatus,
            errorMessage: `Server antwortete mit Status ${httpStatus}: ${responseBody}`,
            showSuccessConfirmation: false,
          });
        }
      });
    });

    req.on('error', (err: Error) => {
      if (err instanceof CertificatePinError || err.name === 'CertificatePinError') {
        resolve({
          photoId,
          status: 'pin_error',
          errorMessage:
            'Sicherheitsprüfung fehlgeschlagen: Das Serverzertifikat konnte nicht verifiziert werden. ' +
            'Der Upload wurde abgebrochen.',
          showSuccessConfirmation: false,
        });
      } else {
        resolve({
          photoId,
          status: 'network_error',
          errorMessage: `Netzwerkfehler: ${err.message}`,
          showSuccessConfirmation: false,
        });
      }
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        photoId,
        status: 'network_error',
        errorMessage: 'Upload-Timeout. Bitte versuche es erneut.',
        showSuccessConfirmation: false,
      });
    });

    req.write(body);
    req.end();
  });
}

/**
 * Batch-uploads multiple photos for a single claim sequentially.
 * Returns results for each photo (UI shows per-photo checkmarks).
 */
export async function uploadPhotos(
  requests: PhotoUploadRequest[],
  config: UploadConfig
): Promise<PhotoUploadResult[]> {
  const results: PhotoUploadResult[] = [];
  for (const request of requests) {
    results.push(await uploadPhoto(request, config));
  }
  return results;
}
