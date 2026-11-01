/**
 * Image Compression Module
 *
 * Compresses images automatically in a background-thread-like async manner
 * without user interaction. Supports .jpg, .png, .heic (converted to jpeg).
 *
 * AC: "Vor dem Upload komprimiert die App jedes Bild automatisch, asynchron
 *      im Hintergrund-Thread, ohne Nutzerinteraktion."
 */

import sharp from 'sharp';
import * as path from 'path';

export type SupportedFormat = 'jpg' | 'jpeg' | 'png' | 'heic';

export interface CompressOptions {
  /** JPEG quality 1-100 (default 75) */
  jpegQuality?: number;
  /** PNG compression level 0-9 (default 7) */
  pngCompressionLevel?: number;
  /** Max width/height in pixels – images are scaled down proportionally (default 2048) */
  maxDimension?: number;
}

export interface CompressResult {
  data: Buffer;
  originalSize: number;
  compressedSize: number;
  format: string;
  compressionRatio: number;
}

const SUPPORTED_FORMATS: SupportedFormat[] = ['jpg', 'jpeg', 'png', 'heic'];
const MAX_ORIGINAL_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Validates that the file extension is among the supported formats.
 */
export function validateFormat(filename: string): void {
  const ext = path.extname(filename).toLowerCase().replace('.', '') as SupportedFormat;
  if (!SUPPORTED_FORMATS.includes(ext)) {
    throw new Error(
      `Unsupported file format: .${ext}. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`
    );
  }
}

/**
 * Validates that the input buffer does not exceed the 15 MB limit.
 */
export function validateSize(buffer: Buffer): void {
  if (buffer.length > MAX_ORIGINAL_SIZE_BYTES) {
    throw new Error(
      `Image exceeds maximum allowed size of 15 MB (got ${(buffer.length / 1024 / 1024).toFixed(2)} MB)`
    );
  }
}

/**
 * Compresses an image buffer asynchronously.
 * HEIC images are converted to JPEG during compression.
 * All output is JPEG to minimise size for upload.
 *
 * This function is intentionally async to allow the caller to run it
 * off the main UI thread (e.g. via a Worker or background queue).
 */
export async function compressImage(
  inputBuffer: Buffer,
  filename: string,
  options: CompressOptions = {}
): Promise<CompressResult> {
  validateFormat(filename);
  validateSize(inputBuffer);

  const {
    jpegQuality = 75,
    maxDimension = 2048,
  } = options;

  const originalSize = inputBuffer.length;

  // sharp handles HEIC when libheif is available; for HEIC we always output JPEG.
  const image = sharp(inputBuffer);
  const metadata = await image.metadata();

  // Resize proportionally if either dimension exceeds maxDimension
  const needsResize =
    (metadata.width && metadata.width > maxDimension) ||
    (metadata.height && metadata.height > maxDimension);

  let pipeline = needsResize
    ? image.resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
    : image;

  // Always output as JPEG for consistent, smaller uploads
  const compressedBuffer = await pipeline
    .jpeg({ quality: jpegQuality, mozjpeg: true })
    .toBuffer();

  const compressedSize = compressedBuffer.length;

  return {
    data: compressedBuffer,
    originalSize,
    compressedSize,
    format: 'jpeg',
    compressionRatio: originalSize > 0 ? compressedSize / originalSize : 1,
  };
}
