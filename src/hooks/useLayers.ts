import { useCallback } from 'react'
import type { Dispatch, MutableRefObject } from 'react'
import type { AppState, LayerState } from '@/types'
import type { AppAction } from '@/store/AppContext'
import type { CanvasHandle } from '@/components/window/Canvas/Canvas'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseLayersOptions {
  canvasHandleRef: { readonly current: CanvasHandle | null }
  stateRef: MutableRefObject<AppState>
  captureHistory: (label: string) => void
  dispatch: Dispatch<AppAction>
  pendingLayerLabelRef: MutableRefObject<string | null>
}

export interface UseLayersReturn {
  handleMergeSelected:    (ids: string[]) => void
  handleMergeDown:        () => void
  handleMergeVisible:     () => void
  handleNewLayer:         () => void
  handleDuplicateLayer:   () => void
  handleDeleteActiveLayer: () => void
  handleFlattenImage:     () => void
}

// ─── Blend composite ─────────────────────────────────────────────────────────
// Mirrors the GLSL blend-mode shader so layer merges match the on-screen render.

type V3 = [number, number, number]

const BLEND_FNS: Record<string, (s: V3, d: V3) => V3> = {
  normal:       (s)       =>  s,
  multiply:     (s, d)    => [s[0]*d[0], s[1]*d[1], s[2]*d[2]],
  screen:       (s, d)    => [s[0]+d[0]-s[0]*d[0], s[1]+d[1]-s[1]*d[1], s[2]+d[2]-s[2]*d[2]],
  overlay:      (s, d)    => d.map((dc, i) => dc < 0.5 ? 2*s[i]*dc : 1-2*(1-s[i])*(1-dc)) as V3,
  'soft-light': (s, d)    => d.map((dc, i) => {
    const sc = s[i]; const q = sc < 0.5 ? dc : Math.sqrt(dc)
    return sc < 0.5 ? dc - (1-2*sc)*dc*(1-dc) : dc + (2*sc-1)*(q-dc)
  }) as V3,
  'hard-light': (s, d)    => s.map((sc, i) => sc < 0.5 ? 2*sc*d[i] : 1-2*(1-sc)*(1-d[i])) as V3,
  darken:       (s, d)    => [Math.min(s[0],d[0]), Math.min(s[1],d[1]), Math.min(s[2],d[2])],
  lighten:      (s, d)    => [Math.max(s[0],d[0]), Math.max(s[1],d[1]), Math.max(s[2],d[2])],
  difference:   (s, d)    => [Math.abs(d[0]-s[0]), Math.abs(d[1]-s[1]), Math.abs(d[2]-s[2])],
  exclusion:    (s, d)    => [s[0]+d[0]-2*s[0]*d[0], s[1]+d[1]-2*s[1]*d[1], s[2]+d[2]-2*s[2]*d[2]],
  'color-dodge': (s, d)   => s.map((sc, i) => Math.min(d[i] / Math.max(1-sc, 0.0001), 1)) as V3,
  'color-burn':  (s, d)   => s.map((sc, i) => 1 - Math.min((1-d[i]) / Math.max(sc, 0.0001), 1)) as V3,
}

function compositeLayers(
  layerList: LayerState[],
  stateRef: MutableRefObject<AppState>,
  canvasHandleRef: { readonly current: CanvasHandle | null },
): Uint8Array {
  const { width, height } = stateRef.current.canvas
  const out = new Uint8Array(width * height * 4)

  // Build mask map from ALL current state layers (applies even if not in layerList)
  const allLayers = stateRef.current.layers
  const maskPixelMap = new Map<string, Uint8Array>()
  for (const ls of allLayers) {
    if ('type' in ls && ls.type === 'mask' && ls.visible) {
      const maskPx = canvasHandleRef.current?.getLayerPixels(ls.id)
      if (maskPx) maskPixelMap.set((ls as { parentId: string }).parentId, maskPx)
    }
  }

  for (const layer of layerList) {
    // Skip mask and adjustment layers — they are not composited independently
    if ('type' in layer && (layer.type === 'mask' || layer.type === 'adjustment')) continue
    const src = canvasHandleRef.current?.getLayerPixels(layer.id)
    if (!src) continue
    const blendFn = BLEND_FNS[layer.blendMode] ?? BLEND_FNS.normal
    const opacity = layer.opacity
    const maskPx = maskPixelMap.get(layer.id)

    for (let i = 0; i < src.length; i += 4) {
      let srcA = (src[i + 3] / 255) * opacity
      // Apply layer mask: R channel of mask = grayscale alpha (0=hide, 255=show)
      if (maskPx) srcA *= maskPx[i] / 255
      if (srcA <= 0) continue
      const dstA = out[i + 3] / 255
      const outA = srcA + dstA * (1 - srcA)
      if (outA <= 0) continue

      const s: V3 = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255]
      const d: V3 = dstA > 0.0001
        ? [out[i] / (dstA * 255), out[i + 1] / (dstA * 255), out[i + 2] / (dstA * 255)]
        : [0, 0, 0]

      const bl = blendFn(s, d)
      out[i]     = Math.round(Math.min(1, (bl[0] * srcA + d[0] * dstA * (1 - srcA)) / outA) * 255)
      out[i + 1] = Math.round(Math.min(1, (bl[1] * srcA + d[1] * dstA * (1 - srcA)) / outA) * 255)
      out[i + 2] = Math.round(Math.min(1, (bl[2] * srcA + d[2] * dstA * (1 - srcA)) / outA) * 255)
      out[i + 3] = Math.round(outA * 255)
    }
  }
  return out
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLayers({
  canvasHandleRef,
  stateRef,
  captureHistory,
  dispatch,
  pendingLayerLabelRef,
}: UseLayersOptions): UseLayersReturn {

  const handleMergeSelected = useCallback((ids: string[]): void => {
    if (ids.length < 2 || !canvasHandleRef.current) return
    const layers      = stateRef.current.layers
    const selectedSet = new Set(ids)
    // Merge only non-mask layers in the selection
    const selected    = layers.filter(l => selectedSet.has(l.id) && !('type' in l && l.type === 'mask'))
    if (selected.length < 2) return
    captureHistory('Merge Layers')
    const merged     = compositeLayers(selected, stateRef, canvasHandleRef)
    const topIdx     = layers.findLastIndex(l => selectedSet.has(l.id) && !('type' in l && l.type === 'mask'))
    const mergedName = selected[selected.length - 1].name
    const newId      = `layer-${Date.now()}`
    canvasHandleRef.current.prepareNewLayer(newId, mergedName, merged)
    const newLayers: LayerState[] = []
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]
      // Remove mask children of merged layers
      if ('type' in l && l.type === 'mask' && selectedSet.has((l as { parentId: string }).parentId)) continue
      if (i === topIdx) newLayers.push({ id: newId, name: mergedName, visible: true, opacity: 1, locked: false, blendMode: 'normal' })
      if (!selectedSet.has(l.id)) newLayers.push(l)
    }
    dispatch({ type: 'REORDER_LAYERS', payload: newLayers })
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: newId })
  }, [canvasHandleRef, stateRef, captureHistory, dispatch])

  const handleMergeDown = useCallback((): void => {
    const layers        = stateRef.current.layers
    const activeLayerId = stateRef.current.activeLayerId
    if (!canvasHandleRef.current || !activeLayerId) return
    // Don't merge if active layer is a mask
    const activeMeta = layers.find(l => l.id === activeLayerId)
    if (activeMeta && 'type' in activeMeta && activeMeta.type === 'mask') return
    // Work only with non-mask layers for index calculation
    const pxLayers  = layers.filter(l => !('type' in l && l.type === 'mask'))
    const activeIdx = pxLayers.findIndex(l => l.id === activeLayerId)
    if (activeIdx <= 0) return
    const toMerge    = pxLayers.slice(0, activeIdx + 1)
    captureHistory('Merge Down')
    const merged     = compositeLayers(toMerge, stateRef, canvasHandleRef)
    const newId      = `layer-${Date.now()}`
    const mergedName = pxLayers[0].name
    const mergeIds   = new Set(toMerge.map(l => l.id))
    canvasHandleRef.current.prepareNewLayer(newId, mergedName, merged)
    const newLayers: LayerState[] = []
    let insertedMerged = false
    for (const l of layers) {
      // Remove mask children of merged layers
      if ('type' in l && l.type === 'mask' && mergeIds.has((l as { parentId: string }).parentId)) continue
      if (mergeIds.has(l.id)) {
        if (!insertedMerged) {
          newLayers.push({ id: newId, name: mergedName, visible: true, opacity: 1, locked: false, blendMode: 'normal' })
          insertedMerged = true
        }
        continue
      }
      newLayers.push(l)
    }
    dispatch({ type: 'REORDER_LAYERS', payload: newLayers })
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: newId })
  }, [canvasHandleRef, stateRef, captureHistory, dispatch])

  const handleMergeVisible = useCallback((): void => {
    const layers   = stateRef.current.layers
    if (!canvasHandleRef.current) return
    // Only count visible non-mask layers
    const visible  = layers.filter(l => l.visible && !('type' in l && l.type === 'mask'))
    if (visible.length < 2) return
    captureHistory('Merge Visible')
    const merged      = compositeLayers(visible, stateRef, canvasHandleRef)
    const visibleIds  = new Set(visible.map(l => l.id))
    const topIdx      = layers.findLastIndex(l => visibleIds.has(l.id))
    const newId       = `layer-${Date.now()}`
    canvasHandleRef.current.prepareNewLayer(newId, 'Merged', merged)
    const newLayers: LayerState[] = []
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]
      // Remove mask children of merged layers
      if ('type' in l && l.type === 'mask' && visibleIds.has((l as { parentId: string }).parentId)) continue
      if (i === topIdx)               newLayers.push({ id: newId, name: 'Merged', visible: true, opacity: 1, locked: false, blendMode: 'normal' })
      if (!visibleIds.has(l.id))      newLayers.push(l)
    }
    dispatch({ type: 'REORDER_LAYERS', payload: newLayers })
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: newId })
  }, [canvasHandleRef, stateRef, captureHistory, dispatch])

  const handleNewLayer = useCallback((): void => {
    const id = `layer-${Date.now()}`
    pendingLayerLabelRef.current = 'New Layer'
    dispatch({
      type: 'ADD_LAYER',
      payload: { id, name: `Layer ${stateRef.current.layers.length + 1}`, visible: true, opacity: 1, locked: false, blendMode: 'normal' },
    })
  }, [dispatch, stateRef, pendingLayerLabelRef])

  const handleDuplicateLayer = useCallback((): void => {
    const { activeLayerId, layers } = stateRef.current
    if (!activeLayerId || !canvasHandleRef.current) return
    const src    = layers.find(l => l.id === activeLayerId)
    if (!src) return
    const pixels = canvasHandleRef.current.getLayerPixels(src.id)
    if (!pixels) return
    const newId  = `layer-${Date.now()}`
    const name   = `${src.name} copy`
    canvasHandleRef.current.prepareNewLayer(newId, name, pixels)
    pendingLayerLabelRef.current = 'Duplicate Layer'
    dispatch({ type: 'ADD_LAYER', payload: { ...src, id: newId, name } })
  }, [dispatch, stateRef, canvasHandleRef, pendingLayerLabelRef])

  const handleDeleteActiveLayer = useCallback((): void => {
    const id = stateRef.current.activeLayerId
    if (id) dispatch({ type: 'REMOVE_LAYER', payload: id })
  }, [dispatch, stateRef])

  const handleFlattenImage = useCallback((): void => {
    const layers    = stateRef.current.layers
    const pxLayers  = layers.filter(l => !('type' in l && l.type === 'mask'))
    if (!canvasHandleRef.current || pxLayers.length < 2) return
    captureHistory('Flatten Image')
    const merged = compositeLayers(pxLayers, stateRef, canvasHandleRef)
    const newId  = `layer-${Date.now()}`
    canvasHandleRef.current.prepareNewLayer(newId, 'Background', merged)
    dispatch({ type: 'REORDER_LAYERS', payload: [{ id: newId, name: 'Background', visible: true, opacity: 1, locked: false, blendMode: 'normal' }] })
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: newId })
  }, [canvasHandleRef, stateRef, captureHistory, dispatch])

  return {
    handleMergeSelected, handleMergeDown, handleMergeVisible,
    handleNewLayer, handleDuplicateLayer, handleDeleteActiveLayer, handleFlattenImage,
  }
}
