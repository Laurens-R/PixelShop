import { useCallback, useMemo } from 'react'
import type { FilterKey, LayerState } from '@/types'
import { isPixelLayer } from '@/types'
import { sharpen, sharpenMore } from '@/wasm'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/window/Canvas/canvasHandle'

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
  handleInstantFilter:    (key: FilterKey) => void
}

export function useFilters({
  layers,
  activeLayerId,
  onOpenFilterDialog,
  canvasHandleRef,
  canvasWidth,
  canvasHeight,
  captureHistory,
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

  const handleInstantFilter = useCallback((key: FilterKey): void => {
    if (key === 'sharpen')      void handleSharpen()
    if (key === 'sharpen-more') void handleSharpenMore()
  }, [handleSharpen, handleSharpenMore])

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
    handleInstantFilter,
  }
}
