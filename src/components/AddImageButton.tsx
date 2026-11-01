import React, { useRef } from 'react'
import { ACCEPTED_TYPES } from '../types/image'

interface Props {
  isDisabled: boolean
  onFilesSelected: (files: FileList) => void
}

/**
 * Button that triggers a file picker. Disabled with explanatory message when max is reached.
 */
const AddImageButton: React.FC<Props> = ({ isDisabled, onFilesSelected }) => {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    if (!isDisabled) inputRef.current?.click()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files)
      // Reset input so the same file can be re-selected if removed
      e.target.value = ''
    }
  }

  return (
    <div className="add-image-btn-wrapper">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        multiple
        hidden
        onChange={handleChange}
        data-testid="file-input"
        aria-hidden="true"
      />
      <button
        className="add-image-btn"
        onClick={handleClick}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        data-testid="add-image-btn"
        aria-label="Bilder hinzufügen"
      >
        + Bild hinzufügen
      </button>
      {isDisabled && (
        <p
          className="add-image-btn__limit-msg"
          role="alert"
          data-testid="max-reached-msg"
        >
          Maximale Anzahl von 10 Bildern erreicht. Bitte entferne ein Bild, um ein neues hinzuzufügen.
        </p>
      )}
    </div>
  )
}

export default AddImageButton
