/**
 * Unit tests – AES-256-GCM Encryption
 *
 * AC: "Lokal zwischengespeicherte Bilder werden ausschließlich AES-256-verschlüsselt
 *      im App-privaten Bereich abgelegt."
 */

import { describe, it, expect } from 'vitest';
import {
  generateKey,
  encryptBuffer,
  decryptBuffer,
  deriveKey,
  serialiseEncryptedPayload,
  deserialiseEncryptedPayload,
} from '../../src/encryption/aes256';

describe('generateKey', () => {
  it('generates a 32-byte buffer', () => {
    const key = generateKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it('generates unique keys each time', () => {
    const k1 = generateKey();
    const k2 = generateKey();
    expect(k1.toString('hex')).not.toBe(k2.toString('hex'));
  });
});

describe('deriveKey', () => {
  it('derives a 32-byte key from a passphrase', () => {
    const salt = Buffer.from('testsalt12345678');
    const key = deriveKey('my-secret-passphrase', salt);
    expect(key.length).toBe(32);
  });

  it('is deterministic for the same inputs', () => {
    const salt = Buffer.from('testsalt12345678');
    const k1 = deriveKey('passphrase', salt);
    const k2 = deriveKey('passphrase', salt);
    expect(k1.toString('hex')).toBe(k2.toString('hex'));
  });

  it('produces different keys for different passphrases', () => {
    const salt = Buffer.from('testsalt12345678');
    const k1 = deriveKey('pass1', salt);
    const k2 = deriveKey('pass2', salt);
    expect(k1.toString('hex')).not.toBe(k2.toString('hex'));
  });
});

describe('encryptBuffer / decryptBuffer', () => {
  const key = generateKey();
  const plaintext = Buffer.from('This is a test image payload 🖼️');

  it('encrypts to a different representation', () => {
    const payload = encryptBuffer(plaintext, key);
    expect(payload.ciphertext).not.toBe(plaintext.toString('base64'));
    expect(payload.algorithm).toBe('aes-256-gcm');
  });

  it('decrypts back to the original plaintext', () => {
    const payload = encryptBuffer(plaintext, key);
    const decrypted = decryptBuffer(payload, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('each encryption produces a unique IV', () => {
    const p1 = encryptBuffer(plaintext, key);
    const p2 = encryptBuffer(plaintext, key);
    expect(p1.iv).not.toBe(p2.iv);
  });

  it('each encryption produces a unique ciphertext (due to random IV)', () => {
    const p1 = encryptBuffer(plaintext, key);
    const p2 = encryptBuffer(plaintext, key);
    expect(p1.ciphertext).not.toBe(p2.ciphertext);
  });

  it('throws on wrong key', () => {
    const payload = encryptBuffer(plaintext, key);
    const wrongKey = generateKey();
    expect(() => decryptBuffer(payload, wrongKey)).toThrow();
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const payload = encryptBuffer(plaintext, key);
    // Flip a byte in the ciphertext
    const tampered = Buffer.from(payload.ciphertext, 'base64');
    tampered[0] ^= 0xff;
    const tamperedPayload = { ...payload, ciphertext: tampered.toString('base64') };
    expect(() => decryptBuffer(tamperedPayload, key)).toThrow();
  });

  it('throws on tampered auth tag', () => {
    const payload = encryptBuffer(plaintext, key);
    const tamperedTag = Buffer.from(payload.authTag, 'base64');
    tamperedTag[0] ^= 0x01;
    const tamperedPayload = { ...payload, authTag: tamperedTag.toString('base64') };
    expect(() => decryptBuffer(tamperedPayload, key)).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    const shortKey = Buffer.alloc(16);
    expect(() => encryptBuffer(plaintext, shortKey)).toThrow(/32-byte/);
    const payload = encryptBuffer(plaintext, key);
    expect(() => decryptBuffer(payload, shortKey)).toThrow(/32-byte/);
  });

  it('handles large buffers (1 MB)', () => {
    const large = Buffer.alloc(1024 * 1024, 0xab);
    const payload = encryptBuffer(large, key);
    const decrypted = decryptBuffer(payload, key);
    expect(decrypted.equals(large)).toBe(true);
  });
});

describe('serialiseEncryptedPayload / deserialiseEncryptedPayload', () => {
  const key = generateKey();
  const plaintext = Buffer.from('round-trip test');

  it('round-trips through serialisation correctly', () => {
    const payload = encryptBuffer(plaintext, key);
    const serialised = serialiseEncryptedPayload(payload);
    const deserialised = deserialiseEncryptedPayload(serialised);
    const decrypted = decryptBuffer(deserialised, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('serialised form is valid JSON', () => {
    const payload = encryptBuffer(plaintext, key);
    const serialised = serialiseEncryptedPayload(payload);
    expect(() => JSON.parse(serialised.toString('utf8'))).not.toThrow();
  });

  it('throws on invalid/truncated JSON', () => {
    expect(() =>
      deserialiseEncryptedPayload(Buffer.from('not-json'))
    ).toThrow();
  });

  it('throws on JSON missing required fields', () => {
    expect(() =>
      deserialiseEncryptedPayload(Buffer.from('{"iv":"abc"}'))
    ).toThrow(/missing required fields/);
  });
});
