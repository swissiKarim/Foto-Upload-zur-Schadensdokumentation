import React from 'react'
import { DamageImage } from '../types/image'

interface Props {
  images: DamageImage[]
  onRemove: (id: string) => void
  onOpen: (id: string) => void
}

/**
 * Renders all damage images as a thumbnail grid.
 * Each thumbnail has an "X" remove button and is clickable for fullscreen view.
 * Images use loading="lazy" for lazy loading and are cached via Object URLs.
 */
const ThumbnailGrid: React.FC<Props> = ({ images, onRemove, onOpen }) => {
  if (images.length === 0) {
    return (
      <p className="thumbnail-grid__empty" data-testid="thumbnail-grid-empty">
        Noch keine Bilder hinzugefügt.
      </p>
    )
  }

  return (
    <ul className="thumbnail-grid" data-testid="thumbnail-grid" role="list">
      {images.map((img) => (
        <li key={img.id} className="thumbnail-grid__item" data-testid={`thumbnail-item-${img.id}`}>
          <button
            className="thumbnail-grid__preview-btn"
            onClick={() => onOpen(img.id)}
            aria-label={`Bild ${img.file.name} vergrößern`}
            data-testid={`thumbnail-open-${img.id}`}
          >
            <img
              src={img.thumbnailUrl}
              alt={img.file.name}
              className="thumbnail-grid__img"
              loading="lazy"
              decoding="async"
              data-testid={`thumbnail-img-${img.id}`}
            />
          </button>
          <button
            className="thumbnail-grid__remove-btn"
            onClick={() => onRemove(img.id)}
            aria-label={`Bild ${img.file.name} entfernen`}
            data-testid={`thumbnail-remove-${img.id}`}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  )
}

export default ThumbnailGrid
