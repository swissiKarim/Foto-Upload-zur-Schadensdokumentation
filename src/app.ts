/**
 * Express application factory.
 * Wires together all services, adapters and routes.
 *
 * Separation between app factory and server entry point allows
 * supertest to spin up the app without binding a port.
 */

import express, { Application } from 'express';
import { PhotoService } from './services/photoService';
import { InMemoryBlobStorageService } from './services/blobStorageService';
import { InMemoryPhotoRepository } from './services/photoRepository';
import { ClaimsSystemStubAdapter, ClaimsSystemAdapter } from './adapters/claimsSystemAdapter';
import { BlobStorageService } from './services/blobStorageService';
import { PhotoRepository } from './services/photoRepository';
import { createPhotoRouter } from './routes/photoRoutes';
import { errorHandler } from './middleware/errorHandler';

export interface AppDependencies {
  blobStorage?: BlobStorageService;
  photoRepository?: PhotoRepository;
  claimsAdapter?: ClaimsSystemAdapter;
}

export function createApp(deps: AppDependencies = {}): Application {
  const blob = deps.blobStorage ?? new InMemoryBlobStorageService();
  const repo = deps.photoRepository ?? new InMemoryPhotoRepository();
  const claimsAdapter = deps.claimsAdapter ?? new ClaimsSystemStubAdapter();

  const photoService = new PhotoService(blob, repo);

  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', tls: 'enforced-at-proxy', encryption: 'AES-256-GCM' });
  });

  // Photo routes under /claims/:claimId/photos
  app.use('/claims/:claimId/photos', createPhotoRouter(photoService, claimsAdapter));

  // Central error handler (must be last)
  app.use(errorHandler);

  return app;
}
