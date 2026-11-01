import { useState, useCallback, useRef } from 'react'
import { DamageImage, MAX_IMAGES, ACCEPTED_TYPES, MAX_FILE_SIZE_BYTES } from '../types/image'

export interface ImageManagerState {
  images: DamageImage[]
  selectedImage: DamageImage | null
  isAtMax: boolean
  count: number
  max: number
  addImages: (files: FileList | File[]) => string[]
  removeImage: (id: string) => void
  openImage: (id: string) => void
  closeImage: () => void
}

function generateId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Manages the list of damage images with preview URL caching.
 * Object URLs are revoked when images are removed to avoid memory leaks.
 */
export function useImageManager(): ImageManagerState {
  const [images, setImages] = useState<DamageImage[]>([])
  const [selectedImage, setSelectedImage] = useState<DamageImage | null>(null)
  // Cache: file reference → object URL (client-side caching)
  const urlCache = useRef<Map<string, string>>(new Map())

  const getOrCreateUrl = useCallback((file: File, cacheKey: string): string => {
    if (urlCache.current.has(cacheKey)) {
      return urlCache.current.get(cacheKey)!
    }
    const url = URL.createObjectURL(file)
    urlCache.current.set(cacheKey, url)
    return url
  }, [])

  const addImages = useCallback(
    (files: FileList | File[]): string[] => {
      const fileArray = Array.from(files)
      const errors: string[] = []

      setImages((prev) => {
        const remaining = MAX_IMAGES - prev.length
        if (remaining <= 0) {
          errors.push('Maximale Anzahl von 10 Bildern bereits erreicht.')
          return prev
        }

        const toAdd: DamageImage[] = []
        for (const file of fileArray) {
          if (prev.length + toAdd.length >= MAX_IMAGES) {
            errors.push(`Nur ${MAX_IMAGES} Bilder erlaubt. Einige Bilder wurden nicht hinzugefügt.`)
            break
          }
          if (!ACCEPTED_TYPES.includes(file.type)) {
            errors.push(`Dateiformat nicht unterstützt: ${file.name}`)
            continue
          }
          if (file.size > MAX_FILE_SIZE_BYTES) {
            errors.push(`Datei zu groß (max. 15 MB): ${file.name}`)
            continue
          }
          const id = generateId()
          const cacheKey = `${id}`
          const previewUrl = getOrCreateUrl(file, cacheKey)
          toAdd.push({ id, file, previewUrl, thumbnailUrl: previewUrl })
        }
        return [...prev, ...toAdd]
      })

      return errors
    },
    [getOrCreateUrl]
  )

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id)
      if (img) {
        // Revoke cached URL to free memory
        URL.revokeObjectURL(img.previewUrl)
        urlCache.current.delete(id)
      }
      return prev.filter((i) => i.id !== id)
    })
    setSelectedImage((sel) => (sel?.id === id ? null : sel))
  }, [])

  const openImage = useCallback(
    (id: string) => {
      setImages((prev) => {
        const img = prev.find((i) => i.id === id)
        if (img) setSelectedImage(img)
        return prev
      })
    },
    []
  )

  const closeImage = useCallback(() => {
    setSelectedImage(null)
  }, [])

  return {
    images,
    selectedImage,
    isAtMax: images.length >= MAX_IMAGES,
    count: images.length,
    max: MAX_IMAGES,
    addImages,
    removeImage,
    openImage,
    closeImage,
  }
}
