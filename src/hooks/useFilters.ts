import { useCallback, useMemo } from 'react'
import type { FilterKey, LayerState } from '@/types'
import { isPixelLayer } from '@/types'

interface UseFiltersOptions {
  layers:             LayerState[]
  activeLayerId:      string | null
  onOpenFilterDialog: (key: FilterKey) => void
}

export interface UseFiltersReturn {
  isFiltersMenuEnabled:   boolean
  handleOpenGaussianBlur: () => void
  handleOpenBoxBlur:      () => void
}

export function useFilters({
  layers,
  activeLayerId,
  onOpenFilterDialog,
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

  return { isFiltersMenuEnabled, handleOpenGaussianBlur, handleOpenBoxBlur }
}
