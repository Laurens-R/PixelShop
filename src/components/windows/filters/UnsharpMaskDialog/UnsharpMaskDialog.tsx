import React, { useState, useEffect, useCallback, useRef } from 'react'
import { unsharpMask } from '@/webgpu/compute/filterCompute'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/ui/Canvas/canvasHandle'
import { ToolWindow } from '@/components'
import styles from './UnsharpMaskDialog.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_AMOUNT     = 1
const MAX_AMOUNT     = 500
const DEFAULT_AMOUNT = 100
const MIN_RADIUS     = 1
const MAX_RADIUS     = 64
const DEFAULT_RADIUS = 2
const MIN_THRESHOLD  = 0
const MAX_THRESHOLD  = 255
const DEFAULT_THRESHOLD = 0
const DEBOUNCE_MS    = 25

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

const UnsharpMaskIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="6" cy="6" r="4" strokeDasharray="2 1.5" />
    <circle cx="6" cy="6" r="2" />
    <circle cx="6" cy="6" r="0.8" fill="currentColor" stroke="none" />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface UnsharpMaskDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UnsharpMaskDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: UnsharpMaskDialogProps): React.JSX.Element | null {
  const [amount,       setAmount]       = useState(DEFAULT_AMOUNT)
  const [radius,       setRadius]       = useState(DEFAULT_RADIUS)
  const [threshold,    setThreshold]    = useState(DEFAULT_THRESHOLD)
  const [isBusy,       setIsBusy]       = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isBusyRef         = useRef(false)
  const originalPixelsRef = useRef<Uint8Array | null>(null)
  const selectionMaskRef  = useRef<Uint8Array | null>(null)
  const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // State refs for use inside runPreview without stale-closure issues
  const amountRef    = useRef(DEFAULT_AMOUNT)
  const radiusRef    = useRef(DEFAULT_RADIUS)
  const thresholdRef = useRef(DEFAULT_THRESHOLD)

  // ── Initialization effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return

    originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
    selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
    setAmount(DEFAULT_AMOUNT)
    setRadius(DEFAULT_RADIUS)
    setThreshold(DEFAULT_THRESHOLD)
    amountRef.current    = DEFAULT_AMOUNT
    radiusRef.current    = DEFAULT_RADIUS
    thresholdRef.current = DEFAULT_THRESHOLD
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
    amt: number, rad: number, thr: number
  ): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(amountRef.current, radiusRef.current, thresholdRef.current)
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const result   = await unsharpMask(original.slice(), canvasWidth, canvasHeight, amt, rad, thr)
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
      void runPreview(amountRef.current, radiusRef.current, thresholdRef.current)
    }, DEBOUNCE_MS)
  }, [runPreview])

  const handleAmountChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_AMOUNT, MAX_AMOUNT)
    setAmount(clamped)
    amountRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleRadiusChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_RADIUS, MAX_RADIUS)
    setRadius(clamped)
    radiusRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleThresholdChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_THRESHOLD, MAX_THRESHOLD)
    setThreshold(clamped)
    thresholdRef.current = clamped
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
      const result   = await unsharpMask(original.slice(), canvasWidth, canvasHeight, amount, radius, threshold)
      const composed = applySelectionComposite(result, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Unsharp Mask')
      onClose()
    } catch (err) {
      console.error('[UnsharpMask] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred while applying Unsharp Mask.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, amount, radius, threshold, captureHistory, onClose])

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
    <ToolWindow title="Unsharp Mask" icon={<UnsharpMaskIcon />} onClose={handleCancel} width={284}>
      <div className={styles.body}>
        <div className={styles.row}>
          <label className={styles.label}>Amount</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_AMOUNT} max={MAX_AMOUNT} step={1}
            value={amount}
            onChange={e => handleAmountChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_AMOUNT} max={MAX_AMOUNT} step={1}
            value={amount}
            onChange={e => handleAmountChange(e.target.valueAsNumber)}
            onBlur={e  => handleAmountChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>%</span>
        </div>
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
        <div className={styles.row}>
          <label className={styles.label}>Threshold</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_THRESHOLD} max={MAX_THRESHOLD} step={1}
            value={threshold}
            onChange={e => handleThresholdChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_THRESHOLD} max={MAX_THRESHOLD} step={1}
            value={threshold}
            onChange={e => handleThresholdChange(e.target.valueAsNumber)}
            onBlur={e  => handleThresholdChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>lv</span>
        </div>
        {isBusy && (
          <div className={styles.previewIndicator}>
            <span className={styles.spinner} />
            Previewing…
          </div>
        )}
        {hasSelection && (
          <div className={styles.selectionNote}>
            Sharpening will apply inside the selection only.
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
