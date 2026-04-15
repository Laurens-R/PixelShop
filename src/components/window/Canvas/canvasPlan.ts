import type { AdjustmentLayerState, LayerState, MaskLayerState } from '@/types'
import { isPixelLayer } from '@/types'
import { buildCurvesLuts } from '@/adjustments/curves'
import type { WebGLLayer, AdjustmentRenderOp, RenderPlanEntry } from '@/webgl/WebGLRenderer'

export function buildAdjustmentEntry(
  ls: AdjustmentLayerState,
  mask: WebGLLayer | undefined
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
  const _exhaustive: never = ls
  return _exhaustive
}

export function buildRenderPlan(
  layers: readonly LayerState[],
  glLayers: Map<string, WebGLLayer>,
  maskMap: Map<string, WebGLLayer>,
  adjustmentMaskMap: Map<string, WebGLLayer>,
  bypassedAdjustmentIds: ReadonlySet<string>
): RenderPlanEntry[] {
  const plan: RenderPlanEntry[] = []

  for (let i = 0; i < layers.length; i++) {
    const ls = layers[i]
    if ('type' in ls && ls.type === 'mask') continue

    if ('type' in ls && ls.type === 'adjustment') {
      if (bypassedAdjustmentIds.has(ls.id)) continue
      const entry = buildAdjustmentEntry(ls, adjustmentMaskMap.get(ls.id))
      if (entry) plan.push(entry)
      continue
    }

    const baseLayer = glLayers.get(ls.id)
    if (!baseLayer) continue

    if (!isPixelLayer(ls)) {
      plan.push({ kind: 'layer', layer: baseLayer, mask: maskMap.get(ls.id) })
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
          const op = buildAdjustmentEntry(child, adjustmentMaskMap.get(child.id))
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
