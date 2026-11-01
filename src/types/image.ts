export interface DamageImage {
  id: string
  file: File
  /** Object URL for display – generated once and cached */
  previewUrl: string
  /** Thumbnail Object URL (same as previewUrl for now; in prod would be compressed) */
  thumbnailUrl: string
}

export const MAX_IMAGES = 10
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic']
export const MAX_FILE_SIZE_MB = 15
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
