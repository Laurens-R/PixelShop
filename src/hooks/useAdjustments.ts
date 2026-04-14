import { useCallback, useMemo } from 'react'
import type { Dispatch, MutableRefObject } from 'react'
import type { AppState, AdjustmentLayerState, AdjustmentType, LayerState } from '@/types'
import { isPixelLayer } from '@/types'
import type { AppAction } from '@/store/AppContext'
import { ADJUSTMENT_REGISTRY } from '@/adjustments/registry'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseAdjustmentsOptions {
  stateRef:             MutableRefObject<AppState>
  captureHistory:       (label: string) => void
  dispatch:             Dispatch<AppAction>
  layers:               LayerState[]
  activeLayerId:        string | null
  getSelectionPixels?:  () => Uint8Array | null
  registerAdjMask?:     (layerId: string, pixels: Uint8Array) => void
}

export interface UseAdjustmentsReturn {
  handleCreateAdjustmentLayer: (adjustmentType: AdjustmentType) => void
  handleOpenAdjustmentPanel:   (layerId: string) => void
  handleCloseAdjustmentPanel:  () => void
  isAdjustmentMenuEnabled:     boolean
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAdjustments({
  stateRef,
  captureHistory,
  dispatch,
  layers,
  activeLayerId,
  getSelectionPixels,
  registerAdjMask,
}: UseAdjustmentsOptions): UseAdjustmentsReturn {
  const isAdjustmentMenuEnabled = useMemo(() => {
    const active = layers.find(l => l.id === activeLayerId)
    if (active == null) return false
    if (isPixelLayer(active)) return true
    // Also allow when an adjustment child layer is active — will use its parent
    if ('type' in active && active.type === 'adjustment') {
      const parent = layers.find(l => l.id === (active as { parentId: string }).parentId)
      return parent != null && isPixelLayer(parent)
    }
    return false
  }, [layers, activeLayerId])

  const handleCloseAdjustmentPanel = useCallback((): void => {
    captureHistory('Adjustment')
    dispatch({ type: 'SET_OPEN_ADJUSTMENT', payload: null })
  }, [captureHistory, dispatch])

  const handleCreateAdjustmentLayer = useCallback((adjustmentType: AdjustmentType): void => {
    const { activeLayerId, layers, openAdjustmentLayerId } = stateRef.current

    if (openAdjustmentLayerId !== null) {
      captureHistory('Adjustment')
      dispatch({ type: 'SET_OPEN_ADJUSTMENT', payload: null })
    }

    const activeLayer = layers.find(l => l.id === activeLayerId)
    if (!activeLayer) return

    // If the active layer is itself an adjustment child, use its parent pixel layer instead
    let effectiveParentId: string
    if (isPixelLayer(activeLayer)) {
      effectiveParentId = activeLayerId!
    } else if ('type' in activeLayer && activeLayer.type === 'adjustment') {
      const parentId = (activeLayer as { parentId: string }).parentId
      const parentLayer = layers.find(l => l.id === parentId)
      if (!parentLayer || !isPixelLayer(parentLayer)) return
      effectiveParentId = parentId
    } else {
      return
    }

    const entry = ADJUSTMENT_REGISTRY.find(e => e.adjustmentType === adjustmentType)
    if (!entry) return

    const newId = `adj-${Date.now()}`
    const selPixels = getSelectionPixels ? getSelectionPixels() : null
    const hasMask = selPixels !== null

    const newLayer = {
      id: newId,
      name: entry.label.replace('…', ''),
      visible: true,
      type: 'adjustment' as const,
      parentId: effectiveParentId,
      adjustmentType: entry.adjustmentType,
      params: { ...entry.defaultParams },
      hasMask,
    } as AdjustmentLayerState

    dispatch({ type: 'ADD_ADJUSTMENT_LAYER', payload: newLayer })
    dispatch({ type: 'SET_OPEN_ADJUSTMENT', payload: newId })

    if (selPixels && registerAdjMask) {
      registerAdjMask(newId, selPixels)
    }
  }, [stateRef, captureHistory, dispatch, getSelectionPixels, registerAdjMask])

  const handleOpenAdjustmentPanel = useCallback((layerId: string): void => {
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: layerId })
    dispatch({ type: 'SET_OPEN_ADJUSTMENT', payload: layerId })
  }, [dispatch])

  return { handleCreateAdjustmentLayer, handleOpenAdjustmentPanel, handleCloseAdjustmentPanel, isAdjustmentMenuEnabled }
}
