import type { AdjustmentLayerState } from '@/types'
import type { WebGLLayer, AdjustmentRenderOp } from '@/webgl/WebGLRenderer'

export function buildAdjustmentEntry(
  ls: AdjustmentLayerState,
  mask: WebGLLayer | undefined
): AdjustmentRenderOp | null {
  if (ls.adjustmentType === 'brightness-contrast') {
    return {
      kind: 'brightness-contrast',
      brightness: ls.params.brightness,
      contrast: ls.params.contrast,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'hue-saturation') {
    return {
      kind: 'hue-saturation',
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
      vibrance: ls.params.vibrance,
      saturation: ls.params.saturation,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'color-balance') {
    return {
      kind: 'color-balance',
      params: ls.params,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'black-and-white') {
    return {
      kind: 'black-and-white',
      params: ls.params,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'color-temperature') {
    return {
      kind: 'color-temperature',
      temperature: ls.params.temperature,
      tint: ls.params.tint,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'color-invert') {
    return {
      kind: 'color-invert',
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  if (ls.adjustmentType === 'selective-color') {
    return {
      kind: 'selective-color',
      params: ls.params,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  const _exhaustive: never = ls
  return _exhaustive
}
