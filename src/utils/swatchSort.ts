import { RGBAColor } from '@/types'

export function rgbaToHsl(c: RGBAColor): { h: number; s: number; l: number } {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return { h: 0, s: 0, l }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h: number
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
    case g: h = ((b - r) / d + 2) / 6; break
    default: h = ((r - g) / d + 4) / 6; break
  }

  return { h: h * 360, s, l }
}

export function sortSwatchesByHue(swatches: RGBAColor[]): RGBAColor[] {
  const neutrals: RGBAColor[] = []
  const chromatics: RGBAColor[] = []
  const transparent: RGBAColor[] = []

  for (const sw of swatches) {
    if (sw.a === 0) {
      transparent.push(sw)
      continue
    }
    const { s } = rgbaToHsl(sw)
    if (s < 0.15) {
      neutrals.push(sw)
    } else {
      chromatics.push(sw)
    }
  }

  neutrals.sort((a, b) => rgbaToHsl(a).l - rgbaToHsl(b).l)
  chromatics.sort((a, b) => {
    const ha = rgbaToHsl(a)
    const hb = rgbaToHsl(b)
    return ha.h !== hb.h ? ha.h - hb.h : ha.l - hb.l
  })

  return [...chromatics, ...neutrals, ...transparent]
}
