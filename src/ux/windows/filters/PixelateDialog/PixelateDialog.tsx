import React, { useState, useEffect, useCallback, useRef } from 'react'
import { pixelate } from '@/webgpu/compute/filterCompute'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/ui/Canvas/canvasHandle'
import { ToolWindow } from '@/ux'
import styles from './PixelateDialog.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_BLOCK_SIZE     = 2
const DEFAULT_BLOCK_SIZE = 10
const DEBOUNCE_MS        = 25

// ─── Module-level helpers ─────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  while (b !== 0) { [a, b] = [b, a % b] }
  return a
}

function computeCommonDivisors(w: number, h: number): number[] {
  const g = gcd(w, h)
  const divisors: number[] = []
  for (let i = 2; i <= g; i++) {
    if (g % i === 0) divisors.push(i)
  }
  return divisors
}

function nearestDivisor(sorted: number[], target: number): number {
  let best = sorted[0]
  let bestDist = Math.abs(sorted[0] - target)
  for (const d of sorted) {
    const dist = Math.abs(d - target)
    if (dist < bestDist) { best = d; bestDist = dist }
  }
  return best
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

// ─── Icon ─────────────────────────────────────────────────────────────────────

const PixelateIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
    <rect x="1" y="1" width="4" height="4" opacity="0.9" />
    <rect x="7" y="1" width="4" height="4" opacity="0.6" />
    <rect x="1" y="7" width="4" height="4" opacity="0.6" />
    <rect x="7" y="7" width="4" height="4" opacity="0.9" />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PixelateDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PixelateDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: PixelateDialogProps): React.JSX.Element | null {
  const [pixelSize, setPixelSize]   = useState(DEFAULT_BLOCK_SIZE)
  const [snapToGrid, setSnapToGrid] = useState(false)
  const [isBusy, setIsBusy]         = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [snapDivisors, setSnapDivisors] = useState<number[]>([])

  const isBusyRef         = useRef(false)
  const originalPixelsRef = useRef<Uint8Array | null>(null)
  const selectionMaskRef  = useRef<Uint8Array | null>(null)
  const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxBlockSizeRef   = useRef(1)
  const snapDivisorsRef   = useRef<number[]>([])

  // ── Derived ──────────────────────────────────────────────────────
  const maxBlockSize = Math.floor(Math.min(canvasWidth, canvasHeight) / 2)

  // ── Initialization effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return

    const computedMax = Math.floor(Math.min(canvasWidth, canvasHeight) / 2)
    const divisors    = computeCommonDivisors(canvasWidth, canvasHeight)
    maxBlockSizeRef.current   = computedMax
    snapDivisorsRef.current   = divisors
    originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
    selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
    const initial = Math.min(DEFAULT_BLOCK_SIZE, computedMax)
    setPixelSize(initial)
    setSnapToGrid(false)
    setSnapDivisors(divisors)
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
  }, [isOpen, canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])

  // ── Preview ──────────────────────────────────────────────────────
  const runPreview = useCallback(async (size: number): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(size)
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const result   = await pixelate(original.slice(), canvasWidth, canvasHeight, size)
      const composed = applySelectionComposite(result, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])

  // ── Pixel size change ─────────────────────────────────────────────
  const handlePixelSizeChange = useCallback((raw: number): void => {
    let v = Math.max(MIN_BLOCK_SIZE, Math.min(maxBlockSizeRef.current, Math.round(raw)))
    if (snapToGrid && snapDivisorsRef.current.length > 0) {
      v = nearestDivisor(snapDivisorsRef.current, v)
    }
    setPixelSize(v)
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(v)
    }, DEBOUNCE_MS)
  }, [snapToGrid, runPreview])

  // ── Snap change ───────────────────────────────────────────────────
  const handleSnapChange = useCallback((checked: boolean): void => {
    setSnapToGrid(checked)
    if (checked && snapDivisorsRef.current.length > 0) {
      setPixelSize(prev => {
        const snapped = nearestDivisor(snapDivisorsRef.current, prev)
        if (snapped !== prev) {
          if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null
            void runPreview(snapped)
          }, DEBOUNCE_MS)
        }
        return snapped
      })
    }
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
      const result   = await pixelate(original.slice(), canvasWidth, canvasHeight, pixelSize)
      const composed = applySelectionComposite(result, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Pixelate')
      onClose()
    } catch (err) {
      console.error('[PixelateDialog] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred while applying the filter.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, pixelSize, captureHistory, onClose])

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

  const snapDisabled = snapDivisors.length === 0

  return (
    <ToolWindow title="Pixelate" icon={<PixelateIcon />} onClose={handleCancel} width={300}>
      <div className={styles.body}>
          {/* Pixel Size */}
          <div className={styles.ctrlBlock}>
            <div className={styles.ctrlHeaderRow}>
              <label className={styles.ctrlLabel}>Pixel Size</label>
            </div>
            <div className={styles.sliderRow}>
              <input
                type="range"
                className={styles.slider}
                min={MIN_BLOCK_SIZE}
                max={maxBlockSize}
                step={1}
                value={pixelSize}
                onChange={e => handlePixelSizeChange(e.target.valueAsNumber)}
              />
              <input
                type="number"
                className={styles.numberInput}
                min={MIN_BLOCK_SIZE}
                max={maxBlockSize}
                step={1}
                value={pixelSize}
                onChange={e => handlePixelSizeChange(e.target.valueAsNumber)}
                onBlur={e  => handlePixelSizeChange(e.target.valueAsNumber)}
              />
              <span className={styles.unit}>px</span>
            </div>
            <div className={styles.sliderRangeHint}>
              <span className={styles.rangeHintText}>{MIN_BLOCK_SIZE}</span>
              <span className={styles.rangeHintText}>{maxBlockSize}</span>
            </div>
          </div>

          {/* Snap to Grid */}
          <div className={styles.snapRow}>
            <input
              type="checkbox"
              id="pixelate-snap-to-grid"
              className={styles.snapCheckbox}
              checked={snapToGrid}
              disabled={snapDisabled}
              onChange={e => handleSnapChange(e.target.checked)}
            />
            <label
              htmlFor="pixelate-snap-to-grid"
              className={snapDisabled ? styles.snapLabelDisabled : styles.snapLabel}
            >
              Snap to Grid
            </label>
          </div>

          {snapDisabled && (
            <div className={styles.snapDisabledNote}>
              <span className={styles.snapDisabledText}>
                No common divisors ≥ 2 for this image size.
              </span>
            </div>
          )}

          {/* Status messages */}
          {isBusy && (
            <div className={styles.previewIndicator}>
              <span className={styles.spinner} />
              Previewing…
            </div>
          )}
          {hasSelection && (
            <div className={styles.selectionNote}>
              Filter will apply inside the selection only.
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
