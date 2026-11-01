/**
 * Domain models for the photo upload module.
 * Privacy-by-Design: only purpose-necessary fields are stored (RC-01, RC-02).
 */

export type SupportedMimeType = 'image/jpeg' | 'image/png' | 'image/heic';

export const SUPPORTED_MIME_TYPES: SupportedMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/heic',
];

export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_PHOTOS_PER_CLAIM = 10;

export interface PhotoMetadata {
  /** Unique photo identifier */
  photoId: string;
  /** Associated claim – ensures correct assignment (AC1) */
  claimId: string;
  /** Original filename (sanitised) */
  filename: string;
  /** MIME type */
  mimeType: SupportedMimeType;
  /** Size of the compressed image in bytes stored in blob storage */
  sizeBytes: number;
  /** Blob-storage key (AES-256 encrypted at rest – AC1) */
  storageKey: string;
  /** ISO-8601 upload timestamp – used for KPI: processing duration (AC5) */
  uploadedAt: string;
  /** Upload completed successfully */
  uploaded: boolean;
  /** Whether the photo is pending offline sync */
  pendingSync: boolean;
}

export interface ClaimKpiRecord {
  claimId: string;
  /** ISO-8601 timestamp when first photo was uploaded */
  firstPhotoUploadedAt: string | null;
  /** ISO-8601 timestamp of most recent photo upload */
  lastPhotoUploadedAt: string | null;
  /** Total photos uploaded for this claim */
  totalPhotosUploaded: number;
  /** Derived KPI: seconds from first to last upload (processing duration proxy) */
  processingDurationSeconds: number | null;
}
