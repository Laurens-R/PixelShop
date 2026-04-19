import type { AdjustmentLayerState, LayerState, MaskLayerState, RGBAColor } from '@/types'
import { isPixelLayer } from '@/types'
import { buildCurvesLuts } from '@/adjustments/curves'
import type { GpuLayer, AdjustmentRenderOp, RenderPlanEntry } from '@/webgpu/WebGPURenderer'

function srgbByteToLinear(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const toLinear = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return { r: toLinear(r), g: toLinear(g), b: toLinear(b) }
}

function linearSrgbToOklab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(Math.max(l, 0))
  const m_ = Math.cbrt(Math.max(m, 0))
  const s_ = Math.cbrt(Math.max(s, 0))
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  }
}

export function buildAdjustmentEntry(
  ls: AdjustmentLayerState,
  mask: GpuLayer | undefined,
  swatches: RGBAColor[],
): AdjustmentRenderOp | null {
  if (ls.adjustmentType === 'brightness-contrast') {
    return {
      kind: 'brightness-contrast',
      layerId: ls.id,
      brightness: ls.params.brightness,
      contrast: ls.params.contrast,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'hue-saturation') {
    return {
      kind: 'hue-saturation',
      layerId: ls.id,
      hue: ls.params.hue,
      saturation: ls.params.saturation,
      lightness: ls.params.lightness,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'color-vibrance') {
    return {
      kind: 'color-vibrance',
      layerId: ls.id,
      vibrance: ls.params.vibrance,
      saturation: ls.params.saturation,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'color-balance') {
    return {
      kind: 'color-balance',
      layerId: ls.id,
      params: ls.params,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'black-and-white') {
    return {
      kind: 'black-and-white',
      layerId: ls.id,
      params: ls.params,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'color-temperature') {
    return {
      kind: 'color-temperature',
      layerId: ls.id,
      temperature: ls.params.temperature,
      tint: ls.params.tint,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'color-invert') {
    return {
      kind: 'color-invert',
      layerId: ls.id,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'selective-color') {
    return {
      kind: 'selective-color',
      layerId: ls.id,
      params: ls.params,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'curves') {
    return {
      kind: 'curves',
      layerId: ls.id,
      params: ls.params,
      luts: buildCurvesLuts(ls.params),
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'color-grading') {
    return {
      kind: 'color-grading',
      layerId: ls.id,
      params: ls.params,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'reduce-colors') {
    const { mode, derivedPalette } = ls.params
    const sourceColors: RGBAColor[] = mode === 'reduce'
      ? (derivedPalette ?? [])
      : (swatches.length >= 2 ? swatches : [])

    const paletteCount = Math.min(sourceColors.length, 256)
    const palette = new Float32Array(256 * 4)
    for (let i = 0; i < paletteCount; i++) {
      const { r, g, b } = sourceColors[i]
      const lin = srgbByteToLinear(r, g, b)
      const lab = linearSrgbToOklab(lin.r, lin.g, lin.b)
      palette[i * 4 + 0] = lab.L
      palette[i * 4 + 1] = lab.a
      palette[i * 4 + 2] = lab.b
      palette[i * 4 + 3] = 0
    }
    return {
      kind: 'reduce-colors',
      layerId: ls.id,
      visible: ls.visible,
      selMaskLayer: mask,
      palette,
      paletteCount,
    }
  }
  if (ls.adjustmentType === 'bloom') {
    return {
      kind: 'bloom',
      layerId: ls.id,
      threshold: ls.params.threshold,
      strength:  ls.params.strength,
      spread:    ls.params.spread,
      quality:   ls.params.quality,
      visible:   ls.visible,
      selMaskLayer: mask,
    }
  }
  const _exhaustive: never = ls
  return _exhaustive
}

export function buildRenderPlan(
  layers: readonly LayerState[],
  glLayers: Map<string, GpuLayer>,
  maskMap: Map<string, GpuLayer>,
  adjustmentMaskMap: Map<string, GpuLayer>,
  bypassedAdjustmentIds: ReadonlySet<string>,
  swatches: RGBAColor[],
): RenderPlanEntry[] {
  const plan: RenderPlanEntry[] = []

  for (let i = 0; i < layers.length; i++) {
    const ls = layers[i]
    if ('type' in ls && ls.type === 'mask') continue

    if ('type' in ls && ls.type === 'adjustment') {
      if (bypassedAdjustmentIds.has(ls.id)) continue
      const entry = buildAdjustmentEntry(ls, adjustmentMaskMap.get(ls.id), swatches)
      if (entry) plan.push(entry)
      continue
    }

    const baseLayer = glLayers.get(ls.id)
    if (!baseLayer) continue

    if (!isPixelLayer(ls)) {
      const id = (ls as { id: string }).id
      plan.push({ kind: 'layer', layer: baseLayer, mask: maskMap.get(id) })
      continue
    }

    const adjustments: AdjustmentRenderOp[] = []
    let cursor = i + 1
    while (cursor < layers.length) {
      const child = layers[cursor]
      if (
        'type' in child &&
        (child.type === 'mask' || child.type === 'adjustment') &&
        (child as MaskLayerState | AdjustmentLayerState).parentId === ls.id
      ) {
        if ('type' in child && child.type === 'adjustment' && !bypassedAdjustmentIds.has(child.id)) {
          const op = buildAdjustmentEntry(child, adjustmentMaskMap.get(child.id), swatches)
          if (op) adjustments.push(op)
        }
        cursor++
        continue
      }
      break
    }

    if (adjustments.length > 0) {
      plan.push({
        kind: 'adjustment-group',
        parentLayerId: ls.id,
        baseLayer,
        baseMask: maskMap.get(ls.id),
        adjustments,
      })
      i = cursor - 1
      continue
    }

    plan.push({ kind: 'layer', layer: baseLayer, mask: maskMap.get(ls.id) })
  }

  return plan
}
