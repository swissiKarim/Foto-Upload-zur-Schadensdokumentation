/**
 * Unit tests for EncryptedStagingStorage
 *
 * Acceptance criteria covered:
 *   - Photo stored in app-private directory (DocumentDirectoryPath), not public storage
 *   - AES-256 encryption invoked (Aes.encrypt called)
 *   - Original source file deleted after encryption
 *   - Encrypted file path ends with .enc
 *   - removeFromStaging deletes the encrypted file
 */

import RNFS from 'react-native-fs';
import Aes from 'react-native-aes-crypto';
import { storeEncrypted, removeFromStaging } from '../../pal/camera/EncryptedStagingStorage';

const mockRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockAes = Aes as jest.Mocked<typeof Aes>;

describe('EncryptedStagingStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── storeEncrypted ──────────────────────────────────────────────────────
  it('returns an encryptedPath ending with .enc', async () => {
    const entry = await storeEncrypted('/tmp/source.jpg', 'capture_001', 'secret');
    expect(entry.encryptedPath).toMatch(/\.enc$/);
  });

  it('stores encrypted file inside DocumentDirectoryPath (app-private)', async () => {
    const entry = await storeEncrypted('/tmp/source.jpg', 'capture_002', 'secret');
    expect(entry.encryptedPath).toContain(RNFS.DocumentDirectoryPath);
  });

  it('does NOT store inside public directories', async () => {
    const entry = await storeEncrypted('/tmp/source.jpg', 'capture_003', 'secret');
    // Must not be in camera roll or DCIM equivalent paths
    expect(entry.encryptedPath).not.toMatch(/DCIM|Camera|Pictures|Downloads/i);
  });

  it('calls Aes.encrypt to protect image data', async () => {
    await storeEncrypted('/tmp/source.jpg', 'capture_004', 'secret');
    expect(mockAes.encrypt).toHaveBeenCalledTimes(1);
    expect(mockAes.encrypt).toHaveBeenCalledWith(
      expect.any(String), // data
      expect.any(String), // key
      expect.any(String), // iv
      'aes-256-cbc',
    );
  });

  it('uses PBKDF2 key derivation for AES-256', async () => {
    await storeEncrypted('/tmp/source.jpg', 'capture_005', 'secret');
    expect(mockAes.pbkdf2).toHaveBeenCalledWith(
      'secret',
      expect.any(String), // salt
      10000,              // iterations
      256,                // key size bits
    );
  });

  it('deletes original source file after encryption', async () => {
    await storeEncrypted('/tmp/to_delete.jpg', 'capture_006', 'secret');
    expect(mockRNFS.unlink).toHaveBeenCalledWith('/tmp/to_delete.jpg');
  });

  it('reads the source file and writes the encrypted file', async () => {
    await storeEncrypted('/tmp/read_write.jpg', 'capture_007', 'secret');
    expect(mockRNFS.readFile).toHaveBeenCalledWith('/tmp/read_write.jpg', 'base64');
    expect(mockRNFS.writeFile).toHaveBeenCalled();
  });

  it('returns iv and keyHash in entry', async () => {
    const entry = await storeEncrypted('/tmp/source.jpg', 'capture_008', 'secret');
    expect(entry.iv).toBeDefined();
    expect(entry.keyHash).toBeDefined();
  });

  // ── removeFromStaging ───────────────────────────────────────────────────
  it('removeFromStaging deletes the encrypted file', async () => {
    const entry = await storeEncrypted('/tmp/source.jpg', 'capture_009', 'secret');
    jest.clearAllMocks();

    // Make the file appear to exist so unlink is called
    mockRNFS.exists.mockResolvedValueOnce(true);

    await removeFromStaging(entry);
    expect(mockRNFS.unlink).toHaveBeenCalledWith(entry.encryptedPath);
  });

  it('removeFromStaging is a no-op when file does not exist', async () => {
    const entry = {
      encryptedPath: '/app/private/documents/damage_staging/nonexistent.enc',
      iv: 'iv',
      keyHash: 'key',
    };

    mockRNFS.exists.mockResolvedValueOnce(false);
    await removeFromStaging(entry);
    expect(mockRNFS.unlink).not.toHaveBeenCalled();
  });

  // ── staging directory created if missing ────────────────────────────────
  it('creates staging directory if it does not exist', async () => {
    // First exists() call for dir check returns false, second (unlink check) returns true
    mockRNFS.exists
      .mockResolvedValueOnce(false)  // staging dir check
      .mockResolvedValueOnce(true);  // source file exists check

    await storeEncrypted('/tmp/source.jpg', 'capture_010', 'secret');
    expect(mockRNFS.mkdir).toHaveBeenCalled();
  });
});
