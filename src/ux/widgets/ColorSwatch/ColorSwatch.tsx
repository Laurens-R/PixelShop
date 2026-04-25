import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { EmbedColorPicker } from '@/ux/widgets/EmbedColorPicker/EmbedColorPicker'
import styles from './ColorSwatch.module.scss'

// ─── Popup ────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

interface PopupProps {
  value: string
  anchorEl: HTMLElement | null
  onClose: () => void
  onChange: (hex: string) => void
}

function ColorPickerPopup({ value, anchorEl, onClose, onChange }: PopupProps): React.JSX.Element | null {
  const popupRef = useRef<HTMLDivElement>(null)

  // Position popup above/below anchor
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useEffect(() => {
    if (!anchorEl) return
    const rect = anchorEl.getBoundingClientRect()
    const popupH = 280
    const popupW = 210
    const top = rect.top > popupH + 8
      ? rect.top - popupH - 6
      : rect.bottom + 6
    const left = clamp(rect.left, 8, window.innerWidth - popupW - 8)
    setPos({ top, left })
  }, [anchorEl])

  // Close on outside click
  useEffect(() => {
    const handler = (e: PointerEvent): void => {
      if (popupRef.current?.contains(e.target as Node)) return
      if (anchorEl?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('pointerdown', handler, { capture: true })
    return () => document.removeEventListener('pointerdown', handler, { capture: true })
  }, [anchorEl, onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return ReactDOM.createPortal(
    <div
      ref={popupRef}
      className={styles.popup}
      style={{ top: pos.top, left: pos.left }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <EmbedColorPicker value={value} onChange={onChange} />
    </div>,
    document.body,
  )
}

// ─── ColorSwatch ─────────────────────────────────────────────────────────────

export interface ColorSwatchProps {
  /** Hex color string, e.g. `#ff0000` */
  value: string
  onChange: (hex: string) => void
  title?: string
  /** Extra class names for the swatch button */
  className?: string
}

/**
 * A small colored swatch button that opens an app-styled color picker popup on click.
 * Use wherever a `<input type="color">` would appear.
 */
export function ColorSwatch({ value, onChange, title = 'Pick color', className }: ColorSwatchProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={btnRef}
        className={[styles.swatch, className].filter(Boolean).join(' ')}
        style={{ background: value }}
        title={title}
        onClick={() => setOpen((o) => !o)}
        aria-label={title}
      />
      {open && (
        <ColorPickerPopup
          value={value}
          anchorEl={btnRef.current}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
