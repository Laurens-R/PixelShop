import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject } from 'react'
import { historyStore } from '@/store/historyStore'
import type { AppState } from '@/types'
import type { AppAction } from '@/store/AppContext'
import type { CanvasHandle } from '@/components/window/Canvas/Canvas'
import type { TabRecord } from '@/store/tabTypes'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseHistoryOptions {
  canvasHandleRef: { readonly current: CanvasHandle | null }
  stateRef: MutableRefObject<AppState>
  dispatch: Dispatch<AppAction>
  activeTabIdRef: MutableRefObject<string>
  setTabsRef: MutableRefObject<Dispatch<React.SetStateAction<TabRecord[]>>>
  setPendingLayerData: Dispatch<React.SetStateAction<Map<string, string> | null>>
  /** state.layers — dependency for the auto-capture-on-layer-change effect. */
  layers: AppState['layers']
}

export interface UseHistoryReturn {
  captureHistory: (label: string) => void
  isRestoringRef: MutableRefObject<boolean>
  suppressReadyCaptureRef: MutableRefObject<boolean>
  pendingLayerLabelRef: MutableRefObject<string | null>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHistory({
  canvasHandleRef,
  stateRef,
  dispatch,
  activeTabIdRef,
  setTabsRef,
  setPendingLayerData,
  layers,
}: UseHistoryOptions): UseHistoryReturn {
  const isRestoringRef        = useRef(false)
  const suppressReadyCaptureRef = useRef(false)
  const pendingLayerLabelRef  = useRef<string | null>(null)
  const prevLayersRef         = useRef(layers)

  const captureHistory = useCallback((label: string): void => {
    if (isRestoringRef.current) return
    if (suppressReadyCaptureRef.current) {
      suppressReadyCaptureRef.current = false
      return
    }
    const layerPixels = canvasHandleRef.current?.captureAllLayerPixels()
    if (!layerPixels || layerPixels.size === 0) return
    const layerGeometry = canvasHandleRef.current?.captureAllLayerGeometry() ?? new Map()
    const s = stateRef.current
    historyStore.push({
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label,
      timestamp: Date.now(),
      layerPixels,
      layerGeometry,
      layerState: s.layers,
      activeLayerId: s.activeLayerId,
      canvasWidth: s.canvas.width,
      canvasHeight: s.canvas.height,
    })
  }, [canvasHandleRef, stateRef])

  // Preview: temporarily show a history entry without committing state
  useEffect(() => {
    historyStore.onPreview = (index: number): void => {
      const entry = historyStore.entries[index]
      if (!entry) return
      if (
        entry.canvasWidth  !== stateRef.current.canvas.width ||
        entry.canvasHeight !== stateRef.current.canvas.height
      ) return
      canvasHandleRef.current?.restoreAllLayerPixels(entry.layerPixels, entry.layerGeometry)
    }
    return () => { historyStore.onPreview = null }
  }, [canvasHandleRef, stateRef])

  // Jump-to: full restore — may trigger canvas remount for dimension changes
  useEffect(() => {
    historyStore.onJumpTo = (index: number): void => {
      const entry = historyStore.entries[index]
      if (!entry) return
      isRestoringRef.current = true
      const currentW = stateRef.current.canvas.width
      const currentH = stateRef.current.canvas.height

      if (entry.canvasWidth !== currentW || entry.canvasHeight !== currentH) {
        const encoded = new Map<string, string>()
        for (const [id, pixels] of entry.layerPixels) {
          const geo = entry.layerGeometry?.get(id)
          const lw = geo?.layerWidth ?? entry.canvasWidth
          const lh = geo?.layerHeight ?? entry.canvasHeight
          const tmp = document.createElement('canvas')
          tmp.width = lw; tmp.height = lh
          const ctx2d = tmp.getContext('2d')!
          ctx2d.putImageData(
            new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), lw, lh),
            0, 0
          )
          encoded.set(id, tmp.toDataURL('image/png'))
          if (geo) encoded.set(`${id}:geo`, JSON.stringify(geo))
        }
        suppressReadyCaptureRef.current = true
        setPendingLayerData(encoded)
        const jumpTabId = activeTabIdRef.current
        setTabsRef.current(prev => prev.map(t =>
          t.id === jumpTabId
            ? { ...t, canvasKey: t.canvasKey + 1, snapshot: { ...t.snapshot, canvasWidth: entry.canvasWidth, canvasHeight: entry.canvasHeight } }
            : t
        ))
        dispatch({
          type: 'SWITCH_TAB',
          payload: {
            width: entry.canvasWidth,
            height: entry.canvasHeight,
            backgroundFill: stateRef.current.canvas.backgroundFill,
            layers: entry.layerState,
            activeLayerId: entry.activeLayerId,
            zoom: stateRef.current.canvas.zoom,
          },
        })
      } else {
        canvasHandleRef.current?.restoreAllLayerPixels(entry.layerPixels, entry.layerGeometry)
        dispatch({
          type: 'RESTORE_LAYERS',
          payload: { layers: entry.layerState, activeLayerId: entry.activeLayerId },
        })
      }

      historyStore.setCurrent(index)
      setTimeout(() => { isRestoringRef.current = false }, 200)
    }
    return () => { historyStore.onJumpTo = null }
  }, [dispatch, canvasHandleRef, stateRef, activeTabIdRef, setTabsRef, setPendingLayerData])

  // Register onClear: capture current state as 'History Cleared' entry
  useEffect(() => {
    historyStore.onClear = (): void => { captureHistory('History Cleared') }
    return () => { historyStore.onClear = null }
  }, [captureHistory])

  // Auto-capture when layers are added or removed
  useEffect(() => {
    if (isRestoringRef.current) {
      prevLayersRef.current = layers
      isRestoringRef.current = false
      return
    }
    const prev = prevLayersRef.current
    const curr = layers
    if (prev !== curr) {
      if (curr.length > prev.length) {
        captureHistory(pendingLayerLabelRef.current ?? 'New Layer')
        pendingLayerLabelRef.current = null
      } else if (curr.length < prev.length) {
        captureHistory('Delete Layer')
      }
      prevLayersRef.current = curr
    }
  }, [layers, captureHistory])

  return { captureHistory, isRestoringRef, suppressReadyCaptureRef, pendingLayerLabelRef }
}
