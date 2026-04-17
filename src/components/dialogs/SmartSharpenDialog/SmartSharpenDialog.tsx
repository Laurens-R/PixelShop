import React, { useState, useEffect, useCallback, useRef } from 'react'
import { smartSharpen } from '@/wasm'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/window/Canvas/canvasHandle'
import styles from './SmartSharpenDialog.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_AMOUNT     = 1
const MAX_AMOUNT     = 500
const DEFAULT_AMOUNT = 100
const MIN_RADIUS     = 1
const MAX_RADIUS     = 64
const DEFAULT_RADIUS = 2
const MIN_NOISE      = 0
const MAX_NOISE      = 100
const DEFAULT_NOISE  = 10
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

const CloseIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" width="10" height="10" aria-hidden="true">
    <line x1="1" y1="1" x2="11" y2="11" />
    <line x1="11" y1="1" x2="1" y2="11" />
  </svg>
)

const SmartSharpenIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M6 1.5 L9 6 L6 10.5 L3 6 Z"
      stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
    <line x1="6" y1="0" x2="6" y2="1.2"
      stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    <line x1="12" y1="6" x2="10.8" y2="6"
      stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    <line x1="6" y1="12" x2="6" y2="10.8"
      stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    <line x1="0" y1="6" x2="1.2" y2="6"
      stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SmartSharpenDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SmartSharpenDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: SmartSharpenDialogProps): React.JSX.Element | null {
  const [amount,       setAmount]       = useState(DEFAULT_AMOUNT)
  const [radius,       setRadius]       = useState(DEFAULT_RADIUS)
  const [reduceNoise,  setReduceNoise]  = useState(DEFAULT_NOISE)
  const [remove,       setRemove]       = useState<'gaussian' | 'lens'>('gaussian')
  const [isBusy,       setIsBusy]       = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isBusyRef         = useRef(false)
  const originalPixelsRef = useRef<Uint8Array | null>(null)
  const selectionMaskRef  = useRef<Uint8Array | null>(null)
  const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // State refs for use inside runPreview without stale-closure issues
  const amountRef      = useRef(DEFAULT_AMOUNT)
  const radiusRef      = useRef(DEFAULT_RADIUS)
  const reduceNoiseRef = useRef(DEFAULT_NOISE)
  const removeRef      = useRef<'gaussian' | 'lens'>('gaussian')

  // ── Initialization effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return

    originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
    selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
    setAmount(DEFAULT_AMOUNT)
    setRadius(DEFAULT_RADIUS)
    setReduceNoise(DEFAULT_NOISE)
    setRemove('gaussian')
    amountRef.current      = DEFAULT_AMOUNT
    radiusRef.current      = DEFAULT_RADIUS
    reduceNoiseRef.current = DEFAULT_NOISE
    removeRef.current      = 'gaussian'
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
    amt: number, rad: number, noise: number, rem: 'gaussian' | 'lens'
  ): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(amountRef.current, radiusRef.current, reduceNoiseRef.current, removeRef.current)
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const removeInt = rem === 'gaussian' ? 0 : 1
      const result    = await smartSharpen(original.slice(), canvasWidth, canvasHeight, amt, rad, noise, removeInt)
      const composed  = applySelectionComposite(result, original, selectionMaskRef.current)
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
      void runPreview(amountRef.current, radiusRef.current, reduceNoiseRef.current, removeRef.current)
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

  const handleNoiseChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_NOISE, MAX_NOISE)
    setReduceNoise(clamped)
    reduceNoiseRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleRemoveChange = useCallback((value: 'gaussian' | 'lens'): void => {
    setRemove(value)
    removeRef.current = value
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
      const removeInt = remove === 'gaussian' ? 0 : 1
      const result    = await smartSharpen(original.slice(), canvasWidth, canvasHeight, amount, radius, reduceNoise, removeInt)
      const composed  = applySelectionComposite(result, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Smart Sharpen')
      onClose()
    } catch (err) {
      console.error('[SmartSharpen] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred while applying Smart Sharpen.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, amount, radius, reduceNoise, remove, captureHistory, onClose])

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
    <div className={styles.panel} role="dialog" aria-label="Smart Sharpen">
      <div className={styles.header}>
        <span className={styles.headerIcon}>
          <SmartSharpenIcon />
        </span>
        <span className={styles.title}>Smart Sharpen</span>
        <button className={styles.closeBtn} onClick={handleCancel} aria-label="Close" title="Close">
          <CloseIcon />
        </button>
      </div>
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
          <label className={styles.label}>Noise</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_NOISE} max={MAX_NOISE} step={1}
            value={reduceNoise}
            onChange={e => handleNoiseChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_NOISE} max={MAX_NOISE} step={1}
            value={reduceNoise}
            onChange={e => handleNoiseChange(e.target.valueAsNumber)}
            onBlur={e  => handleNoiseChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>%</span>
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Remove</label>
          <select
            className={styles.select}
            value={remove}
            onChange={e => handleRemoveChange(e.target.value as 'gaussian' | 'lens')}
          >
            <option value="gaussian">Gaussian Blur</option>
            <option value="lens">Lens Blur</option>
          </select>
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
    </div>
  )
}
