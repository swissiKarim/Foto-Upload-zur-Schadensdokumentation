/**
 * Photo upload routes.
 *
 * AC2: POST /claims/{claimId}/photos
 *       GET  /claims/{claimId}/photos
 *       DELETE /claims/{claimId}/photos/{photoId}
 *
 * All endpoints require the X-User-Id header (auth stub – production uses JWT).
 * TLS 1.3 is enforced at the reverse-proxy / load-balancer level (not in-process).
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { PhotoService, ValidationError, NotFoundError } from '../services/photoService';
import { ClaimsSystemAdapter } from '../adapters/claimsSystemAdapter';
import { MAX_FILE_SIZE_BYTES, SUPPORTED_MIME_TYPES } from '../models/photo';

// ---------------------------------------------------------------------------
// Multer configuration – memory storage, validated file types & size
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if ((SUPPORTED_MIME_TYPES as string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file type: ${file.mimetype}. Allowed: ${SUPPORTED_MIME_TYPES.join(', ')}`,
        ),
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------
export function createPhotoRouter(
  photoService: PhotoService,
  claimsAdapter: ClaimsSystemAdapter,
): Router {
  const router = Router({ mergeParams: true });

  // -------------------------------------------------------------------------
  // POST /claims/:claimId/photos
  // Upload a photo and attach it to the given claim (AC2, AC1)
  // -------------------------------------------------------------------------
  router.post(
    '/',
    upload.single('photo'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { claimId } = req.params;
        const userId = req.headers['x-user-id'] as string | undefined;

        if (!userId) {
          res.status(401).json({ error: 'Missing X-User-Id header.' });
          return;
        }

        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded. Field name must be "photo".' });
          return;
        }

        // Verify claim exists and belongs to user (AC4 – adapter)
        const claimInfo = await claimsAdapter.getClaimInfo(claimId, userId);
        if (!claimInfo) {
          res.status(404).json({ error: `Claim ${claimId} not found.` });
          return;
        }

        const result = await photoService.uploadPhoto({
          claimId,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          data: req.file.buffer,
        });

        // Notify claims system (AC4)
        await claimsAdapter.notifyPhotoUploaded(
          claimId,
          result.photo.photoId,
          result.photo.uploadedAt,
        );

        res.status(201).json({
          message: 'Photo uploaded successfully.',
          photo: toPublicDto(result.photo),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /claims/:claimId/photos
  // List all photos for a claim (AC2)
  // -------------------------------------------------------------------------
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { claimId } = req.params;
      const userId = req.headers['x-user-id'] as string | undefined;

      if (!userId) {
        res.status(401).json({ error: 'Missing X-User-Id header.' });
        return;
      }

      // Verify claim access (AC4)
      const claimInfo = await claimsAdapter.getClaimInfo(claimId, userId);
      if (!claimInfo) {
        res.status(404).json({ error: `Claim ${claimId} not found.` });
        return;
      }

      const photos = await photoService.listPhotos(claimId);

      res.status(200).json({
        claimId,
        totalPhotos: photos.length,
        photos: photos.map(toPublicDto),
      });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /claims/:claimId/photos/:photoId
  // DSGVO Art. 17 deletion: blob + metadata (AC2, AC3)
  // -------------------------------------------------------------------------
  router.delete(
    '/:photoId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { claimId, photoId } = req.params;
        const userId = req.headers['x-user-id'] as string | undefined;

        if (!userId) {
          res.status(401).json({ error: 'Missing X-User-Id header.' });
          return;
        }

        // Verify claim access (AC4)
        const claimInfo = await claimsAdapter.getClaimInfo(claimId, userId);
        if (!claimInfo) {
          res.status(404).json({ error: `Claim ${claimId} not found.` });
          return;
        }

        await photoService.deletePhoto(claimId, photoId);

        // Notify claims system of deletion (AC4)
        await claimsAdapter.notifyPhotoDeleted(claimId, photoId);

        res.status(200).json({
          message: 'Photo deleted successfully. Client must purge local device cache.',
          deletedPhotoId: photoId,
          // Explicit instruction to mobile client to delete local copy (AC3)
          clientAction: 'PURGE_LOCAL_CACHE',
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /claims/:claimId/kpi – KPI endpoint (AC5)
  // -------------------------------------------------------------------------
  router.get('/kpi', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { claimId } = req.params;
      const userId = req.headers['x-user-id'] as string | undefined;

      if (!userId) {
        res.status(401).json({ error: 'Missing X-User-Id header.' });
        return;
      }

      const claimInfo = await claimsAdapter.getClaimInfo(claimId, userId);
      if (!claimInfo) {
        res.status(404).json({ error: `Claim ${claimId} not found.` });
        return;
      }

      const kpi = await photoService.getKpi(claimId);
      res.status(200).json(kpi);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// DTO helper – strip internal fields (storageKey) from API responses (RC-01)
// ---------------------------------------------------------------------------
function toPublicDto(photo: ReturnType<typeof Object.assign>) {
  const { storageKey: _sk, ...pub } = photo;
  return pub;
}
