import React, { useState, useEffect, useCallback, useRef } from 'react'
import { clouds } from '@/webgpu/compute/filterCompute'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/ui/Canvas/canvasHandle'
import { ToolWindow } from '@/ux'
import styles from './CloudsDialog.module.scss'

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

const CloudsIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
    strokeWidth="1.1" strokeLinecap="round" aria-hidden="true">
    <path d="M 2.5 8.5 Q 1 8.5 1 7 Q 1 5 3 5 Q 3 3 5.5 3 Q 8 3 8 5.5 Q 10 5.5 10 7.5 Q 10 8.5 8.5 8.5 Z" />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CloudsDialogProps {
  isOpen:           boolean
  onClose:          () => void
  canvasHandleRef:  { readonly current: CanvasHandle | null }
  activeLayerId:    string | null
  captureHistory:   (label: string) => void
  canvasWidth:      number
  canvasHeight:     number
  foregroundColor:  [number, number, number]
  backgroundColor:  [number, number, number]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CloudsDialog({
  isOpen,
  onClose,
  canvasHandleRef,
  activeLayerId,
  captureHistory,
  canvasWidth,
  canvasHeight,
  foregroundColor,
  backgroundColor,
}: CloudsDialogProps): React.JSX.Element | null {
  const [scale,        setScale]        = useState(50)
  const [opacity,      setOpacity]      = useState(100)
  const [colorMode,    setColorMode]    = useState<'grayscale' | 'color'>('grayscale')
  const [seed,         setSeed]         = useState(0)
  const [isBusy,       setIsBusy]       = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isBusyRef         = useRef(false)
  const originalPixelsRef = useRef<Uint8Array | null>(null)
  const selectionMaskRef  = useRef<Uint8Array | null>(null)
  const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scaleRef      = useRef(50)
  const opacityRef    = useRef(100)
  const colorModeRef  = useRef<'grayscale' | 'color'>('grayscale')
  const seedRef       = useRef(0)

  // Color refs updated every render so closures always read the latest prop values.
  const fgColorRef = useRef(foregroundColor)
  fgColorRef.current = foregroundColor
  const bgColorRef = useRef(backgroundColor)
  bgColorRef.current = backgroundColor

  // ── Initialization effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return

    originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
    selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null

    setScale(50);              scaleRef.current     = 50
    setOpacity(100);           opacityRef.current   = 100
    setColorMode('grayscale'); colorModeRef.current = 'grayscale'
    setSeed(0);                seedRef.current      = 0
    setIsBusy(false);          isBusyRef.current    = false
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
    sc: number, op: number, cm: 'grayscale' | 'color', sd: number
  ): Promise<void> => {
    const handle   = canvasHandleRef.current
    const original = originalPixelsRef.current
    if (!handle || activeLayerId == null || original == null) return

    if (isBusyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runPreview(scaleRef.current, opacityRef.current,
                        colorModeRef.current, seedRef.current)
      }, 100)
      return
    }

    isBusyRef.current = true
    setIsBusy(true)
    try {
      const [fgR, fgG, fgB] = fgColorRef.current
      const [bgR, bgG, bgB] = bgColorRef.current
      const colorModeInt = cm === 'color' ? 1 : 0
      const result = await clouds(original.slice(), canvasWidth, canvasHeight,
                                  sc, op, colorModeInt,
                                  fgR, fgG, fgB, bgR, bgG, bgB, sd)
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
      void runPreview(scaleRef.current, opacityRef.current,
                      colorModeRef.current, seedRef.current)
    }, DEBOUNCE_MS)
  }, [runPreview])

  const handleScaleChange = useCallback((value: number): void => {
    const clamped = clamp(value, 1, 100000)
    setScale(clamped);  scaleRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleOpacityChange = useCallback((value: number): void => {
    const clamped = clamp(value, 1, 100)
    setOpacity(clamped);  opacityRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleColorModeChange = useCallback((value: 'grayscale' | 'color'): void => {
    setColorMode(value);  colorModeRef.current = value
    triggerPreview()
  }, [triggerPreview])

  const handleSeedChange = useCallback((value: number): void => {
    const clamped = clamp(value, 0, 9999)
    setSeed(clamped);  seedRef.current = clamped
    triggerPreview()
  }, [triggerPreview])

  const handleRandomizeSeed = useCallback((): void => {
    const newSeed = Math.floor(Math.random() * 10000)
    setSeed(newSeed);  seedRef.current = newSeed
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
      const [fgR, fgG, fgB] = fgColorRef.current
      const [bgR, bgG, bgB] = bgColorRef.current
      const colorModeInt = colorMode === 'color' ? 1 : 0
      const result = await clouds(original.slice(), canvasWidth, canvasHeight,
                                  scale, opacity, colorModeInt,
                                  fgR, fgG, fgB, bgR, bgG, bgB, seed)
      const composed = applySelectionComposite(result, original, selectionMaskRef.current)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Clouds')
      onClose()
    } catch (err) {
      console.error('[Clouds] Apply failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred.')
      handle.writeLayerPixels(activeLayerId, original)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight,
      scale, opacity, colorMode, seed, captureHistory, onClose])

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
    <ToolWindow title="Clouds" icon={<CloudsIcon />} onClose={handleCancel} width={284}>
      <div className={styles.body}>
        <div className={styles.row}>
          <label className={styles.label}>Scale</label>
          <input
            type="range"
            className={styles.slider}
            min={1} max={100000} step={1}
            value={scale}
            onChange={e => handleScaleChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={1} max={100000} step={1}
            value={scale}
            onChange={e => handleScaleChange(e.target.valueAsNumber)}
            onBlur={e  => handleScaleChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit} aria-hidden="true" />
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Opacity</label>
          <input
            type="range"
            className={styles.slider}
            min={1} max={100} step={1}
            value={opacity}
            onChange={e => handleOpacityChange(e.target.valueAsNumber)}
          />
          <input
            type="number"
            className={styles.numberInput}
            min={1} max={100} step={1}
            value={opacity}
            onChange={e => handleOpacityChange(e.target.valueAsNumber)}
            onBlur={e  => handleOpacityChange(e.target.valueAsNumber)}
          />
          <span className={styles.unit}>%</span>
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Mode</label>
          <div className={styles.toggleGroup}>
            <button
              className={colorMode === 'grayscale' ? styles.toggleBtnActive : styles.toggleBtn}
              onClick={() => handleColorModeChange('grayscale')}
            >
              Grayscale
            </button>
            <button
              className={colorMode === 'color' ? styles.toggleBtnActive : styles.toggleBtn}
              onClick={() => handleColorModeChange('color')}
            >
              Color
            </button>
          </div>
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Seed</label>
          <span style={{flex: 1}} />
          <input
            type="number"
            className={`${styles.numberInput} ${styles.seedInput}`}
            min={0} max={9999} step={1}
            value={seed}
            onChange={e => handleSeedChange(e.target.valueAsNumber)}
            onBlur={e  => handleSeedChange(e.target.valueAsNumber)}
          />
          <button
            className={styles.randomizeBtn}
            onClick={handleRandomizeSeed}
            title="Randomize seed"
          >
            ⟳
          </button>
        </div>
        {isBusy && (
          <div className={styles.previewIndicator}>
            <span className={styles.spinner} />
            Previewing…
          </div>
        )}
        {hasSelection && !isBusy && (
          <div className={styles.selectionNote}>
            Clouds will render inside the selection only.
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
