/**
 * AES-256-GCM Encryption Module
 *
 * Encrypts image buffers before writing them to local (app-private) storage.
 *
 * AC: "Lokal zwischengespeicherte Bilder werden ausschließlich AES-256-verschlüsselt
 *      im App-privaten Bereich abgelegt."
 * AC: "In-App-Kamera-Fotos verbleiben zu keinem Zeitpunkt unverschlüsselt im
 *      öffentlichen Speicherbereich des Smartphones."
 */

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits – recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

export interface EncryptedPayload {
  /** Base64-encoded IV */
  iv: string;
  /** Base64-encoded auth tag */
  authTag: string;
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Algorithm identifier for future-proofing */
  algorithm: string;
}

export interface DecryptedPayload {
  data: Buffer;
}

/**
 * Derives a 256-bit key from a passphrase using PBKDF2.
 * In production the key would come from the platform secure keystore (Keychain / Keystore API).
 */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, 310_000, KEY_LENGTH, 'sha256');
}

/**
 * Generates a cryptographically random 256-bit AES key.
 * Use this when the key is managed by the platform secure enclave.
 */
export function generateKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

/**
 * Encrypts a Buffer with AES-256-GCM.
 * Returns a structured payload containing IV, auth tag, and ciphertext —
 * all three are required for authenticated decryption.
 */
export function encryptBuffer(plaintext: Buffer, key: Buffer): EncryptedPayload {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`AES-256 requires a 32-byte key; got ${key.length} bytes`);
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    algorithm: ALGORITHM,
  };
}

/**
 * Decrypts an AES-256-GCM payload.
 * Throws if authentication tag verification fails (tamper detection).
 */
export function decryptBuffer(payload: EncryptedPayload, key: Buffer): Buffer {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`AES-256 requires a 32-byte key; got ${key.length} bytes`);
  }
  if (payload.algorithm !== ALGORITHM) {
    throw new Error(`Unsupported algorithm: ${payload.algorithm}`);
  }

  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Serialises an EncryptedPayload to a Buffer suitable for writing to disk.
 * Format: JSON envelope → UTF-8 bytes.
 */
export function serialiseEncryptedPayload(payload: EncryptedPayload): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

/**
 * Deserialises a Buffer (as written by serialiseEncryptedPayload) back to an EncryptedPayload.
 */
export function deserialiseEncryptedPayload(raw: Buffer): EncryptedPayload {
  const parsed = JSON.parse(raw.toString('utf8')) as EncryptedPayload;
  if (!parsed.iv || !parsed.authTag || !parsed.ciphertext || !parsed.algorithm) {
    throw new Error('Invalid encrypted payload: missing required fields');
  }
  return parsed;
}
