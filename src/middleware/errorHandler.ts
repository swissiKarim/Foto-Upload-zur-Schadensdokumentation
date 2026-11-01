/**
 * Central error-handling middleware.
 * Maps domain errors to appropriate HTTP status codes.
 */

import { Request, Response, NextFunction } from 'express';
import { ValidationError, NotFoundError } from '../services/photoService';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ValidationError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }

  // Multer errors (file size, file type)
  if (err.message && err.message.startsWith('Unsupported file type')) {
    res.status(415).json({ error: err.message });
    return;
  }

  // Multer file-size limit
  if ((err as any).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      error: `File too large. Maximum allowed size is 15 MB.`,
    });
    return;
  }

  // Default: internal server error (no stack trace leaked to client)
  console.error('[ErrorHandler]', err);
  res.status(500).json({ error: 'Internal server error.' });
}
