import React, { useState, useEffect, useCallback, useRef } from 'react'
import { addNoise } from '@/webgpu/compute/filterCompute'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/ui/Canvas/canvasHandle'
import { ToolWindow } from '@/ux'
import styles from './AddNoiseDialog.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 25

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)))
}

// ─── Selection-aware compositing helper ───────────────────────────────────────

function applySelectionComposite(
  result:   Uint8Array,
  original: Uint8Array,
  mask:     Uint8Array | null,
): Uint8Array {
  if (mask === null) return result
  const out = original.slice()
  const pixelCount = mask.length
  for (let i = 0; i < pixelCount; i++) {
    if (mask[i] !== 0) {
      const p = i * 4
      out[p]     = result[p]
      out[p + 1] = result[p + 1]
      out[p + 2] = result[p + 2]
      out[p + 3] = result[p + 3]
    }
  }
  return out
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const NoiseIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
    <circle cx="1.8" cy="2.0" r="0.85"/>
    <circle cx="5.3" cy="1.4" r="0.70" opacity="0.7"/>
    <circle cx="9.1" cy="2.3" r="0.90"/>
    <circle cx="1.6" cy="5.1" r="0.65" opacity="0.6"/>
    <circle cx="4.3" cy="4.0" r="0.80"/>
    <circle cx="7.2" cy="4.8" r="0.70" opacity="0.8"/>
    <circle cx="10.3" cy="4.1" r="0.70" opacity="0.5"/>
    <circle cx="2.7" cy="8.0" r="0.90" opacity="0.9"/>
    <circle cx="6.2" cy="7.4" r="0.65" opacity="0.7"/>
    <circle cx="9.2" cy="7.8" r="0.85"/>
    <circle cx="4.2" cy="10.1" r="0.75" opacity="0.6"/>
    <circle cx="8.3" cy="10.5" r="0.70" opacity="0.8"/>
    <circle cx="11.0" cy="6.8" r="0.60" opacity="0.5"/>
    <circle cx="3.1" cy="6.4" r="0.55" opacity="0.5"/>
    <circle cx="6.9" cy="2.5" r="0.60" opacity="0.6"/>
    <circle cx="10.6" cy="10.8" r="0.65" opacity="0.65"/>
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AddNoiseDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AddNoiseDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: AddNoiseDialogProps): React.JSX.Element | null {
  const [amount,        setAmount]        = useState(25)
  const [distribution,  setDistribution]  = useState<'uniform' | 'gaussian'>('gaussian')
  const [monochromatic, setMonochromatic] = useState(false)
  const [isBusy,        setIsBusy]        = useState(false)
  const [hasSelection,  setHasSelection]  = useState(false)
  const [errorMessage,  setErrorMessage]  = useState<string | null>(null)

  const isBusyRef         = useRef(false)
  const originalPixelsRef = useRef<Uint8Array | null>(null)
  const selectionMaskRef  = useRef<Uint8Array | null>(null)
  const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seedRef           = useRef(0)

  const amountRef         = useRef(25)
  const distributionRef   = useRef<'uniform' | 'gaussian'>('gaussian')
  const monoRef           = useRef(false)

  // ── Initialization effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return

    originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
    selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
    seedRef.current = Math.floor(Math.random() * 0xFFFFFFFF)

    setAmount(25);               amountRef.current      = 25
    setDistribution('gaussian'); distributionRef.current = 'gaussian'
    setMonochromatic(false);     monoRef.current         = false
    setIsBusy(false);            isBusyRef.current       = false
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
    amt: number, dist: 'uniform' | 'gaussian', mono: boolean
  ): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(amountRef.current, distributionRef.current, monoRef.current)
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const distInt  = dist === 'gaussian' ? 1 : 0
      const monoInt  = mono ? 1 : 0
      const result   = await addNoise(original.slice(), canvasWidth, canvasHeight,
                                      amt, distInt, monoInt, seedRef.current)
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
      void runPreview(amountRef.current, distributionRef.current, monoRef.current)
    }, DEBOUNCE_MS)
  }, [runPreview])

  // ── Control handlers ─────────────────────────────────────────────
  const handleAmountChange = useCallback((value: number): void => {
    const clamped = clamp(value, 1, 400)
    setAmount(clamped); amountRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleDistributionChange = useCallback((value: 'uniform' | 'gaussian'): void => {
    setDistribution(value); distributionRef.current = value
    triggerPreview()
  }, [triggerPreview])

  const handleMonochromaticChange = useCallback((checked: boolean): void => {
    setMonochromatic(checked); monoRef.current = checked
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
      const distInt  = distribution === 'gaussian' ? 1 : 0
      const monoInt  = monochromatic ? 1 : 0
      const result   = await addNoise(original.slice(), canvasWidth, canvasHeight,
                                      amount, distInt, monoInt, seedRef.current)
      const composed = applySelectionComposite(result, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Add Noise')
      onClose()
    } catch (err) {
      console.error('[AddNoise] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight,
      amount, distribution, monochromatic, captureHistory, onClose])

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
    <ToolWindow title="Add Noise" icon={<NoiseIcon />} onClose={handleCancel} width={284}>
      <div className={styles.body}>
        {/* Amount row */}
        <div className={styles.row}>
          <span className={styles.label}>Amount</span>
          <input
            type="range"
            className={styles.slider}
            min={1} max={400} step={1}
            value={amount}
            onChange={e => handleAmountChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={1} max={400} step={1}
            value={amount}
            onChange={e => handleAmountChange(e.target.valueAsNumber)}
            onBlur={e  => handleAmountChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>%</span>
        </div>
        {/* Type (Distribution) row */}
        <div className={styles.row}>
          <span className={styles.label}>Type</span>
          <div className={styles.toggleGroup}>
            <button
              className={distribution === 'uniform' ? styles.toggleBtnActive : styles.toggleBtn}
              onClick={() => handleDistributionChange('uniform')}
            >
              Uniform
            </button>
            <button
              className={distribution === 'gaussian' ? styles.toggleBtnActive : styles.toggleBtn}
              onClick={() => handleDistributionChange('gaussian')}
            >
              Gaussian
            </button>
          </div>
        </div>
        {/* Monochromatic row */}
        <div className={styles.row}>
          <span className={styles.label}>Mono</span>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.customCheckbox}
              checked={monochromatic}
              onChange={e => handleMonochromaticChange(e.target.checked)}
            />
            <span className={styles.checkboxLabel}>Monochromatic</span>
          </label>
        </div>
        {isBusy && (
          <div className={styles.previewIndicator}>
            <span className={styles.spinner} />
            Previewing…
          </div>
        )}
        {hasSelection && !isBusy && (
          <div className={styles.selectionNote}>
            Noise will apply inside the selection only.
          </div>
        )}
        {errorMessage != null && (
          <div className={styles.errorMessage}>{errorMessage}</div>
        )}
      </div>
      <div className={styles.footer}>
        <button className={styles.btnCancel} onClick={handleCancel}>Cancel</button>
        <button className={styles.btnApply} disabled={isBusy} onClick={() => void handleApply()}>Apply</button>
      </div>
    </ToolWindow>
  )
}
