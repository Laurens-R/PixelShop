import type { AdjustmentType, AdjustmentParamsMap } from '@/types'
import { createDefaultCurvesParams } from '@/adjustments/curves'

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
  {
    adjustmentType: 'color-balance' as const,
    label: 'Color Balance…',
    defaultParams: {
      shadows:    { cr: 0, mg: 0, yb: 0 },
      midtones:   { cr: 0, mg: 0, yb: 0 },
      highlights: { cr: 0, mg: 0, yb: 0 },
      preserveLuminosity: true,
    },
  },
  {
    adjustmentType: 'black-and-white' as const,
    label: 'Black and White…',
    defaultParams: {
      reds:     40,
      yellows:  60,
      greens:   40,
      cyans:    60,
      blues:    20,
      magentas: 80,
    },
  },
  {
    adjustmentType: 'color-temperature' as const,
    label: 'Color Temperature…',
    defaultParams: { temperature: 0, tint: 0 },
  },
  {
    adjustmentType: 'color-invert' as const,
    label: 'Invert',
    defaultParams: {},
  },
  {
    adjustmentType: 'selective-color' as const,
    label: 'Selective Color…',
    defaultParams: {
      reds:     { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      yellows:  { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      greens:   { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      cyans:    { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      blues:    { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      magentas: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      whites:   { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      neutrals: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      blacks:   { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      mode: 'relative',
    },
  },
  {
    adjustmentType: 'curves' as const,
    label: 'Curves…',
    defaultParams: createDefaultCurvesParams(),
  },
  {
    adjustmentType: 'color-grading' as const,
    label: 'Color Grading…',
    defaultParams: {
      lift:   { r: 0, g: 0, b: 0, master: 0 },
      gamma:  { r: 0, g: 0, b: 0, master: 0 },
      gain:   { r: 0, g: 0, b: 0, master: 0 },
      offset: { r: 0, g: 0, b: 0, master: 0 },
      temp:      6500,
      tint:      0,
      contrast:  1.0,
      pivot:     0.435,
      midDetail: 0,
      colorBoost:  0,
      shadows:     0,
      highlights:  0,
      saturation:  50,
      hue:         50,
      lumMix:      100,
    },
  },
  {
    adjustmentType: 'reduce-colors' as const,
    label: 'Reduce Colors…',
    defaultParams: { mode: 'reduce', colorCount: 16, derivedPalette: null },
  },
] as const satisfies readonly AdjustmentRegistrationEntry[]
