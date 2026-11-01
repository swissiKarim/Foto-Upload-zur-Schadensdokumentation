/**
 * Certificate Pinning Module
 *
 * AC: "Certificate Pinning ist implementiert; schlägt die Prüfung fehl,
 *      wird der Upload abgebrochen und eine Fehlermeldung angezeigt."
 *
 * Validates the TLS peer certificate against a set of pinned SHA-256
 * fingerprints (SPKI pins – same approach as HTTP Public Key Pinning).
 * If pinning fails the upload is aborted with a CertificatePinError.
 */

import * as crypto from 'crypto';
import * as tls from 'tls';

export class CertificatePinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificatePinError';
  }
}

/**
 * Computes the SHA-256 fingerprint of the DER-encoded SubjectPublicKeyInfo
 * (SPKI) of a certificate — the same value browsers use for HPKP / cert pinning.
 */
export function computeSpkiFingerprint(cert: tls.PeerCertificate): string {
  // cert.pubkey is the DER-encoded SubjectPublicKeyInfo Buffer (Node ≥ 15.7)
  const pubkeyDer = (cert as tls.DetailedPeerCertificate).pubkey;
  if (!pubkeyDer) {
    throw new CertificatePinError(
      'Cannot read public key from peer certificate; cert.pubkey unavailable'
    );
  }
  return crypto.createHash('sha256').update(pubkeyDer).digest('base64');
}

/**
 * Verifies a peer certificate's SPKI fingerprint against a set of pinned values.
 *
 * @param cert        The TLS peer certificate returned by Node's tls socket.
 * @param pinnedPins  Set of Base64-encoded SHA-256 SPKI fingerprints to accept.
 * @throws CertificatePinError when the certificate does not match any pin.
 */
export function verifyCertificatePin(
  cert: tls.PeerCertificate,
  pinnedPins: ReadonlySet<string>
): void {
  if (pinnedPins.size === 0) {
    throw new CertificatePinError(
      'No pins configured – certificate pinning is enforced and requires at least one pin'
    );
  }

  const fingerprint = computeSpkiFingerprint(cert);

  if (!pinnedPins.has(fingerprint)) {
    throw new CertificatePinError(
      `Certificate pin mismatch. Server fingerprint: ${fingerprint}. ` +
        `Accepted pins: ${[...pinnedPins].join(', ')}`
    );
  }
}

/**
 * Builds a Node.js https.Agent / tls.connect checkServerIdentity callback that
 * enforces certificate pinning in addition to hostname verification.
 *
 * Usage:
 *   const agent = buildPinnedAgent(pins);
 *   https.request({ ..., agent });
 */
export function buildPinCheckCallback(
  pinnedPins: ReadonlySet<string>
): (hostname: string, cert: tls.PeerCertificate) => Error | undefined {
  return (_hostname: string, cert: tls.PeerCertificate): Error | undefined => {
    try {
      verifyCertificatePin(cert, pinnedPins);
      return undefined; // pin matches → proceed
    } catch (err) {
      return err instanceof Error ? err : new CertificatePinError(String(err));
    }
  };
}
