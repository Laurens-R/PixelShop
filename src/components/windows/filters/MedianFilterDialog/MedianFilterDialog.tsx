import React, { useState, useEffect, useCallback, useRef } from 'react'
import { median } from '@/webgpu/compute/filterCompute'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/ui/Canvas/canvasHandle'
import { ToolWindow } from '@/components'
import styles from './MedianFilterDialog.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_RADIUS     = 1
const MAX_RADIUS     = 10
const DEFAULT_RADIUS = 1
const DEBOUNCE_MS    = 25

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)))
}

// ─── Selection-aware compositing helper ───────────────────────────────────────

function applySelectionComposite(
  filtered: Uint8Array,
  original: Uint8Array,
  mask:     Uint8Array | null,
): Uint8Array {
  if (mask === null) return filtered

  const out = original.slice()
  const pixelCount = mask.length
  for (let i = 0; i < pixelCount; i++) {
    if (mask[i] !== 0) {
      const p = i * 4
      out[p]     = filtered[p]
      out[p + 1] = filtered[p + 1]
      out[p + 2] = filtered[p + 2]
      out[p + 3] = filtered[p + 3]
    }
  }
  return out
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const MedianIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <circle cx="2.2" cy="2.2" r="1.1" stroke="currentColor" strokeWidth="0.9" opacity="0.4"/>
    <circle cx="6.0" cy="2.2" r="1.1" stroke="currentColor" strokeWidth="0.9" opacity="0.4"/>
    <circle cx="9.8" cy="2.2" r="1.1" stroke="currentColor" strokeWidth="0.9" opacity="0.4"/>
    <circle cx="2.2" cy="6.0" r="1.1" stroke="currentColor" strokeWidth="0.9" opacity="0.4"/>
    <circle cx="6.0" cy="6.0" r="1.5" fill="currentColor"/>
    <circle cx="9.8" cy="6.0" r="1.1" stroke="currentColor" strokeWidth="0.9" opacity="0.4"/>
    <circle cx="2.2" cy="9.8" r="1.1" stroke="currentColor" strokeWidth="0.9" opacity="0.4"/>
    <circle cx="6.0" cy="9.8" r="1.1" stroke="currentColor" strokeWidth="0.9" opacity="0.4"/>
    <circle cx="9.8" cy="9.8" r="1.1" stroke="currentColor" strokeWidth="0.9" opacity="0.4"/>
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MedianFilterDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MedianFilterDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: MedianFilterDialogProps): React.JSX.Element | null {
  const [radius, setRadius] = useState(DEFAULT_RADIUS)
  const [isBusy, setIsBusy] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isBusyRef         = useRef(false)
  const originalPixelsRef = useRef<Uint8Array | null>(null)
  const selectionMaskRef  = useRef<Uint8Array | null>(null)
  const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Initialization effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return

    originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
    selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
    setRadius(DEFAULT_RADIUS)
    setIsBusy(false)
    isBusyRef.current = false
    setHasSelection(selectionMaskRef.current !== null)
    setErrorMessage(null)

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [isOpen, canvasHandleRef, activeLayerId])

  // ── Preview ──────────────────────────────────────────────────────
  const runPreview = useCallback(async (r: number): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(r)
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const filtered = await median(original.slice(), canvasWidth, canvasHeight, r)
      const composed = applySelectionComposite(filtered, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])

  const handleRadiusChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_RADIUS, MAX_RADIUS)
    setRadius(clamped)
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(clamped)
    }, DEBOUNCE_MS)
  }, [runPreview])

  // ── Apply ────────────────────────────────────────────────────────
  const handleApply = useCallback(async (): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const filtered = await median(original.slice(), canvasWidth, canvasHeight, radius)
      const composed = applySelectionComposite(filtered, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Median Filter')
      onClose()
    } catch (err) {
      console.error('[MedianFilter] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred while applying the filter.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, radius, captureHistory, onClose])

  // ── Cancel ───────────────────────────────────────────────────────
  const handleCancel = useCallback((): void => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (handle && activeLayerId != null && original != null) {
      handle.writeLayerPixels(activeLayerId, original)
    }
    onClose()
  }, [canvasHandleRef, activeLayerId, onClose])

  // ── Escape key ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') handleCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, handleCancel])

  // ── Render ───────────────────────────────────────────────────────
  if (!isOpen) return null

  return (
    <ToolWindow title="Median Filter" icon={<MedianIcon />} onClose={handleCancel} width={284}>
      <div className={styles.body}>
        <div className={styles.row}>
          <label className={styles.label}>Radius</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_RADIUS} max={MAX_RADIUS} step={1}
            value={radius}
            onChange={e => handleRadiusChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_RADIUS} max={MAX_RADIUS} step={1}
            value={radius}
            onChange={e => handleRadiusChange(e.target.valueAsNumber)}
            onBlur={e  => handleRadiusChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>px</span>
        </div>
        {isBusy && (
          <div className={styles.previewIndicator}>
            <span className={styles.spinner} />
            Previewing…
            <span className={styles.previewParams}>Radius: {radius} px</span>
          </div>
        )}
        {hasSelection && (
          <div className={styles.selectionNote}>
            <span className={styles.selectionNoteIcon} aria-hidden="true">
              <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                <rect x="1" y="1" width="9" height="9" rx="1"
                      stroke="currentColor" strokeWidth="1"
                      strokeDasharray="2 1.5" fill="none"/>
              </svg>
            </span>
            <span className={styles.selectionNoteText}>Selection active — filter applies only within the selected area.</span>
          </div>
        )}
        {errorMessage != null && (
          <div className={styles.errorMessage}>
            {errorMessage}
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <button className={styles.btnCancel} onClick={handleCancel}>Cancel</button>
        <button className={styles.btnApply} onClick={() => { void handleApply() }} disabled={isBusy}>Apply</button>
      </div>
    </ToolWindow>
  )
}
