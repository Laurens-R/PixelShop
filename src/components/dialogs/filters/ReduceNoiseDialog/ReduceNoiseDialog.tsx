import React, { useState, useEffect, useCallback, useRef } from 'react'
import { reduceNoise } from '@/webgpu/filterCompute'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/ui/Canvas/canvasHandle'
import { ToolWindow } from '@/components'
import styles from './ReduceNoiseDialog.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_STRENGTH     = 0
const MAX_STRENGTH     = 10
const DEFAULT_STRENGTH = 6

const MIN_PRESERVE_DETAILS     = 0
const MAX_PRESERVE_DETAILS     = 100
const DEFAULT_PRESERVE_DETAILS = 60

const MIN_REDUCE_COLOR_NOISE     = 0
const MAX_REDUCE_COLOR_NOISE     = 100
const DEFAULT_REDUCE_COLOR_NOISE = 25

const MIN_SHARPEN_DETAILS     = 0
const MAX_SHARPEN_DETAILS     = 100
const DEFAULT_SHARPEN_DETAILS = 0

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

const ReduceNoiseIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <polyline
      points="0.8,6 1.4,4.0 2.0,7.5 2.6,4.8 3.2,7.2 3.8,5.0 4.4,6.8 5.0,5.5 5.4,6"
      stroke="currentColor" strokeWidth="1.0"
      strokeLinecap="round" strokeLinejoin="round"
      opacity="0.6"
    />
    <line x1="5.4" y1="6" x2="6.4" y2="6"
      stroke="currentColor" strokeWidth="1.0"
      strokeLinecap="round" opacity="0.35"
    />
    <line x1="6.4" y1="6" x2="11.2" y2="6"
      stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ReduceNoiseDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReduceNoiseDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: ReduceNoiseDialogProps): React.JSX.Element | null {
  const [strength,         setStrength]         = useState(DEFAULT_STRENGTH)
  const [preserveDetails,  setPreserveDetails]  = useState(DEFAULT_PRESERVE_DETAILS)
  const [reduceColorNoise, setReduceColorNoise] = useState(DEFAULT_REDUCE_COLOR_NOISE)
  const [sharpenDetails,   setSharpenDetails]   = useState(DEFAULT_SHARPEN_DETAILS)
  const [isBusy,           setIsBusy]           = useState(false)
  const [hasSelection,     setHasSelection]     = useState(false)
  const [errorMessage,     setErrorMessage]     = useState<string | null>(null)

  const isBusyRef         = useRef(false)
  const originalPixelsRef = useRef<Uint8Array | null>(null)
  const selectionMaskRef  = useRef<Uint8Array | null>(null)
  const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const strengthRef         = useRef(DEFAULT_STRENGTH)
  const preserveDetailsRef  = useRef(DEFAULT_PRESERVE_DETAILS)
  const reduceColorNoiseRef = useRef(DEFAULT_REDUCE_COLOR_NOISE)
  const sharpenDetailsRef   = useRef(DEFAULT_SHARPEN_DETAILS)

  // ── Initialization effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return

    originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
    selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
    setStrength(DEFAULT_STRENGTH)
    setPreserveDetails(DEFAULT_PRESERVE_DETAILS)
    setReduceColorNoise(DEFAULT_REDUCE_COLOR_NOISE)
    setSharpenDetails(DEFAULT_SHARPEN_DETAILS)
    strengthRef.current         = DEFAULT_STRENGTH
    preserveDetailsRef.current  = DEFAULT_PRESERVE_DETAILS
    reduceColorNoiseRef.current = DEFAULT_REDUCE_COLOR_NOISE
    sharpenDetailsRef.current   = DEFAULT_SHARPEN_DETAILS
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
  const runPreview = useCallback(async (
    str: number, pd: number, rcn: number, sd: number,
  ): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(
          strengthRef.current,
          preserveDetailsRef.current,
          reduceColorNoiseRef.current,
          sharpenDetailsRef.current,
        )
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const filtered = await reduceNoise(original.slice(), canvasWidth, canvasHeight, str, pd, rcn, sd)
      const composed = applySelectionComposite(filtered, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])

  const schedulePreview = useCallback((): void => {
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(
        strengthRef.current,
        preserveDetailsRef.current,
        reduceColorNoiseRef.current,
        sharpenDetailsRef.current,
      )
    }, DEBOUNCE_MS)
  }, [runPreview])

  const handleStrengthChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_STRENGTH, MAX_STRENGTH)
    strengthRef.current = clamped
    setStrength(clamped)
    schedulePreview()
  }, [schedulePreview])

  const handlePreserveDetailsChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_PRESERVE_DETAILS, MAX_PRESERVE_DETAILS)
    preserveDetailsRef.current = clamped
    setPreserveDetails(clamped)
    schedulePreview()
  }, [schedulePreview])

  const handleReduceColorNoiseChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_REDUCE_COLOR_NOISE, MAX_REDUCE_COLOR_NOISE)
    reduceColorNoiseRef.current = clamped
    setReduceColorNoise(clamped)
    schedulePreview()
  }, [schedulePreview])

  const handleSharpenDetailsChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_SHARPEN_DETAILS, MAX_SHARPEN_DETAILS)
    sharpenDetailsRef.current = clamped
    setSharpenDetails(clamped)
    schedulePreview()
  }, [schedulePreview])

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
      const filtered = await reduceNoise(
        original.slice(), canvasWidth, canvasHeight,
        strengthRef.current, preserveDetailsRef.current,
        reduceColorNoiseRef.current, sharpenDetailsRef.current,
      )
      const composed = applySelectionComposite(filtered, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Reduce Noise')
      onClose()
    } catch (err) {
      console.error('[ReduceNoise] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred while applying the filter.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, captureHistory, onClose])

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
    <ToolWindow title="Reduce Noise" icon={<ReduceNoiseIcon />} onClose={handleCancel} width={ 330 }>
      <div className={styles.body}>

        <div className={styles.row}>
          <label className={styles.label}>Strength</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_STRENGTH} max={MAX_STRENGTH} step={1}
            value={strength}
            onChange={e => handleStrengthChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_STRENGTH} max={MAX_STRENGTH} step={1}
            value={strength}
            onChange={e => handleStrengthChange(e.target.valueAsNumber)}
            onBlur={e  => handleStrengthChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit} />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>Preserve Details</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_PRESERVE_DETAILS} max={MAX_PRESERVE_DETAILS} step={1}
            value={preserveDetails}
            onChange={e => handlePreserveDetailsChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_PRESERVE_DETAILS} max={MAX_PRESERVE_DETAILS} step={1}
            value={preserveDetails}
            onChange={e => handlePreserveDetailsChange(e.target.valueAsNumber)}
            onBlur={e  => handlePreserveDetailsChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>%</span>
        </div>

        <div className={styles.row}>
          <label className={styles.label}>Reduce Color Noise</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_REDUCE_COLOR_NOISE} max={MAX_REDUCE_COLOR_NOISE} step={1}
            value={reduceColorNoise}
            onChange={e => handleReduceColorNoiseChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_REDUCE_COLOR_NOISE} max={MAX_REDUCE_COLOR_NOISE} step={1}
            value={reduceColorNoise}
            onChange={e => handleReduceColorNoiseChange(e.target.valueAsNumber)}
            onBlur={e  => handleReduceColorNoiseChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>%</span>
        </div>

        <div className={styles.separator} aria-hidden="true" />

        <div className={styles.row}>
          <label className={styles.label}>Sharpen Details</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_SHARPEN_DETAILS} max={MAX_SHARPEN_DETAILS} step={1}
            value={sharpenDetails}
            onChange={e => handleSharpenDetailsChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_SHARPEN_DETAILS} max={MAX_SHARPEN_DETAILS} step={1}
            value={sharpenDetails}
            onChange={e => handleSharpenDetailsChange(e.target.valueAsNumber)}
            onBlur={e  => handleSharpenDetailsChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>%</span>
        </div>

        {isBusy && (
          <div className={styles.previewIndicator}>
            <span className={styles.spinner} />
            Previewing…
            <span className={styles.previewParams}>Str {strength} · Dtls {preserveDetails}%</span>
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
