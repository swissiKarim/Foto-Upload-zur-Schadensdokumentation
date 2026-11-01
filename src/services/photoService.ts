/**
 * PhotoService – core business logic for the photo upload module.
 *
 * Responsibilities:
 *  - Validate file type, size and per-claim photo count
 *  - Compress image data before storage (stub – production uses sharp/ffmpeg)
 *  - Store encrypted blob via BlobStorageService (AES-256, EU region – AC1)
 *  - Persist metadata via PhotoRepository
 *  - Record KPIs: upload count, processing duration (AC5)
 *  - Full DSGVO Art. 17 deletion: blob + metadata (AC3)
 *  - Privacy-by-Design: no unnecessary personal data stored (RC-01, RC-02)
 */

import { v4 as uuidv4 } from 'uuid';
import {
  PhotoMetadata,
  ClaimKpiRecord,
  SUPPORTED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_PHOTOS_PER_CLAIM,
  SupportedMimeType,
} from '../models/photo';
import { BlobStorageService } from './blobStorageService';
import { PhotoRepository } from './photoRepository';

export interface UploadPhotoInput {
  claimId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface UploadPhotoResult {
  photo: PhotoMetadata;
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Compression stub
// Production: replace with sharp.resize().jpeg({ quality: 80 }) or similar.
// The stub returns the original buffer so integration tests remain fast.
// ---------------------------------------------------------------------------
export async function compressImage(data: Buffer, _mimeType: string): Promise<Buffer> {
  // In production: compress to ≤ target size using sharp / ffmpeg
  return data;
}

export class PhotoService {
  constructor(
    private readonly blob: BlobStorageService,
    private readonly repo: PhotoRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /claims/{claimId}/photos (AC2)
  // ---------------------------------------------------------------------------
  async uploadPhoto(input: UploadPhotoInput): Promise<UploadPhotoResult> {
    const { claimId, filename, mimeType, data } = input;

    // Validate MIME type
    if (!(SUPPORTED_MIME_TYPES as string[]).includes(mimeType)) {
      throw new ValidationError(
        `Unsupported file type: ${mimeType}. Allowed: ${SUPPORTED_MIME_TYPES.join(', ')}`,
      );
    }

    // Validate file size (original, before compression)
    if (data.length > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(
        `File too large: ${data.length} bytes. Maximum allowed: ${MAX_FILE_SIZE_BYTES} bytes (15 MB).`,
      );
    }

    // Enforce per-claim photo limit
    const count = await this.repo.countByClaimId(claimId);
    if (count >= MAX_PHOTOS_PER_CLAIM) {
      throw new ValidationError(
        `Maximum number of photos per claim reached (${MAX_PHOTOS_PER_CLAIM}).`,
        422,
      );
    }

    // Compress before storage
    const compressed = await compressImage(data, mimeType);

    // Generate unique storage key – not guessable (privacy by design)
    const photoId = uuidv4();
    const storageKey = `claims/${claimId}/photos/${photoId}`;

    // Store encrypted in EU blob storage (AES-256 – AC1)
    await this.blob.store(storageKey, compressed);

    const uploadedAt = new Date().toISOString();

    const photo: PhotoMetadata = {
      photoId,
      claimId,
      filename: sanitiseFilename(filename),
      mimeType: mimeType as SupportedMimeType,
      sizeBytes: compressed.length,
      storageKey,
      uploadedAt,
      uploaded: true,
      pendingSync: false,
    };

    await this.repo.save(photo);

    // Update KPIs (AC5)
    await this.repo.updateKpiOnUpload(claimId, uploadedAt);

    return { photo };
  }

  // ---------------------------------------------------------------------------
  // GET /claims/{claimId}/photos (AC2)
  // ---------------------------------------------------------------------------
  async listPhotos(claimId: string): Promise<PhotoMetadata[]> {
    return this.repo.findByClaimId(claimId);
  }

  // ---------------------------------------------------------------------------
  // DELETE /claims/{claimId}/photos/{photoId} – Art. 17 DSGVO (AC2, AC3)
  // ---------------------------------------------------------------------------
  async deletePhoto(claimId: string, photoId: string): Promise<void> {
    const photo = await this.repo.findById(claimId, photoId);
    if (!photo) {
      throw new NotFoundError(`Photo ${photoId} not found for claim ${claimId}.`);
    }

    // 1. Delete from blob storage (AC3 – no residual personal data)
    await this.blob.delete(photo.storageKey);

    // 2. Delete metadata (AC3)
    await this.repo.delete(claimId, photoId);

    // 3. Update KPIs (AC5)
    await this.repo.updateKpiOnDelete(claimId);

    // Note: local device cache deletion is the responsibility of the mobile
    // client; the DELETE response instructs the client to purge its local copy.
    // This fulfils the "lokaler Gerätespeicher" part of AC3 by contract.
  }

  // ---------------------------------------------------------------------------
  // KPI retrieval (AC5)
  // ---------------------------------------------------------------------------
  async getKpi(claimId: string): Promise<ClaimKpiRecord> {
    return this.repo.getKpi(claimId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip path components and non-printable characters from a filename. */
function sanitiseFilename(name: string): string {
  return name.replace(/[^\w.\-]/g, '_').replace(/^\.+/, '_').slice(0, 255);
}
