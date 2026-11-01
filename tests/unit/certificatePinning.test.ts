/**
 * Unit tests – Certificate Pinning
 *
 * AC: "Certificate Pinning ist implementiert; schlägt die Prüfung fehl,
 *      wird der Upload abgebrochen und eine Fehlermeldung angezeigt."
 */

import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import type * as tls from 'tls';
import {
  verifyCertificatePin,
  computeSpkiFingerprint,
  buildPinCheckCallback,
  CertificatePinError,
} from '../../src/upload/certificatePinning';

/** Builds a mock PeerCertificate with a fake pubkey buffer */
function makeMockCert(pubkeyBytes: Buffer): tls.PeerCertificate {
  return {
    pubkey: pubkeyBytes,
    subject: { CN: 'test.example.com' } as tls.Certificate,
    issuer: { CN: 'Test CA' } as tls.Certificate,
    valid_from: '2024-01-01',
    valid_to: '2025-01-01',
    fingerprint: '',
    fingerprint256: '',
    fingerprint512: '',
    ext_key_usage: [],
    serialNumber: '01',
    raw: Buffer.alloc(0),
    subjectaltname: '',
    infoAccess: {},
  } as unknown as tls.PeerCertificate;
}

function spkiFingerprint(pubkeyBytes: Buffer): string {
  return crypto.createHash('sha256').update(pubkeyBytes).digest('base64');
}

describe('computeSpkiFingerprint', () => {
  it('returns a base64 SHA-256 hash of the pubkey', () => {
    const pubkey = crypto.randomBytes(294); // typical RSA-2048 SPKI size
    const cert = makeMockCert(pubkey);
    const fp = computeSpkiFingerprint(cert);
    expect(fp).toBe(spkiFingerprint(pubkey));
  });

  it('throws CertificatePinError when pubkey is unavailable', () => {
    const cert = { subject: {}, issuer: {} } as tls.PeerCertificate;
    expect(() => computeSpkiFingerprint(cert)).toThrow(CertificatePinError);
  });

  it('different pubkeys produce different fingerprints', () => {
    const pk1 = crypto.randomBytes(294);
    const pk2 = crypto.randomBytes(294);
    const fp1 = computeSpkiFingerprint(makeMockCert(pk1));
    const fp2 = computeSpkiFingerprint(makeMockCert(pk2));
    expect(fp1).not.toBe(fp2);
  });
});

describe('verifyCertificatePin', () => {
  it('passes when fingerprint is in the pinned set', () => {
    const pubkey = crypto.randomBytes(294);
    const cert = makeMockCert(pubkey);
    const pin = spkiFingerprint(pubkey);
    expect(() => verifyCertificatePin(cert, new Set([pin]))).not.toThrow();
  });

  it('passes when fingerprint is one of multiple pins (backup pin scenario)', () => {
    const pubkey = crypto.randomBytes(294);
    const cert = makeMockCert(pubkey);
    const correctPin = spkiFingerprint(pubkey);
    const backupPin = spkiFingerprint(crypto.randomBytes(294));
    expect(() =>
      verifyCertificatePin(cert, new Set([backupPin, correctPin]))
    ).not.toThrow();
  });

  it('throws CertificatePinError on fingerprint mismatch', () => {
    const pubkey = crypto.randomBytes(294);
    const cert = makeMockCert(pubkey);
    const wrongPin = spkiFingerprint(crypto.randomBytes(294));
    expect(() => verifyCertificatePin(cert, new Set([wrongPin]))).toThrow(
      CertificatePinError
    );
  });

  it('throws CertificatePinError when pin set is empty', () => {
    const cert = makeMockCert(crypto.randomBytes(294));
    expect(() => verifyCertificatePin(cert, new Set())).toThrow(CertificatePinError);
  });

  it('error message contains the server fingerprint', () => {
    const pubkey = crypto.randomBytes(294);
    const cert = makeMockCert(pubkey);
    const wrongPin = spkiFingerprint(crypto.randomBytes(294));
    try {
      verifyCertificatePin(cert, new Set([wrongPin]));
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CertificatePinError);
      expect((err as Error).message).toContain(spkiFingerprint(pubkey));
    }
  });
});

describe('buildPinCheckCallback', () => {
  it('returns undefined (no error) when pin matches', () => {
    const pubkey = crypto.randomBytes(294);
    const cert = makeMockCert(pubkey);
    const pin = spkiFingerprint(pubkey);
    const cb = buildPinCheckCallback(new Set([pin]));
    const result = cb('test.example.com', cert);
    expect(result).toBeUndefined();
  });

  it('returns a CertificatePinError when pin mismatches', () => {
    const pubkey = crypto.randomBytes(294);
    const cert = makeMockCert(pubkey);
    const wrongPin = spkiFingerprint(crypto.randomBytes(294));
    const cb = buildPinCheckCallback(new Set([wrongPin]));
    const result = cb('test.example.com', cert);
    expect(result).toBeInstanceOf(CertificatePinError);
  });

  it('returned error carries a descriptive message for UI display', () => {
    const pubkey = crypto.randomBytes(294);
    const cert = makeMockCert(pubkey);
    const cb = buildPinCheckCallback(new Set(['wrongpin==']));
    const err = cb('test.example.com', cert);
    expect(err?.message).toMatch(/pin/i);
  });
});
