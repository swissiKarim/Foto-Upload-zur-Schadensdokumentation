/**
 * Server entry point.
 *
 * TLS 1.3 is terminated at the reverse proxy (nginx / AWS ALB).
 * This process listens on HTTP internally; the proxy enforces TLS 1.3
 * externally and forwards to this port.
 */

import { createApp } from './app';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Claims Photo Upload API listening on port ${PORT}`);
  console.log(`TLS 1.3 enforced at reverse proxy – internal transport is HTTP`);
  console.log(`Blob storage: AES-256-GCM encrypted, EU region`);
});
