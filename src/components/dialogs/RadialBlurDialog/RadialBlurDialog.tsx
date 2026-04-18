import React, { useState, useEffect, useCallback, useRef } from 'react'
import { radialBlur } from '@/wasm'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/window/Canvas/canvasHandle'
import { ToolWindow } from '@/components'
import styles from './RadialBlurDialog.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_AMOUNT     = 1
const MAX_AMOUNT     = 100
const DEFAULT_AMOUNT = 10
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

const RadialBlurIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M 2.2 6 A 3.8 3.8 0 0 1 9.8 6" stroke="currentColor" strokeWidth="1.1"
      fill="none" strokeLinecap="round" />
    <path d="M 3.4 6 A 2.6 2.6 0 0 1 8.6 6" stroke="currentColor" strokeWidth="1.1"
      fill="none" opacity="0.6" strokeLinecap="round" />
    <path d="M 4.6 6 A 1.4 1.4 0 0 1 7.4 6" stroke="currentColor" strokeWidth="1.1"
      fill="none" opacity="0.25" strokeLinecap="round" />
    <circle cx="6" cy="6" r="1" fill="currentColor" />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RadialBlurDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RadialBlurDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
}: RadialBlurDialogProps): React.JSX.Element | null {
  const [mode,         setMode]         = useState<'spin' | 'zoom'>('spin')
  const [amount,       setAmount]       = useState(DEFAULT_AMOUNT)
  const [quality,      setQuality]      = useState<'draft' | 'good' | 'best'>('good')
  const [centerX,      setCenterX]      = useState(0.5)
  const [centerY,      setCenterY]      = useState(0.5)
  const [isBusy,       setIsBusy]       = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isBusyRef         = useRef(false)
  const originalPixelsRef = useRef<Uint8Array | null>(null)
  const selectionMaskRef  = useRef<Uint8Array | null>(null)
  const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gridRef           = useRef<HTMLDivElement>(null)

  // ── Initialization effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return

    originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
    selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
    setMode('spin')
    setAmount(DEFAULT_AMOUNT)
    setQuality('good')
    setCenterX(0.5)
    setCenterY(0.5)
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
    m: 'spin' | 'zoom', amt: number,
    q: 'draft' | 'good' | 'best',
    cx: number, cy: number
  ): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(m, amt, q, cx, cy)
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const modeInt    = m === 'spin' ? 0 : 1
      const qualityInt = q === 'draft' ? 0 : q === 'good' ? 1 : 2
      const blurred    = await radialBlur(
        original.slice(), canvasWidth, canvasHeight,
        modeInt, amt, cx, cy, qualityInt
      )
      const composed = applySelectionComposite(blurred, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])

  // ── Debounce helper ──────────────────────────────────────────────
  const schedulePreview = useCallback((
    m: 'spin' | 'zoom', amt: number,
    q: 'draft' | 'good' | 'best',
    cx: number, cy: number
  ): void => {
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(m, amt, q, cx, cy)
    }, DEBOUNCE_MS)
  }, [runPreview])

  // ── Control handlers ─────────────────────────────────────────────
  const handleAmountChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_AMOUNT, MAX_AMOUNT)
    setAmount(clamped)
    schedulePreview(mode, clamped, quality, centerX, centerY)
  }, [mode, quality, centerX, centerY, schedulePreview])

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
      const modeInt    = mode === 'spin' ? 0 : 1
      const qualityInt = quality === 'draft' ? 0 : quality === 'good' ? 1 : 2
      const blurred    = await radialBlur(
        original.slice(), canvasWidth, canvasHeight,
        modeInt, amount, centerX, centerY, qualityInt
      )
      const composed = applySelectionComposite(blurred, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Radial Blur')
      onClose()
    } catch (err) {
      console.error('[RadialBlur] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred while applying the blur.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, mode, amount, quality, centerX, centerY, captureHistory, onClose])

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

  // ── Center picker interaction ────────────────────────────────────
  const handleGridMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const el = gridRef.current
    if (!el) return

    const updateFromEvent = (clientX: number, clientY: number): void => {
      const rect = el.getBoundingClientRect()
      const nx = Math.max(0, Math.min(1, (clientX - rect.left)  / rect.width))
      const ny = Math.max(0, Math.min(1, (clientY - rect.top)   / rect.height))
      setCenterX(nx)
      setCenterY(ny)
      schedulePreview(mode, amount, quality, nx, ny)
    }

    updateFromEvent(e.clientX, e.clientY)

    const onMove = (me: MouseEvent): void => updateFromEvent(me.clientX, me.clientY)
    const onUp   = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
  }, [mode, amount, quality, schedulePreview])

  // ── Render ───────────────────────────────────────────────────────
  if (!isOpen) return null

  return (
    <ToolWindow title="Radial Blur" icon={<RadialBlurIcon />} onClose={handleCancel} width={284}>

      <div className={styles.body}>
        {/* Mode row */}
        <div className={styles.row}>
          <label className={styles.label}>Mode</label>
          <div className={styles.toggleGroup}>
            <button
              className={mode === 'spin' ? styles.toggleBtnActive : styles.toggleBtn}
              onClick={() => { setMode('spin'); schedulePreview('spin', amount, quality, centerX, centerY) }}
            >
              Spin
            </button>
            <button
              className={mode === 'zoom' ? styles.toggleBtnActive : styles.toggleBtn}
              onClick={() => { setMode('zoom'); schedulePreview('zoom', amount, quality, centerX, centerY) }}
            >
              Zoom
            </button>
          </div>
        </div>

        {/* Amount row */}
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

        {/* Quality row */}
        <div className={styles.row}>
          <label className={styles.label}>Quality</label>
          <div className={styles.toggleGroup}>
            {(['draft', 'good', 'best'] as const).map(q => (
              <button
                key={q}
                className={quality === q ? styles.toggleBtnActive : styles.toggleBtn}
                onClick={() => { setQuality(q); schedulePreview(mode, amount, q, centerX, centerY) }}
              >
                {q.charAt(0).toUpperCase() + q.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Center picker section */}
        <div className={styles.centerPickerSection}>
          <label className={styles.label}>Center</label>
          <div
            ref={gridRef}
            className={styles.centerGrid}
            onMouseDown={handleGridMouseDown}
          >
            <svg
              className={styles.dotGrid}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 120 90"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {Array.from({ length: 36 }, (_, i) => {
                const col = i % 6
                const row = Math.floor(i / 6)
                const cx  = (col + 0.5) * 20
                const cy  = (row + 0.5) * 15
                return (
                  <circle key={i} cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="1.1"
                    fill="rgba(255,255,255,0.16)" />
                )
              })}
            </svg>
            <div
              className={styles.crosshair}
              style={{ left: `${centerX * 100}%`, top: `${centerY * 100}%` }}
            >
              <div className={styles.crosshairH} />
              <div className={styles.crosshairV} />
            </div>
          </div>
          <span className={styles.coordinates}>
            {Math.round(centerX * 100)}%&nbsp;&times;&nbsp;{Math.round(centerY * 100)}%
          </span>
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
