import { useCallback, useMemo } from 'react'
import type { Dispatch, MutableRefObject } from 'react'
import type { FilterKey, LayerState, AppState } from '@/types'
import { isPixelLayer } from '@/types'
import { sharpen, sharpenMore } from '@/webgpu/filterCompute'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/window/Canvas/canvasHandle'
import type { AppAction } from '@/store/AppContext'

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

interface UseFiltersOptions {
  layers:             LayerState[]
  activeLayerId:      string | null
  onOpenFilterDialog: (key: FilterKey) => void
  canvasHandleRef:    { readonly current: CanvasHandle | null }
  canvasWidth:        number
  canvasHeight:       number
  captureHistory:     (label: string) => void
  dispatch:           Dispatch<AppAction>
  stateRef:           MutableRefObject<AppState>
}

export interface UseFiltersReturn {
  isFiltersMenuEnabled:   boolean
  handleOpenGaussianBlur: () => void
  handleOpenBoxBlur:      () => void
  handleOpenRadialBlur:   () => void
  handleOpenMotionBlur:   () => void
  handleOpenRemoveMotionBlur: () => void
  handleSharpen:          () => Promise<void>
  handleSharpenMore:      () => Promise<void>
  handleOpenUnsharpMask:  () => void
  handleOpenSmartSharpen: () => void
  handleOpenAddNoise:     () => void
  handleOpenFilmGrain:    () => void
  handleOpenLensBlur:     () => void
  handleOpenClouds:       () => void
  handleOpenMedianFilter: () => void
  handleOpenBilateralFilter: () => void
  handleOpenReduceNoise: () => void
  handleOpenLensFlare:    () => void
  handleApplyLensFlare:   (pixels: Uint8Array, width: number, height: number) => void
  handleInstantFilter:    (key: FilterKey) => void
  handleOpenPixelate:     () => void
}

export function useFilters({
  layers,
  activeLayerId,
  onOpenFilterDialog,
  canvasHandleRef,
  canvasWidth,
  canvasHeight,
  captureHistory,
  dispatch,
  stateRef,
}: UseFiltersOptions): UseFiltersReturn {
  const isFiltersMenuEnabled = useMemo(() => {
    const active = layers.find(l => l.id === activeLayerId)
    if (active == null) return false
    return isPixelLayer(active)
  }, [layers, activeLayerId])

  const handleOpenGaussianBlur = useCallback(
    () => onOpenFilterDialog('gaussian-blur'),
    [onOpenFilterDialog]
  )

  const handleOpenBoxBlur = useCallback(
    () => onOpenFilterDialog('box-blur'),
    [onOpenFilterDialog]
  )

  const handleOpenRadialBlur = useCallback(
    () => onOpenFilterDialog('radial-blur'),
    [onOpenFilterDialog]
  )

  const handleOpenMotionBlur = useCallback(
    () => onOpenFilterDialog('motion-blur'),
    [onOpenFilterDialog]
  )

  const handleOpenRemoveMotionBlur = useCallback(
    () => onOpenFilterDialog('remove-motion-blur'),
    [onOpenFilterDialog]
  )

  const handleSharpen = useCallback(async (): Promise<void> => {
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return
    const original = handle.getLayerPixels(activeLayerId)
    if (!original) return
    const mask = selectionStore.mask ? selectionStore.mask.slice() : null
    try {
      const result = await sharpen(original.slice(), canvasWidth, canvasHeight)
      const composed = applySelectionComposite(result, original, mask)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Sharpen')
    } catch (err) {
      console.error('[useFilters] Sharpen failed:', err)
      throw err
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, captureHistory])

  const handleSharpenMore = useCallback(async (): Promise<void> => {
    const handle = canvasHandleRef.current
    if (!handle || activeLayerId == null) return
    const original = handle.getLayerPixels(activeLayerId)
    if (!original) return
    const mask = selectionStore.mask ? selectionStore.mask.slice() : null
    try {
      const result = await sharpenMore(original.slice(), canvasWidth, canvasHeight)
      const composed = applySelectionComposite(result, original, mask)
      handle.writeLayerPixels(activeLayerId, composed)
      captureHistory('Sharpen More')
    } catch (err) {
      console.error('[useFilters] Sharpen More failed:', err)
      throw err
    }
  }, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, captureHistory])

  const handleOpenUnsharpMask = useCallback(
    () => onOpenFilterDialog('unsharp-mask'),
    [onOpenFilterDialog]
  )

  const handleOpenSmartSharpen = useCallback(
    () => onOpenFilterDialog('smart-sharpen'),
    [onOpenFilterDialog]
  )

  const handleOpenAddNoise = useCallback(
    () => onOpenFilterDialog('add-noise'),
    [onOpenFilterDialog]
  )

  const handleOpenFilmGrain = useCallback(
    () => onOpenFilterDialog('film-grain'),
    [onOpenFilterDialog]
  )

  const handleOpenLensBlur = useCallback(
    () => onOpenFilterDialog('lens-blur'),
    [onOpenFilterDialog]
  )

  const handleOpenClouds = useCallback(
    () => onOpenFilterDialog('clouds'),
    [onOpenFilterDialog]
  )

  const handleOpenMedianFilter = useCallback(
    () => onOpenFilterDialog('median-filter'),
    [onOpenFilterDialog]
  )

  const handleOpenBilateralFilter = useCallback(
    () => onOpenFilterDialog('bilateral-filter'),
    [onOpenFilterDialog]
  )

  const handleOpenReduceNoise = useCallback(
    () => onOpenFilterDialog('reduce-noise'),
    [onOpenFilterDialog]
  )

  const handleOpenLensFlare = useCallback(
    () => onOpenFilterDialog('render-lens-flare'),
    [onOpenFilterDialog]
  )

  const handleApplyLensFlare = useCallback((
    pixels: Uint8Array,
    width:  number,
    height: number,
  ): void => {
    const handle        = canvasHandleRef.current
    const activeId      = stateRef.current.activeLayerId
    if (!handle || !activeId) return
    const newId = `layer-${Date.now()}`
    captureHistory('Lens Flare')
    handle.prepareNewLayer(newId, 'Lens Flare', pixels)
    dispatch({
      type:    'INSERT_LAYER_ABOVE',
      payload: {
        layer: { id: newId, name: 'Lens Flare', visible: true, opacity: 1, locked: false, blendMode: 'normal' },
        aboveId: activeId,
      },
    })
  }, [canvasHandleRef, stateRef, captureHistory, dispatch])

  const handleInstantFilter = useCallback((key: FilterKey): void => {
    if (key === 'sharpen')      void handleSharpen()
    if (key === 'sharpen-more') void handleSharpenMore()
  }, [handleSharpen, handleSharpenMore])

  const handleOpenPixelate = useCallback(
    () => onOpenFilterDialog('pixelate'),
    [onOpenFilterDialog]
  )

  return {
    isFiltersMenuEnabled,
    handleOpenGaussianBlur,
    handleOpenBoxBlur,
    handleOpenRadialBlur,
    handleOpenMotionBlur,
    handleOpenRemoveMotionBlur,
    handleSharpen,
    handleSharpenMore,
    handleOpenUnsharpMask,
    handleOpenSmartSharpen,
    handleOpenAddNoise,
    handleOpenFilmGrain,
    handleOpenLensBlur,
    handleOpenClouds,
    handleOpenMedianFilter,
    handleOpenBilateralFilter,
    handleOpenReduceNoise,
    handleOpenLensFlare,
    handleApplyLensFlare,
    handleInstantFilter,
    handleOpenPixelate,
  }
}
