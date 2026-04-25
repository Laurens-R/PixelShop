import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motionBlur } from '@/webgpu/compute/filterCompute'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/ui/Canvas/canvasHandle'
import { ToolWindow } from '@/ux'
import styles from './MotionBlurDialog.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_ANGLE      = 0
const MAX_ANGLE      = 360
const DEFAULT_ANGLE  = 0
const MIN_DISTANCE   = 1
const MAX_DISTANCE   = 999
const DEFAULT_DISTANCE = 10
const DEBOUNCE_MS    = 25

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)))
}

// ─── Selection-aware compositing helper ───────────────────────────────────────

function applySelectionComposite(
  blurred:  Uint8Array,
  original: Uint8Array,
  mask:     Uint8Array | null,
): Uint8Array {
  if (mask === null) return blurred

  const out = original.slice()
  const pixelCount = mask.length
  for (let i = 0; i < pixelCount; i++) {
    if (mask[i] !== 0) {
      const p = i * 4
      out[p]     = blurred[p]
      out[p + 1] = blurred[p + 1]
      out[p + 2] = blurred[p + 2]
      out[p + 3] = blurred[p + 3]
    }
  }
  return out
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const MotionBlurIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    <line x1="1" y1="4" x2="8"  y2="4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
    <line x1="1" y1="8" x2="8"  y2="8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
    <line x1="1" y1="2.5" x2="5" y2="2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.2" />
    <line x1="1" y1="9.5" x2="5" y2="9.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.2" />
  </svg>
)

// ─── Angle Indicator ──────────────────────────────────────────────────────────

const AngleIndicator = ({ angle }: { angle: number }): React.JSX.Element => {
  const rad = (angle * Math.PI) / 180
  const cx = 20, cy = 20, r = 16
  const tx = cx + Math.cos(rad) * r
  const ty = cy + Math.sin(rad) * r
  const headLen = 5
  const headAngle = 0.45
  const ax1 = tx - Math.cos(rad - headAngle) * headLen
  const ay1 = ty - Math.sin(rad - headAngle) * headLen
  const ax2 = tx - Math.cos(rad + headAngle) * headLen
  const ay2 = ty - Math.sin(rad + headAngle) * headLen
  // 8 tick marks
  const ticks = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4
    const inner = i % 2 === 0 ? r - 3 : r - 2
    return {
      x1: cx + Math.cos(a) * inner, y1: cy + Math.sin(a) * inner,
      x2: cx + Math.cos(a) * r,     y2: cy + Math.sin(a) * r,
      opacity: i % 2 === 0 ? 0.7 : 0.4,
    }
  })
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"
      style={{ pointerEvents: 'none', flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#555" strokeWidth="1" />
      {ticks.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke="#555" strokeWidth="1" opacity={t.opacity} />
      ))}
      <line x1={cx} y1={cy} x2={tx} y2={ty} stroke="#0699fb" strokeWidth="1.5" strokeLinecap="round" />
      <polygon
        points={`${tx},${ty} ${ax1},${ay1} ${ax2},${ay2}`}
        fill="#0699fb"
      />
      <circle cx={cx} cy={cy} r="2" fill="#0699fb" />
    </svg>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MotionBlurDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MotionBlurDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: MotionBlurDialogProps): React.JSX.Element | null {
  const [angle,        setAngle]        = useState(DEFAULT_ANGLE)
  const [distance,     setDistance]     = useState(DEFAULT_DISTANCE)
  const [isBusy,       setIsBusy]       = useState(false)
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
    setAngle(DEFAULT_ANGLE)
    setDistance(DEFAULT_DISTANCE)
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
    ang: number, dist: number
  ): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(ang, dist)
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const blurred  = await motionBlur(original.slice(), canvasWidth, canvasHeight, ang, dist)
      const composed = applySelectionComposite(blurred, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])

  // ── Debounce helper ──────────────────────────────────────────────
  const schedulePreview = useCallback((ang: number, dist: number): void => {
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(ang, dist)
    }, DEBOUNCE_MS)
  }, [runPreview])

  // ── Control handlers ─────────────────────────────────────────────
  const handleAngleChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_ANGLE, MAX_ANGLE)
    setAngle(clamped)
    schedulePreview(clamped, distance)
  }, [distance, schedulePreview])

  const handleDistanceChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_DISTANCE, MAX_DISTANCE)
    setDistance(clamped)
    schedulePreview(angle, clamped)
  }, [angle, schedulePreview])

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
      const blurred  = await motionBlur(original.slice(), canvasWidth, canvasHeight, angle, distance)
      const composed = applySelectionComposite(blurred, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Motion Blur')
      onClose()
    } catch (err) {
      console.error('[MotionBlur] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred while applying the blur.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, angle, distance, captureHistory, onClose])

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
    <ToolWindow title="Motion Blur" icon={<MotionBlurIcon />} onClose={handleCancel} width={284}>

      <div className={styles.body}>
        {/* Angle row */}
        <div className={styles.row}>
          <label className={styles.label}>Angle</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_ANGLE} max={MAX_ANGLE} step={1}
            value={angle}
            onChange={e => handleAngleChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_ANGLE} max={MAX_ANGLE} step={1}
            value={angle}
            onChange={e => handleAngleChange(e.target.valueAsNumber)}
            onBlur={e  => handleAngleChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>°</span>
        </div>

        {/* Angle indicator row */}
        <div className={styles.angleIndicatorRow}>
          <AngleIndicator angle={angle} />
          <span className={styles.angleReadout}>{angle}°</span>
        </div>

        {/* Distance row */}
        <div className={styles.row}>
          <label className={styles.label}>Distance</label>
          <input
            type="range"
            className={styles.slider}
            min={MIN_DISTANCE} max={MAX_DISTANCE} step={1}
            value={distance}
            onChange={e => handleDistanceChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={MIN_DISTANCE} max={MAX_DISTANCE} step={1}
            value={distance}
            onChange={e => handleDistanceChange(e.target.valueAsNumber)}
            onBlur={e  => handleDistanceChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>px</span>
        </div>

        {isBusy && (
          <div className={styles.previewIndicator}>
            <span className={styles.spinner} />
            Previewing…
          </div>
        )}
        {hasSelection && (
          <div className={styles.selectionNote}>
            Blur will be applied inside the selection only.
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
