/**
 * AES-256-GCM encryption/decryption helpers for queue persistence.
 * Each payload is encrypted with a random 12-byte IV prepended to the ciphertext.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // bytes – GCM standard
const AUTH_TAG_LENGTH = 16; // bytes

/**
 * Derive a 32-byte key from a passphrase using SHA-256.
 * In production replace with PBKDF2 / device-secure-storage key.
 */
export function deriveKey(passphrase: string): Buffer {
  return createHash("sha256").update(passphrase).digest();
}

/**
 * Encrypt `plaintext` with AES-256-GCM.
 * Returns a Buffer: [IV (12 bytes)] + [authTag (16 bytes)] + [ciphertext].
 */
export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a buffer produced by `encrypt`.
 */
export function decrypt(data: Buffer, key: Buffer): Buffer {
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
