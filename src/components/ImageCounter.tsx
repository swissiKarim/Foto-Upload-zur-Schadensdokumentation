import React from 'react'

interface Props {
  count: number
  max: number
}

/**
 * Visible counter that shows e.g. "3 / 10".
 */
const ImageCounter: React.FC<Props> = ({ count, max }) => (
  <div
    className="image-counter"
    aria-label={`${count} von ${max} Bildern hinzugefügt`}
    data-testid="image-counter"
  >
    <span className="image-counter__value">{count}</span>
    <span className="image-counter__separator"> / </span>
    <span className="image-counter__max">{max}</span>
  </div>
)

export default ImageCounter
