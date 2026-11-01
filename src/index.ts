/**
 * Insurance Photo Upload Feature – Public API
 *
 * Exports the full pipeline:
 *  - Image compression (async, background)
 *  - AES-256-GCM local encryption
 *  - Certificate-pinned TLS 1.3 upload
 *  - Offline queue with auto-retry
 */

// Compression
export { compressImage, validateFormat, validateSize } from './compression/imageCompressor';
export type { CompressOptions, CompressResult, SupportedFormat } from './compression/imageCompressor';

// Encryption
export {
  encryptBuffer,
  decryptBuffer,
  generateKey,
  deriveKey,
  serialiseEncryptedPayload,
  deserialiseEncryptedPayload,
} from './encryption/aes256';
export type { EncryptedPayload } from './encryption/aes256';

// Certificate pinning
export {
  verifyCertificatePin,
  computeSpkiFingerprint,
  buildPinCheckCallback,
  CertificatePinError,
} from './upload/certificatePinning';

// Upload service
export { uploadPhoto, uploadPhotos } from './upload/photoUploadService';
export type {
  UploadConfig,
  PhotoUploadRequest,
  PhotoUploadResult,
  UploadStatus,
} from './upload/photoUploadService';

// Local encrypted storage
export {
  storeEncryptedPhoto,
  loadEncryptedPhoto,
  deleteStoredPhoto,
  listPendingPhotos,
  listAllPendingPhotos,
  generateKey as generateStorageKey,
} from './storage/encryptedLocalStorage';
export type { StorageConfig, StoredPhotoEntry } from './storage/encryptedLocalStorage';

// Offline queue
export { OfflinePhotoQueue, OFFLINE_MESSAGE, defaultConnectivityCheck } from './offline/offlineQueue';
export type { QueuedPhoto, ConnectivityChecker, UploadResultCallback } from './offline/offlineQueue';
