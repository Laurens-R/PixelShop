import React, { useState, useEffect, useCallback, useRef } from 'react'
import { bilateral } from '@/graphicspipeline/webgpu/compute/filterCompute'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/ui/Canvas/canvasHandle'
import { ToolWindow } from '@/ux'
import styles from './BilateralFilterDialog.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_SPATIAL_RADIUS     = 1
const MAX_SPATIAL_RADIUS     = 20
const DEFAULT_SPATIAL_RADIUS = 5

const MIN_COLOR_SIGMA     = 1
const MAX_COLOR_SIGMA     = 150
const DEFAULT_COLOR_SIGMA = 25

const DEBOUNCE_MS = 25

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

// ─── Icon ─────────────────────────────────────────────────────────────────────

const BilateralIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <circle cx="5.2" cy="6" r="4.4"
            stroke="currentColor" strokeWidth="0.8" opacity="0.22"/>
    <circle cx="5.2" cy="6" r="2.7"
            stroke="currentColor" strokeWidth="0.9" opacity="0.5"/>
    <circle cx="5.2" cy="6" r="1.2" fill="currentColor"/>
    <line x1="9.5" y1="1.8" x2="9.5" y2="10.2"
          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BilateralFilterDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BilateralFilterDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: BilateralFilterDialogProps): React.JSX.Element | null {
  const [spatialRadius, setSpatialRadius] = useState(DEFAULT_SPATIAL_RADIUS)
  const [colorSigma,    setColorSigma]    = useState(DEFAULT_COLOR_SIGMA)
  const [isBusy,        setIsBusy]        = useState(false)
  const [hasSelection,  setHasSelection]  = useState(false)
  const [errorMessage,  setErrorMessage]  = useState<string | null>(null)

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
    setSpatialRadius(DEFAULT_SPATIAL_RADIUS)
    setColorSigma(DEFAULT_COLOR_SIGMA)
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
  const runPreview = useCallback(async (sr: number, cs: number): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(sr, cs)
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const sigmaSpatial = sr
      const sigmaColor   = cs / 255.0
      const filtered = await bilateral(original.slice(), canvasWidth, canvasHeight, sr, sigmaSpatial, sigmaColor)
      const composed = applySelectionComposite(filtered, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])

  const handleSpatialRadiusChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_SPATIAL_RADIUS, MAX_SPATIAL_RADIUS)
    setSpatialRadius(clamped)
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(clamped, colorSigma)
    }, DEBOUNCE_MS)
  }, [runPreview, colorSigma])

  const handleColorSigmaChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_COLOR_SIGMA, MAX_COLOR_SIGMA)
    setColorSigma(clamped)
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(spatialRadius, clamped)
    }, DEBOUNCE_MS)
  }, [runPreview, spatialRadius])

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
      const sigmaSpatial = spatialRadius
      const sigmaColor   = colorSigma / 255.0
      const filtered = await bilateral(original.slice(), canvasWidth, canvasHeight, spatialRadius, sigmaSpatial, sigmaColor)
      const composed = applySelectionComposite(filtered, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Bilateral Filter')
      onClose()
    } catch (err) {
      console.error('[BilateralFilter] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred while applying the filter.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, spatialRadius, colorSigma, captureHistory, onClose])

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
    <ToolWindow title="Bilateral Filter" icon={<BilateralIcon />} onClose={handleCancel} width={284}>
      <div className={styles.body}>
        <div className={styles.row}>
          <label className={styles.label}>Spatial Radius</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_SPATIAL_RADIUS} max={MAX_SPATIAL_RADIUS} step={1}
            value={spatialRadius}
            onChange={e => handleSpatialRadiusChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_SPATIAL_RADIUS} max={MAX_SPATIAL_RADIUS} step={1}
            value={spatialRadius}
            onChange={e => handleSpatialRadiusChange(e.target.valueAsNumber)}
            onBlur={e  => handleSpatialRadiusChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>px</span>
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Color Sigma</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_COLOR_SIGMA} max={MAX_COLOR_SIGMA} step={1}
            value={colorSigma}
            onChange={e => handleColorSigmaChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_COLOR_SIGMA} max={MAX_COLOR_SIGMA} step={1}
            value={colorSigma}
            onChange={e => handleColorSigmaChange(e.target.valueAsNumber)}
            onBlur={e  => handleColorSigmaChange(e.target.valueAsNumber)}
          />
          <span style={{ visibility: 'hidden' }} className={styles.unit}>σ</span>
        </div>
        {isBusy && (
          <div className={styles.previewIndicator}>
            <span className={styles.spinner} />
            Previewing…
            <span className={styles.previewParams}>R {spatialRadius} px · σ {colorSigma}</span>
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
