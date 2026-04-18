import React, { useState, useEffect, useCallback, useRef } from 'react'
import { filmGrain } from '@/webgpu/filterCompute'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/window/Canvas/canvasHandle'
import { ToolWindow } from '@/components'
import styles from './FilmGrainDialog.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 25

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)))
}

// ─── Selection-aware compositing helper ───────────────────────────────────────

function applySelectionComposite(
  processed: Uint8Array,
  original:  Uint8Array,
  mask:      Uint8Array | null,
): Uint8Array {
  if (mask === null) return processed
  const out = original.slice()
  const pixelCount = mask.length
  for (let i = 0; i < pixelCount; i++) {
    if (mask[i] !== 0) {
      const p = i * 4
      out[p]     = processed[p]
      out[p + 1] = processed[p + 1]
      out[p + 2] = processed[p + 2]
      out[p + 3] = processed[p + 3]
    }
  }
  return out
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const FilmGrainIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
    strokeWidth="1.1" aria-hidden="true">
    <rect x="1" y="1" width="10" height="10" rx="1" />
    <line x1="3" y1="1" x2="3" y2="11" opacity="0.4" />
    <line x1="6" y1="1" x2="6" y2="11" opacity="0.4" />
    <line x1="9" y1="1" x2="9" y2="11" opacity="0.4" />
    <circle cx="4.5" cy="4" r="0.6" fill="currentColor" stroke="none" opacity="0.7" />
    <circle cx="7.5" cy="7" r="0.6" fill="currentColor" stroke="none" opacity="0.7" />
    <circle cx="3" cy="7.5" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
    <circle cx="9" cy="3.5" r="0.5" fill="currentColor" stroke="none" opacity="0.5" />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FilmGrainDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FilmGrainDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: FilmGrainDialogProps): React.JSX.Element | null {
  const [grainSize,    setGrainSize]    = useState(5)
  const [intensity,    setIntensity]    = useState(35)
  const [roughness,    setRoughness]    = useState(50)
  const [isBusy,       setIsBusy]       = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isBusyRef         = useRef(false)
  const originalPixelsRef = useRef<Uint8Array | null>(null)
  const selectionMaskRef  = useRef<Uint8Array | null>(null)
  const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seedRef           = useRef(0)

  const grainSizeRef  = useRef(5)
  const intensityRef  = useRef(35)
  const roughnessRef  = useRef(50)

  // ── Initialization effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return

    originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
    selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
    seedRef.current = Math.floor(Math.random() * 0xFFFFFFFF)

    setGrainSize(5);     grainSizeRef.current  = 5
    setIntensity(35);    intensityRef.current  = 35
    setRoughness(50);    roughnessRef.current  = 50
    setIsBusy(false);    isBusyRef.current     = false
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
  const runPreview = useCallback(async (
    gs: number, int_: number, rough: number
  ): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(grainSizeRef.current, intensityRef.current, roughnessRef.current)
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const result   = await filmGrain(original.slice(), canvasWidth, canvasHeight,
                                       gs, int_, rough, seedRef.current)
      const composed = applySelectionComposite(result, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])

  const triggerPreview = useCallback((): void => {
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(grainSizeRef.current, intensityRef.current, roughnessRef.current)
    }, DEBOUNCE_MS)
  }, [runPreview])

  const handleGrainSizeChange = useCallback((value: number): void => {
    const clamped = clamp(value, 1, 100)
    setGrainSize(clamped);  grainSizeRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleIntensityChange = useCallback((value: number): void => {
    const clamped = clamp(value, 1, 200)
    setIntensity(clamped);  intensityRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleRoughnessChange = useCallback((value: number): void => {
    const clamped = clamp(value, 0, 100)
    setRoughness(clamped);  roughnessRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

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
      const result   = await filmGrain(original.slice(), canvasWidth, canvasHeight,
                                       grainSize, intensity, roughness, seedRef.current)
      const composed = applySelectionComposite(result, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Film Grain')
      onClose()
    } catch (err) {
      console.error('[FilmGrain] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight,
      grainSize, intensity, roughness, captureHistory, onClose])

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
    <ToolWindow title="Film Grain" icon={<FilmGrainIcon />} onClose={handleCancel} width={284}>
      <div className={styles.body}>
        <div className={styles.row}>
          <label className={styles.label}>Size</label>
          <input
            type="range"
            className={styles.slider}
            min={1} max={100} step={1}
            value={grainSize}
            onChange={e => handleGrainSizeChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={1} max={100} step={1}
            value={grainSize}
            onChange={e => handleGrainSizeChange(e.target.valueAsNumber)}
            onBlur={e  => handleGrainSizeChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit} aria-hidden="true" />
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Intensity</label>
          <input
            type="range"
            className={styles.slider}
            min={1} max={200} step={1}
            value={intensity}
            onChange={e => handleIntensityChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={1} max={200} step={1}
            value={intensity}
            onChange={e => handleIntensityChange(e.target.valueAsNumber)}
            onBlur={e  => handleIntensityChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>%</span>
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Roughness</label>
          <input
            type="range"
            className={styles.slider}
            min={0} max={100} step={1}
            value={roughness}
            onChange={e => handleRoughnessChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={0} max={100} step={1}
            value={roughness}
            onChange={e => handleRoughnessChange(e.target.valueAsNumber)}
            onBlur={e  => handleRoughnessChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit} aria-hidden="true" />
        </div>
        {isBusy && (
          <div className={styles.previewIndicator}>
            <span className={styles.spinner} />
            Previewing…
          </div>
        )}
        {hasSelection && !isBusy && (
          <div className={styles.selectionNote}>
            Film grain will apply inside the selection only.
          </div>
        )}
        {errorMessage != null && (
          <div className={styles.errorMessage}>{errorMessage}</div>
        )}
      </div>
      <div className={styles.footer}>
        <button className={styles.btnCancel} onClick={handleCancel}>Cancel</button>
        <button className={styles.btnApply} onClick={() => { void handleApply() }} disabled={isBusy}>Apply</button>
      </div>
    </ToolWindow>
  )
}
