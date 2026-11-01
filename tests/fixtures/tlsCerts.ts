/**
 * TLS test fixture – reads the pre-generated self-signed cert/key for tests.
 * The files were generated with:
 *   openssl req -x509 -newkey rsa:2048 -keyout test-key.pem -out test-cert.pem \
 *               -days 3650 -nodes -subj "/CN=localhost"
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const fixtureDir = path.join(__dirname);

export const TEST_CERT = fs.readFileSync(path.join(fixtureDir, 'test-cert.pem'), 'utf8');
export const TEST_KEY  = fs.readFileSync(path.join(fixtureDir, 'test-key.pem'),  'utf8');

/** Computes the SPKI SHA-256 pin (base64) for a PEM private key. */
export function makeSpkiPin(keyPem: string): string {
  const pubkeyDer = crypto
    .createPublicKey(keyPem)
    .export({ type: 'spki', format: 'der' }) as Buffer;
  return crypto.createHash('sha256').update(pubkeyDer).digest('base64');
}

export const TEST_SPKI_PIN = makeSpkiPin(TEST_KEY);
