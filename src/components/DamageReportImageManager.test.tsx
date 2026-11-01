import React from 'react'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import DamageReportImageManager from './DamageReportImageManager'
import { MAX_IMAGES } from '../types/image'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fake image File with given name and type */
function makeFile(name = 'photo.jpg', type = 'image/jpeg', sizeBytes = 1024): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type })
  return new File([blob], name, { type })
}

/**
 * Build a minimal FileList-like object without DataTransfer
 * (jsdom does not implement DataTransfer).
 */
function makeFakeFileList(files: File[]): FileList {
  const fl = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () { yield* files },
  }
  files.forEach((f, i) => { (fl as Record<string, unknown>)[i] = f })
  return fl as unknown as FileList
}

/** Trigger the hidden file input with the given files */
function uploadFiles(files: File[]) {
  const input = screen.getByTestId('file-input') as HTMLInputElement
  const fileList = makeFakeFileList(files)
  Object.defineProperty(input, 'files', { value: fileList, configurable: true })
  fireEvent.change(input)
}

/** Add N individual images one at a time */
function addNImages(n: number) {
  for (let i = 0; i < n; i++) {
    uploadFiles([makeFile(`photo${i}.jpg`)])
  }
}

// Mock URL.createObjectURL / revokeObjectURL (jsdom doesn't implement them)
beforeEach(() => {
  let counter = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-url-${++counter}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DamageReportImageManager', () => {

  // ── AC1: Thumbnail grid ───────────────────────────────────────────────────

  describe('AC1 – Thumbnail grid', () => {
    it('shows empty state initially', () => {
      render(<DamageReportImageManager />)
      expect(screen.getByTestId('thumbnail-grid-empty')).toBeInTheDocument()
    })

    it('renders thumbnails for added images', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('a.jpg'), makeFile('b.jpg')])
      const grid = screen.getByTestId('thumbnail-grid')
      expect(within(grid).getAllByRole('listitem')).toHaveLength(2)
    })

    it('renders thumbnail img elements with lazy loading attribute', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('lazy.jpg')])
      const grid = screen.getByTestId('thumbnail-grid')
      const imgs = within(grid).getAllByRole('img')
      imgs.forEach((img) => {
        expect(img).toHaveAttribute('loading', 'lazy')
      })
    })

    it('all 10 thumbnails are rendered immediately (performance check)', () => {
      render(<DamageReportImageManager />)
      const files = Array.from({ length: 10 }, (_, i) => makeFile(`p${i}.jpg`))
      const start = performance.now()
      // Upload all 10 at once
      uploadFiles(files)
      const grid = screen.getByTestId('thumbnail-grid')
      const items = within(grid).getAllByRole('listitem')
      const end = performance.now()
      expect(items).toHaveLength(10)
      expect(end - start).toBeLessThan(2000)
    })
  })

  // ── AC2: Counter display ─────────────────────────────────────────────────

  describe('AC2 – Counter display', () => {
    it('shows "0 / 10" initially', () => {
      render(<DamageReportImageManager />)
      const counter = screen.getByTestId('image-counter')
      expect(counter.textContent).toMatch(/0\s*\/\s*10/)
    })

    it('updates counter when images are added', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])
      const counter = screen.getByTestId('image-counter')
      expect(counter.textContent).toMatch(/3\s*\/\s*10/)
    })

    it('counter shows correct format with separator', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('x.jpg')])
      const counter = screen.getByTestId('image-counter')
      expect(counter.textContent).toMatch(/1\s*\/\s*10/)
    })
  })

  // ── AC3: Lock at max ─────────────────────────────────────────────────────

  describe('AC3 – Lock at max (10 images)', () => {
    it('add button is enabled when below max', () => {
      render(<DamageReportImageManager />)
      expect(screen.getByTestId('add-image-btn')).not.toBeDisabled()
    })

    it('add button is disabled when 10 images reached', () => {
      render(<DamageReportImageManager />)
      addNImages(10)
      expect(screen.getByTestId('add-image-btn')).toBeDisabled()
    })

    it('shows explanatory message when at max', () => {
      render(<DamageReportImageManager />)
      addNImages(10)
      expect(screen.getByTestId('max-reached-msg')).toBeInTheDocument()
    })

    it('explanatory message is not shown below max', () => {
      render(<DamageReportImageManager />)
      addNImages(5)
      expect(screen.queryByTestId('max-reached-msg')).not.toBeInTheDocument()
    })

    it('does not add more than 10 images even if multiple files selected at once', () => {
      render(<DamageReportImageManager />)
      addNImages(9)
      // Try to add 3 more – only 1 should be accepted
      uploadFiles([makeFile('x1.jpg'), makeFile('x2.jpg'), makeFile('x3.jpg')])
      const grid = screen.getByTestId('thumbnail-grid')
      expect(within(grid).getAllByRole('listitem')).toHaveLength(10)
    })
  })

  // ── AC4: Fullscreen on tap ────────────────────────────────────────────────

  describe('AC4 – Fullscreen viewer on thumbnail tap', () => {
    it('fullscreen viewer is not visible initially', () => {
      render(<DamageReportImageManager />)
      expect(screen.queryByTestId('fullscreen-viewer')).not.toBeInTheDocument()
    })

    it('opens fullscreen when thumbnail is clicked', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('damage1.jpg')])
      const grid = screen.getByTestId('thumbnail-grid')
      const openBtn = within(grid).getAllByRole('button', { name: /vergrößern/i })[0]
      fireEvent.click(openBtn)
      expect(screen.getByTestId('fullscreen-viewer')).toBeInTheDocument()
      expect(screen.getByTestId('fullscreen-img')).toBeInTheDocument()
    })

    it('closes fullscreen when close button is clicked', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('damage1.jpg')])
      const openBtn = within(screen.getByTestId('thumbnail-grid'))
        .getAllByRole('button', { name: /vergrößern/i })[0]
      fireEvent.click(openBtn)
      fireEvent.click(screen.getByTestId('fullscreen-close'))
      expect(screen.queryByTestId('fullscreen-viewer')).not.toBeInTheDocument()
    })

    it('closes fullscreen on Escape key', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('damage1.jpg')])
      const openBtn = within(screen.getByTestId('thumbnail-grid'))
        .getAllByRole('button', { name: /vergrößern/i })[0]
      fireEvent.click(openBtn)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByTestId('fullscreen-viewer')).not.toBeInTheDocument()
    })

    it('closes fullscreen when backdrop is clicked', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('damage1.jpg')])
      const openBtn = within(screen.getByTestId('thumbnail-grid'))
        .getAllByRole('button', { name: /vergrößern/i })[0]
      fireEvent.click(openBtn)
      // Click the backdrop div (the viewer itself, not its inner content)
      fireEvent.click(screen.getByTestId('fullscreen-viewer'))
      expect(screen.queryByTestId('fullscreen-viewer')).not.toBeInTheDocument()
    })

    it('shows correct image in fullscreen when second thumbnail is clicked', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('first.jpg'), makeFile('second.jpg')])
      const grid = screen.getByTestId('thumbnail-grid')
      const openBtns = within(grid).getAllByRole('button', { name: /vergrößern/i })
      fireEvent.click(openBtns[1])
      expect(screen.getByTestId('fullscreen-img')).toHaveAttribute('alt', 'second.jpg')
    })
  })

  // ── AC5: Remove with X and counter update ────────────────────────────────

  describe('AC5 – Remove image with X button, counter updates immediately', () => {
    it('removes an image when X is clicked', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('remove-me.jpg')])
      const removeBtn = screen.getByRole('button', { name: /entfernen/i })
      fireEvent.click(removeBtn)
      expect(screen.getByTestId('thumbnail-grid-empty')).toBeInTheDocument()
    })

    it('counter decrements immediately after remove', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])
      expect(screen.getByTestId('image-counter').textContent).toMatch(/3\s*\/\s*10/)
      const removeBtns = screen.getAllByRole('button', { name: /entfernen/i })
      fireEvent.click(removeBtns[0])
      expect(screen.getByTestId('image-counter').textContent).toMatch(/2\s*\/\s*10/)
    })

    it('removing an image re-enables the add button when was at max', () => {
      render(<DamageReportImageManager />)
      addNImages(10)
      expect(screen.getByTestId('add-image-btn')).toBeDisabled()
      const removeBtns = screen.getAllByRole('button', { name: /entfernen/i })
      fireEvent.click(removeBtns[0])
      expect(screen.getByTestId('add-image-btn')).not.toBeDisabled()
    })

    it('removes the correct image when multiple images exist', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('keep.jpg'), makeFile('delete.jpg')])
      const grid = screen.getByTestId('thumbnail-grid')
      const items = within(grid).getAllByRole('listitem')
      expect(items).toHaveLength(2)
      // Remove the second image
      const removeBtn = within(items[1]).getByRole('button', { name: /entfernen/i })
      fireEvent.click(removeBtn)
      const remainingItems = within(screen.getByTestId('thumbnail-grid')).getAllByRole('listitem')
      expect(remainingItems).toHaveLength(1)
      expect(within(remainingItems[0]).getByRole('img')).toHaveAttribute('alt', 'keep.jpg')
    })

    it('closes fullscreen viewer when the displayed image is removed', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('opened.jpg')])
      const openBtn = within(screen.getByTestId('thumbnail-grid'))
        .getAllByRole('button', { name: /vergrößern/i })[0]
      fireEvent.click(openBtn)
      expect(screen.getByTestId('fullscreen-viewer')).toBeInTheDocument()
      // Remove while fullscreen is open – use the thumbnail remove button
      const removeBtn = within(screen.getByTestId('thumbnail-grid'))
        .getByRole('button', { name: /entfernen/i })
      fireEvent.click(removeBtn)
      expect(screen.queryByTestId('fullscreen-viewer')).not.toBeInTheDocument()
    })
  })

  // ── AC6: Performance – 10 thumbnails visible within 2 seconds ────────────

  describe('AC6 – Performance: 10 thumbnails rendered within 2000ms', () => {
    it('renders all 10 thumbnails in under 2000ms', () => {
      render(<DamageReportImageManager />)
      const files = Array.from({ length: 10 }, (_, i) => makeFile(`perf${i}.jpg`))
      const t0 = performance.now()
      uploadFiles(files)
      const grid = screen.getByTestId('thumbnail-grid')
      const items = within(grid).getAllByRole('listitem')
      const t1 = performance.now()
      expect(items).toHaveLength(10)
      expect(t1 - t0).toBeLessThan(2000)
    })
  })

  // ── AC7: Lazy loading & client-side caching ───────────────────────────────

  describe('AC7 – Lazy loading and client-side caching', () => {
    it('all thumbnail images have loading="lazy" attribute', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('lazy1.jpg'), makeFile('lazy2.jpg')])
      const grid = screen.getByTestId('thumbnail-grid')
      within(grid).getAllByRole('img').forEach((img) => {
        expect(img).toHaveAttribute('loading', 'lazy')
      })
    })

    it('createObjectURL is called exactly once per unique image (caching)', () => {
      render(<DamageReportImageManager />)
      const spy = URL.createObjectURL as ReturnType<typeof vi.spyOn>
      uploadFiles([makeFile('c1.jpg'), makeFile('c2.jpg'), makeFile('c3.jpg')])
      expect(spy).toHaveBeenCalledTimes(3)
    })

    it('revokeObjectURL is called when an image is removed (memory management)', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('revoke.jpg')])
      const revokeSpy = URL.revokeObjectURL as ReturnType<typeof vi.spyOn>
      fireEvent.click(screen.getByRole('button', { name: /entfernen/i }))
      expect(revokeSpy).toHaveBeenCalledTimes(1)
    })
  })

  // ── AC8: Additional UI / accessibility edge cases ─────────────────────────

  describe('AC8 – Additional UI edge cases', () => {
    it('counter has accessible aria-label', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('a.jpg')])
      expect(screen.getByLabelText(/1 von 10 Bildern hinzugefügt/i)).toBeInTheDocument()
    })

    it('fullscreen dialog has role="dialog" for accessibility', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('aria.jpg')])
      const openBtn = within(screen.getByTestId('thumbnail-grid'))
        .getAllByRole('button', { name: /vergrößern/i })[0]
      fireEvent.click(openBtn)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('does not accept files with unsupported MIME types', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('doc.pdf', 'application/pdf')])
      expect(screen.getByTestId('thumbnail-grid-empty')).toBeInTheDocument()
    })

    it('does not accept files larger than 15 MB', () => {
      render(<DamageReportImageManager />)
      const bigFile = makeFile('huge.jpg', 'image/jpeg', 16 * 1024 * 1024)
      uploadFiles([bigFile])
      expect(screen.getByTestId('thumbnail-grid-empty')).toBeInTheDocument()
    })

    it('accepts HEIC files', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('photo.heic', 'image/heic')])
      expect(within(screen.getByTestId('thumbnail-grid')).getAllByRole('listitem')).toHaveLength(1)
    })

    it('accepts PNG files', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('image.png', 'image/png')])
      expect(within(screen.getByTestId('thumbnail-grid')).getAllByRole('listitem')).toHaveLength(1)
    })

    it('thumbnail list is semantically a list (role="list")', () => {
      render(<DamageReportImageManager />)
      uploadFiles([makeFile('acc.jpg')])
      const list = screen.getByRole('list')
      expect(list).toBeInTheDocument()
      expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    })
  })
})
