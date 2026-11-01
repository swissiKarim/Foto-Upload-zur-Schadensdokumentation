/**
 * Integration tests for the Claims Photo Upload API.
 *
 * Covers all acceptance criteria:
 *   AC1 – Correct claimId assignment + AES-256 encrypted EU blob storage
 *   AC2 – POST /claims/{claimId}/photos, GET, DELETE endpoints
 *   AC3 – DSGVO Art. 17 deletion: blob + metadata removed
 *   AC4 – Adapter integration: claims system notified on upload & delete
 *   AC5 – KPI recording: photo count + processing duration
 *   AC6 – Privacy-by-Design: storageKey not exposed in API responses (RC-01/RC-02)
 *   AC7 – Validation: unsupported MIME, oversized file, max 10 photos per claim
 */

import request from 'supertest';
import { createApp } from '../src/app';
import { InMemoryBlobStorageService } from '../src/services/blobStorageService';
import { InMemoryPhotoRepository } from '../src/services/photoRepository';
import { ClaimsSystemStubAdapter } from '../src/adapters/claimsSystemAdapter';
import { Application } from 'express';
import { MAX_PHOTOS_PER_CLAIM } from '../src/models/photo';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const CLAIM_ID = 'claim-001';
const USER_ID = 'user-42';
const UNKNOWN_CLAIM = 'claim-999';

function makeJpeg(sizeBytes = 1024): Buffer {
  // Minimal valid JPEG-like buffer for testing
  const buf = Buffer.alloc(sizeBytes, 0xff);
  buf[0] = 0xff;
  buf[1] = 0xd8; // JPEG SOI marker
  return buf;
}

interface TestContext {
  app: Application;
  blob: InMemoryBlobStorageService;
  repo: InMemoryPhotoRepository;
  adapter: ClaimsSystemStubAdapter;
}

function buildApp(): TestContext {
  const blob = new InMemoryBlobStorageService();
  const repo = new InMemoryPhotoRepository();
  const adapter = new ClaimsSystemStubAdapter();
  const app = createApp({ blobStorage: blob, photoRepository: repo, claimsAdapter: adapter });
  return { app, blob, repo, adapter };
}

// ---------------------------------------------------------------------------
// AC2: Endpoint existence and basic HTTP contract
// ---------------------------------------------------------------------------

describe('AC2 – API endpoints', () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = buildApp(); });

  it('POST /claims/:claimId/photos returns 201 on valid upload', async () => {
    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.photo).toBeDefined();
    expect(res.body.photo.claimId).toBe(CLAIM_ID);
    expect(res.body.photo.photoId).toBeDefined();
    expect(res.body.photo.uploadedAt).toBeDefined();
  });

  it('GET /claims/:claimId/photos returns 200 with photo list', async () => {
    // Upload first
    await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    const res = await request(ctx.app)
      .get(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.claimId).toBe(CLAIM_ID);
    expect(Array.isArray(res.body.photos)).toBe(true);
    expect(res.body.photos.length).toBe(1);
    expect(res.body.totalPhotos).toBe(1);
  });

  it('DELETE /claims/:claimId/photos/:photoId returns 200', async () => {
    const upload = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    const photoId = upload.body.photo.photoId;

    const res = await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/${photoId}`)
      .set('X-User-Id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.deletedPhotoId).toBe(photoId);
  });

  it('GET /claims/:claimId/photos returns 404 for unknown claim', async () => {
    const res = await request(ctx.app)
      .get(`/claims/${UNKNOWN_CLAIM}/photos`)
      .set('X-User-Id', USER_ID);

    expect(res.status).toBe(404);
  });

  it('POST /claims/:claimId/photos returns 401 without X-User-Id', async () => {
    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(401);
  });

  it('DELETE /claims/:claimId/photos/:photoId returns 404 for non-existent photo', async () => {
    const res = await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/non-existent-photo-id`)
      .set('X-User-Id', USER_ID);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC1 – Correct claimId assignment + AES-256 encrypted storage
// ---------------------------------------------------------------------------

describe('AC1 – claimId assignment and AES-256 encrypted storage', () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = buildApp(); });

  it('uploaded photo is associated with the correct claimId', async () => {
    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'front.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.photo.claimId).toBe(CLAIM_ID);
  });

  it('photos of different claims are isolated', async () => {
    // seed second claim
    ctx.adapter.seedClaim({
      claimId: 'claim-002',
      policyNumber: 'POL-99999',
      status: 'open',
      createdAt: new Date().toISOString(),
    });

    await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' });

    await request(ctx.app)
      .post('/claims/claim-002/photos')
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'b.jpg', contentType: 'image/jpeg' });

    const res1 = await request(ctx.app)
      .get(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID);

    const res2 = await request(ctx.app)
      .get('/claims/claim-002/photos')
      .set('X-User-Id', USER_ID);

    expect(res1.body.totalPhotos).toBe(1);
    expect(res2.body.totalPhotos).toBe(1);
    expect(res1.body.photos[0].claimId).toBe(CLAIM_ID);
    expect(res2.body.photos[0].claimId).toBe('claim-002');
  });

  it('blob is stored encrypted (raw bytes differ from plaintext)', async () => {
    const plaintext = makeJpeg(512);

    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', plaintext, { filename: 'damage.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);

    const storageKey = `claims/${CLAIM_ID}/photos/${res.body.photo.photoId}`;
    const rawBlob = ctx.blob.getRawBlob(storageKey);

    expect(rawBlob).toBeDefined();
    // The encrypted blob must not equal the plaintext
    expect(rawBlob!.equals(plaintext)).toBe(false);
    // The encrypted blob must be longer (IV + authTag overhead)
    expect(rawBlob!.length).toBeGreaterThan(plaintext.length);
  });

  it('blob can be decrypted back to the original data', async () => {
    const { decryptAES256GCM } = await import('../src/services/blobStorageService');
    const plaintext = makeJpeg(512);

    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', plaintext, { filename: 'damage.jpg', contentType: 'image/jpeg' });

    const storageKey = `claims/${CLAIM_ID}/photos/${res.body.photo.photoId}`;
    const rawBlob = ctx.blob.getRawBlob(storageKey)!;
    const decrypted = decryptAES256GCM(rawBlob);

    expect(decrypted.equals(plaintext)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC3 – DSGVO Art. 17: full deletion (blob + metadata + client purge signal)
// ---------------------------------------------------------------------------

describe('AC3 – DSGVO Art. 17 deletion', () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = buildApp(); });

  it('DELETE removes blob from storage', async () => {
    const upload = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    const photoId = upload.body.photo.photoId;
    const storageKey = `claims/${CLAIM_ID}/photos/${photoId}`;

    expect(await ctx.blob.exists(storageKey)).toBe(true);

    await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/${photoId}`)
      .set('X-User-Id', USER_ID);

    expect(await ctx.blob.exists(storageKey)).toBe(false);
  });

  it('DELETE removes metadata from repository', async () => {
    const upload = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    const photoId = upload.body.photo.photoId;

    await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/${photoId}`)
      .set('X-User-Id', USER_ID);

    const found = await ctx.repo.findById(CLAIM_ID, photoId);
    expect(found).toBeNull();
  });

  it('GET after DELETE returns empty list', async () => {
    const upload = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    const photoId = upload.body.photo.photoId;

    await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/${photoId}`)
      .set('X-User-Id', USER_ID);

    const list = await request(ctx.app)
      .get(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID);

    expect(list.body.totalPhotos).toBe(0);
    expect(list.body.photos).toHaveLength(0);
  });

  it('DELETE response instructs client to purge local cache', async () => {
    const upload = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    const photoId = upload.body.photo.photoId;

    const res = await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/${photoId}`)
      .set('X-User-Id', USER_ID);

    expect(res.body.clientAction).toBe('PURGE_LOCAL_CACHE');
  });

  it('second DELETE on same photoId returns 404', async () => {
    const upload = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    const photoId = upload.body.photo.photoId;

    await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/${photoId}`)
      .set('X-User-Id', USER_ID);

    const res2 = await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/${photoId}`)
      .set('X-User-Id', USER_ID);

    expect(res2.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC4 – Claims system adapter integration
// ---------------------------------------------------------------------------

describe('AC4 – Claims system adapter integration', () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = buildApp(); });

  it('upload notifies claims system with correct claimId and photoId', async () => {
    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'front.jpg', contentType: 'image/jpeg' });

    const notifications = ctx.adapter.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('uploaded');
    expect(notifications[0].claimId).toBe(CLAIM_ID);
    expect(notifications[0].photoId).toBe(res.body.photo.photoId);
  });

  it('delete notifies claims system with correct claimId and photoId', async () => {
    const upload = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'front.jpg', contentType: 'image/jpeg' });

    const photoId = upload.body.photo.photoId;

    await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/${photoId}`)
      .set('X-User-Id', USER_ID);

    const notifications = ctx.adapter.getNotifications();
    const deleteNotification = notifications.find(n => n.type === 'deleted');
    expect(deleteNotification).toBeDefined();
    expect(deleteNotification!.claimId).toBe(CLAIM_ID);
    expect(deleteNotification!.photoId).toBe(photoId);
  });

  it('returns 404 when claim does not exist in claims system', async () => {
    const res = await request(ctx.app)
      .post(`/claims/${UNKNOWN_CLAIM}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'front.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(404);
    expect(ctx.adapter.getNotifications()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC5 – KPI recording
// ---------------------------------------------------------------------------

describe('AC5 – KPI recording', () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = buildApp(); });

  it('KPI records total photos uploaded', async () => {
    await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' });

    await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'b.jpg', contentType: 'image/jpeg' });

    const kpi = await ctx.repo.getKpi(CLAIM_ID);
    expect(kpi.totalPhotosUploaded).toBe(2);
    expect(kpi.claimId).toBe(CLAIM_ID);
  });

  it('KPI records firstPhotoUploadedAt and lastPhotoUploadedAt', async () => {
    await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' });

    await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'b.jpg', contentType: 'image/jpeg' });

    const kpi = await ctx.repo.getKpi(CLAIM_ID);
    expect(kpi.firstPhotoUploadedAt).not.toBeNull();
    expect(kpi.lastPhotoUploadedAt).not.toBeNull();
    expect(new Date(kpi.firstPhotoUploadedAt!).getTime()).toBeLessThanOrEqual(
      new Date(kpi.lastPhotoUploadedAt!).getTime(),
    );
  });

  it('KPI decrements total photos on deletion', async () => {
    const upload = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' });

    await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/${upload.body.photo.photoId}`)
      .set('X-User-Id', USER_ID);

    const kpi = await ctx.repo.getKpi(CLAIM_ID);
    expect(kpi.totalPhotosUploaded).toBe(0);
  });

  it('GET /claims/:claimId/photos/kpi returns KPI data', async () => {
    await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' });

    const res = await request(ctx.app)
      .get(`/claims/${CLAIM_ID}/photos/kpi`)
      .set('X-User-Id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.claimId).toBe(CLAIM_ID);
    expect(res.body.totalPhotosUploaded).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Privacy-by-Design (RC-01, RC-02) – storageKey not exposed
// ---------------------------------------------------------------------------

describe('RC-01/RC-02 – Privacy-by-Design: no internal keys leaked', () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = buildApp(); });

  it('POST response does not expose storageKey', async () => {
    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    expect(res.body.photo.storageKey).toBeUndefined();
  });

  it('GET response does not expose storageKey for any photo', async () => {
    await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.jpg', contentType: 'image/jpeg' });

    const res = await request(ctx.app)
      .get(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID);

    for (const photo of res.body.photos) {
      expect(photo.storageKey).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Validation edge cases
// ---------------------------------------------------------------------------

describe('Validation – file type, size, and photo count limits', () => {
  let ctx: TestContext;
  beforeEach(() => { ctx = buildApp(); });

  it('rejects unsupported MIME type (image/gif)', async () => {
    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'anim.gif', contentType: 'image/gif' });

    expect([400, 415]).toContain(res.status);
  });

  it('rejects files exceeding 15 MB', async () => {
    const bigFile = Buffer.alloc(16 * 1024 * 1024, 0xab); // 16 MB

    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', bigFile, { filename: 'big.jpg', contentType: 'image/jpeg' });

    expect([400, 413]).toContain(res.status);
  });

  it('accepts PNG files', async () => {
    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.photo.mimeType).toBe('image/png');
  });

  it('accepts HEIC files', async () => {
    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'damage.heic', contentType: 'image/heic' });

    expect(res.status).toBe(201);
    expect(res.body.photo.mimeType).toBe('image/heic');
  });

  it(`rejects upload when ${MAX_PHOTOS_PER_CLAIM} photos already exist`, async () => {
    // Upload max photos
    for (let i = 0; i < MAX_PHOTOS_PER_CLAIM; i++) {
      const r = await request(ctx.app)
        .post(`/claims/${CLAIM_ID}/photos`)
        .set('X-User-Id', USER_ID)
        .attach('photo', makeJpeg(), { filename: `img${i}.jpg`, contentType: 'image/jpeg' });
      expect(r.status).toBe(201);
    }

    // 11th upload must be rejected
    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'too-many.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(422);
  });

  it('allows upload after deletion when at limit', async () => {
    // Upload max photos
    const ids: string[] = [];
    for (let i = 0; i < MAX_PHOTOS_PER_CLAIM; i++) {
      const r = await request(ctx.app)
        .post(`/claims/${CLAIM_ID}/photos`)
        .set('X-User-Id', USER_ID)
        .attach('photo', makeJpeg(), { filename: `img${i}.jpg`, contentType: 'image/jpeg' });
      ids.push(r.body.photo.photoId);
    }

    // Delete one
    await request(ctx.app)
      .delete(`/claims/${CLAIM_ID}/photos/${ids[0]}`)
      .set('X-User-Id', USER_ID);

    // Now upload should succeed
    const res = await request(ctx.app)
      .post(`/claims/${CLAIM_ID}/photos`)
      .set('X-User-Id', USER_ID)
      .attach('photo', makeJpeg(), { filename: 'new.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe('Health check', () => {
  it('GET /health returns 200 with encryption info', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.encryption).toBe('AES-256-GCM');
  });
});
