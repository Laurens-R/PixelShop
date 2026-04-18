import React, { useState, useEffect, useCallback, useRef } from 'react'
import { lensBlur } from '@/wasm'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/window/Canvas/canvasHandle'
import { ToolWindow } from '@/components'
import styles from './LensBlurDialog.module.scss'

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

const LensBlurIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
    strokeWidth="1.1" aria-hidden="true">
    <polygon points="6,1.5 9.5,3.5 9.5,8.5 6,10.5 2.5,8.5 2.5,3.5" />
    <circle cx="6" cy="6" r="2.2" opacity="0.5" />
    <circle cx="6" cy="6" r="3.8" opacity="0.2" />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LensBlurDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LensBlurDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: LensBlurDialogProps): React.JSX.Element | null {
  const [radius,         setRadius]         = useState(10)
  const [bladeCount,     setBladeCount]     = useState(6)
  const [bladeCurvature, setBladeCurvature] = useState(0)
  const [rotation,       setRotation]       = useState(0)
  const [isBusy,         setIsBusy]         = useState(false)
  const [hasSelection,   setHasSelection]   = useState(false)
  const [errorMessage,   setErrorMessage]   = useState<string | null>(null)

  const isBusyRef          = useRef(false)
  const originalPixelsRef  = useRef<Uint8Array | null>(null)
  const selectionMaskRef   = useRef<Uint8Array | null>(null)
  const debounceTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const radiusRef          = useRef(10)
  const bladeCountRef      = useRef(6)
  const bladeCurvatureRef  = useRef(0)
  const rotationRef        = useRef(0)

  // ── Initialization effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return

    originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
    selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null

    setRadius(10);         radiusRef.current         = 10
    setBladeCount(6);      bladeCountRef.current     = 6
    setBladeCurvature(0);  bladeCurvatureRef.current = 0
    setRotation(0);        rotationRef.current       = 0
    setIsBusy(false);      isBusyRef.current         = false
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
    rad: number, bc: number, bCurv: number, rot: number
  ): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(
          radiusRef.current, bladeCountRef.current,
          bladeCurvatureRef.current, rotationRef.current
        )
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const result   = await lensBlur(original.slice(), canvasWidth, canvasHeight,
                                      rad, bc, bCurv, rot)
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
      void runPreview(
        radiusRef.current, bladeCountRef.current,
        bladeCurvatureRef.current, rotationRef.current
      )
    }, DEBOUNCE_MS)
  }, [runPreview])

  const handleRadiusChange = useCallback((value: number): void => {
    const clamped = clamp(value, 1, 100)
    setRadius(clamped);  radiusRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleBladeCountChange = useCallback((value: number): void => {
    const clamped = clamp(value, 3, 8)
    setBladeCount(clamped);  bladeCountRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleBladeCurvatureChange = useCallback((value: number): void => {
    const clamped = clamp(value, 0, 100)
    setBladeCurvature(clamped);  bladeCurvatureRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleRotationChange = useCallback((value: number): void => {
    const clamped = clamp(value, 0, 360)
    setRotation(clamped);  rotationRef.current = clamped
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
      const result   = await lensBlur(original.slice(), canvasWidth, canvasHeight,
                                      radius, bladeCount, bladeCurvature, rotation)
      const composed = applySelectionComposite(result, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Lens Blur')
      onClose()
    } catch (err) {
      console.error('[LensBlur] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight,
      radius, bladeCount, bladeCurvature, rotation, captureHistory, onClose])

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
    <ToolWindow title="Lens Blur" icon={<LensBlurIcon />} onClose={handleCancel} width={284}>
      <div className={styles.body}>
        <div className={styles.row}>
          <label className={styles.label}>Radius</label>
          <input
            type="range"
            className={styles.slider}
            min={1} max={100} step={1}
            value={radius}
            onChange={e => handleRadiusChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={1} max={100} step={1}
            value={radius}
            onChange={e => handleRadiusChange(e.target.valueAsNumber)}
            onBlur={e  => handleRadiusChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>px</span>
        </div>
        <div className={`${styles.row} ${bladeCurvature === 100 ? styles.rowDisabled : ''}`}>
          <label className={styles.label}>Blades</label>
          <input
            type="range"
            className={styles.slider}
            min={3} max={8} step={1}
            value={bladeCount}
            onChange={e => handleBladeCountChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={3} max={8} step={1}
            value={bladeCount}
            onChange={e => handleBladeCountChange(e.target.valueAsNumber)}
            onBlur={e  => handleBladeCountChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit} aria-hidden="true" />
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Curve</label>
          <input
            type="range"
            className={styles.slider}
            min={0} max={100} step={1}
            value={bladeCurvature}
            onChange={e => handleBladeCurvatureChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={0} max={100} step={1}
            value={bladeCurvature}
            onChange={e => handleBladeCurvatureChange(e.target.valueAsNumber)}
            onBlur={e  => handleBladeCurvatureChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit} aria-hidden="true" />
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Rotate</label>
          <input
            type="range"
            className={styles.slider}
            min={0} max={360} step={1}
            value={rotation}
            onChange={e => handleRotationChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={0} max={360} step={1}
            value={rotation}
            onChange={e => handleRotationChange(e.target.valueAsNumber)}
            onBlur={e  => handleRotationChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>°</span>
        </div>
        {isBusy && (
          <div className={styles.previewIndicator}>
            <span className={styles.spinner} />
            Previewing…
          </div>
        )}
        {hasSelection && !isBusy && (
          <div className={styles.selectionNote}>
            Blur will apply inside the selection only.
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
