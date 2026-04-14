import type { AdjustmentType, AdjustmentParamsMap } from '@/types'

export interface AdjustmentRegistrationEntry<T extends AdjustmentType = AdjustmentType> {
  adjustmentType: T
  label: string
  defaultParams: AdjustmentParamsMap[T]
}

export const ADJUSTMENT_REGISTRY = [
  {
    adjustmentType: 'brightness-contrast' as const,
    label: 'Brightness/Contrast…',
    defaultParams: { brightness: 0, contrast: 0 },
  },
  {
    adjustmentType: 'hue-saturation' as const,
    label: 'Hue/Saturation…',
    defaultParams: { hue: 0, saturation: 0, lightness: 0 },
  },
  {
    adjustmentType: 'color-vibrance' as const,
    label: 'Color Vibrance…',
    defaultParams: { vibrance: 0, saturation: 0 },
  },
] as const satisfies readonly AdjustmentRegistrationEntry[]
