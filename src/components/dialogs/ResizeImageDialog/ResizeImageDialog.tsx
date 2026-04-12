import React, { useState, useEffect, useCallback } from 'react'
import { DialogButton } from '../../widgets/DialogButton/DialogButton'
import { SliderInput } from '../../widgets/SliderInput/SliderInput'
import { ModalDialog } from '../ModalDialog/ModalDialog'
import styles from './ResizeImageDialog.module.scss'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResizeFilter = 'bilinear' | 'nearest'

export interface ResizeImageSettings {
  width: number
  height: number
  filter: ResizeFilter
}

export interface ResizeImageDialogProps {
  open: boolean
  currentWidth: number
  currentHeight: number
  onConfirm: (settings: ResizeImageSettings) => void
  onCancel: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ResizeImageDialog({
  open,
  currentWidth,
  currentHeight,
  onConfirm,
  onCancel,
}: ResizeImageDialogProps): React.JSX.Element | null {
  const [width, setWidth]           = useState(currentWidth)
  const [height, setHeight]         = useState(currentHeight)
  const [constrain, setConstrain]   = useState(true)
  const [filter, setFilter]         = useState<ResizeFilter>('bilinear')
  // Track which field was last changed so the ratio is applied correctly
  const [lastChanged, setLastChanged] = useState<'width' | 'height'>('width')

  // Reset to current canvas size each time dialog opens
  useEffect(() => {
    if (open) {
      setWidth(currentWidth)
      setHeight(currentHeight)
      setConstrain(true)
      setFilter('bilinear')
      setLastChanged('width')
    }
  }, [open, currentWidth, currentHeight])

  const handleWidthChange = useCallback((v: number): void => {
    const w = Math.max(1, Math.round(v))
    setWidth(w)
    setLastChanged('width')
    if (constrain && currentHeight > 0) {
      setHeight(Math.max(1, Math.round(w * currentHeight / currentWidth)))
    }
  }, [constrain, currentWidth, currentHeight])

  const handleHeightChange = useCallback((v: number): void => {
    const h = Math.max(1, Math.round(v))
    setHeight(h)
    setLastChanged('height')
    if (constrain && currentWidth > 0) {
      setWidth(Math.max(1, Math.round(h * currentWidth / currentHeight)))
    }
  }, [constrain, currentWidth, currentHeight])

  const handleConstrainToggle = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    setConstrain(e.target.checked)
    // When re-enabling constrain, snap the opposing axis based on whichever
    // was most recently edited.
    if (e.target.checked) {
      if (lastChanged === 'width') {
        setHeight(Math.max(1, Math.round(width * currentHeight / currentWidth)))
      } else {
        setWidth(Math.max(1, Math.round(height * currentWidth / currentHeight)))
      }
    }
  }, [lastChanged, width, height, currentWidth, currentHeight])

  const handleConfirm = useCallback((): void => {
    const w = Math.max(1, Math.min(8192, Math.round(width  || 1)))
    const h = Math.max(1, Math.min(8192, Math.round(height || 1)))
    onConfirm({ width: w, height: h, filter })
  }, [width, height, filter, onConfirm])

  // Enter = confirm
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') { e.stopPropagation(); handleConfirm() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, handleConfirm])

  const aspectRatio = currentWidth > 0 && currentHeight > 0
    ? (currentWidth / currentHeight).toFixed(3)
    : '—'

  return (
    <ModalDialog open={open} title="Image Size" width={360} onClose={onCancel}>
      <div className={styles.body}>

        {/* ── Current size info ─────────────────────────────────────── */}
        <p className={styles.currentSize}>
          Current: {currentWidth} × {currentHeight} px
        </p>

        {/* ── Width ─────────────────────────────────────────────────── */}
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Width</label>
          <SliderInput
            value={width}
            min={1}
            max={8192}
            inputWidth={60}
            suffix="px"
            onChange={handleWidthChange}
          />
        </div>

        {/* ── Chain icon between W and H ────────────────────────────── */}
        <div className={styles.constrainRow}>
          <div className={styles.chainLeft} />
          <label className={styles.constrainLabel}>
            <input
              type="checkbox"
              className={styles.constrainCheck}
              checked={constrain}
              onChange={handleConstrainToggle}
            />
            Constrain aspect ratio
            <span className={styles.aspectHint}>({aspectRatio})</span>
          </label>
          <div className={styles.chainRight} />
        </div>

        {/* ── Height ────────────────────────────────────────────────── */}
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Height</label>
          <SliderInput
            value={height}
            min={1}
            max={8192}
            inputWidth={60}
            suffix="px"
            onChange={handleHeightChange}
          />
        </div>

        <hr className={styles.divider} />

        {/* ── Resample filter ───────────────────────────────────────── */}
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Resample</label>
          <select
            className={styles.select}
            value={filter}
            onChange={e => setFilter(e.target.value as ResizeFilter)}
          >
            <option value="bilinear">Bilinear (smooth)</option>
            <option value="nearest">Nearest Neighbour (sharp)</option>
          </select>
        </div>

      </div>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <div className={styles.footer}>
        <DialogButton onClick={onCancel}>Cancel</DialogButton>
        <DialogButton onClick={handleConfirm} primary>OK</DialogButton>
      </div>
    </ModalDialog>
  )
}
