import React from 'react'
import { useImageManager } from '../hooks/useImageManager'
import ImageCounter from './ImageCounter'
import ThumbnailGrid from './ThumbnailGrid'
import FullscreenViewer from './FullscreenViewer'
import AddImageButton from './AddImageButton'

/**
 * Top-level component for the damage-report image management feature.
 * Combines counter, thumbnail grid, fullscreen viewer and add button.
 */
const DamageReportImageManager: React.FC = () => {
  const {
    images,
    selectedImage,
    isAtMax,
    count,
    max,
    addImages,
    removeImage,
    openImage,
    closeImage,
  } = useImageManager()

  const handleFilesSelected = (files: FileList) => {
    addImages(files)
  }

  return (
    <section className="damage-image-manager" aria-label="Schadensfotos verwalten">
      <header className="damage-image-manager__header">
        <h2 className="damage-image-manager__title">Schadensfotos</h2>
        <ImageCounter count={count} max={max} />
      </header>

      <ThumbnailGrid images={images} onRemove={removeImage} onOpen={openImage} />

      <AddImageButton isDisabled={isAtMax} onFilesSelected={handleFilesSelected} />

      <FullscreenViewer image={selectedImage} onClose={closeImage} />
    </section>
  )
}

export default DamageReportImageManager
