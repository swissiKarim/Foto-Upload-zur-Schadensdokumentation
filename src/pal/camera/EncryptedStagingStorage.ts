/**
 * EncryptedStagingStorage
 *
 * Writes captured image bytes into the app-private directory encrypted with
 * AES-256-CBC.  The public device storage is never touched.
 *
 * Depends on:
 *   react-native-fs      – access to DocumentDirectoryPath (app-private)
 *   react-native-aes-crypto – AES-256 encryption
 */

import RNFS from 'react-native-fs';
import Aes from 'react-native-aes-crypto';

export interface StagingEntry {
  encryptedPath: string;
  iv: string;
  keyHash: string;
}

const STAGING_DIR = `${RNFS.DocumentDirectoryPath}/damage_staging`;
const KEY_SIZE = 256; // bits
const ITERATION_COUNT = 10000;

async function ensureStagingDir(): Promise<void> {
  const exists = await RNFS.exists(STAGING_DIR);
  if (!exists) {
    await RNFS.mkdir(STAGING_DIR);
  }
}

/**
 * Derives a fresh AES-256 key + IV and writes the encrypted file.
 * Returns the path and key material needed for later decryption.
 *
 * NOTE: In production the key must be stored in the platform secure keystore
 *       (iOS Keychain / Android Keystore) – not in plain memory.
 */
export async function storeEncrypted(
  sourcePath: string,
  targetFileName: string,
  passphrase: string,
): Promise<StagingEntry> {
  await ensureStagingDir();

  const salt = await Aes.randomKey(16);
  const key = await Aes.pbkdf2(passphrase, salt, ITERATION_COUNT, KEY_SIZE);
  const iv = await Aes.randomKey(16);

  const plainBase64 = await RNFS.readFile(sourcePath, 'base64');
  const encryptedBase64 = await Aes.encrypt(plainBase64, key, iv, 'aes-256-cbc');

  const encryptedPath = `${STAGING_DIR}/${targetFileName}.enc`;
  await RNFS.writeFile(encryptedPath, encryptedBase64, 'base64');

  // Delete original temp file so it never sits in public storage.
  // We attempt unlink unconditionally; if the file is already gone it is a no-op.
  try {
    await RNFS.unlink(sourcePath);
  } catch (_) {
    // Ignore – file may already be absent
  }

  return { encryptedPath, iv, keyHash: key };
}

/**
 * Reads and decrypts a previously stored staging entry.
 */
export async function readEncrypted(
  entry: StagingEntry,
  passphrase: string,
): Promise<string> {
  const salt = await Aes.randomKey(16);
  const key = await Aes.pbkdf2(passphrase, salt, ITERATION_COUNT, KEY_SIZE);
  const encryptedBase64 = await RNFS.readFile(entry.encryptedPath, 'base64');
  return Aes.decrypt(encryptedBase64, key, entry.iv, 'aes-256-cbc');
}

/**
 * Removes the encrypted staging file after a successful upload.
 */
export async function removeFromStaging(entry: StagingEntry): Promise<void> {
  if (await RNFS.exists(entry.encryptedPath)) {
    await RNFS.unlink(entry.encryptedPath);
  }
}
