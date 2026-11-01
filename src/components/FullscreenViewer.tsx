import React, { useEffect, useCallback } from 'react'
import { DamageImage } from '../types/image'

interface Props {
  image: DamageImage | null
  onClose: () => void
}

/**
 * Modal fullscreen viewer for a single damage image.
 * Closes on backdrop click or Escape key.
 */
const FullscreenViewer: React.FC<Props> = ({ image, onClose }) => {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    if (image) {
      document.addEventListener('keydown', handleKey)
    }
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [image, handleKey])

  if (!image) return null

  return (
    <div
      className="fullscreen-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Bildvorschau"
      data-testid="fullscreen-viewer"
      onClick={onClose}
    >
      <div
        className="fullscreen-viewer__content"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="fullscreen-viewer__close-btn"
          onClick={onClose}
          aria-label="Vollbildansicht schließen"
          data-testid="fullscreen-close"
        >
          ✕
        </button>
        <img
          src={image.previewUrl}
          alt={image.file.name}
          className="fullscreen-viewer__img"
          data-testid="fullscreen-img"
        />
        <p className="fullscreen-viewer__filename">{image.file.name}</p>
      </div>
    </div>
  )
}

export default FullscreenViewer
