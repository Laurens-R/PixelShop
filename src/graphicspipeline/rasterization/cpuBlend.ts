type V3 = [number, number, number]

type BlendFn = (s: V3, d: V3) => V3

const BLEND_FNS: Record<string, BlendFn> = {
  normal: (s) => s,
  multiply: (s, d) => [s[0] * d[0], s[1] * d[1], s[2] * d[2]],
  screen: (s, d) => [s[0] + d[0] - s[0] * d[0], s[1] + d[1] - s[1] * d[1], s[2] + d[2] - s[2] * d[2]],
  overlay: (s, d) => d.map((dc, i) => (dc < 0.5 ? 2 * s[i] * dc : 1 - 2 * (1 - s[i]) * (1 - dc))) as V3,
  'soft-light': (s, d) => d.map((dc, i) => {
    const sc = s[i]
    const q = sc < 0.5 ? dc : Math.sqrt(dc)
    return sc < 0.5 ? dc - (1 - 2 * sc) * dc * (1 - dc) : dc + (2 * sc - 1) * (q - dc)
  }) as V3,
  'hard-light': (s, d) => s.map((sc, i) => (sc < 0.5 ? 2 * sc * d[i] : 1 - 2 * (1 - sc) * (1 - d[i]))) as V3,
  darken: (s, d) => [Math.min(s[0], d[0]), Math.min(s[1], d[1]), Math.min(s[2], d[2])],
  lighten: (s, d) => [Math.max(s[0], d[0]), Math.max(s[1], d[1]), Math.max(s[2], d[2])],
  difference: (s, d) => [Math.abs(d[0] - s[0]), Math.abs(d[1] - s[1]), Math.abs(d[2] - s[2])],
  exclusion: (s, d) => [s[0] + d[0] - 2 * s[0] * d[0], s[1] + d[1] - 2 * s[1] * d[1], s[2] + d[2] - 2 * s[2] * d[2]],
  'color-dodge': (s, d) => s.map((sc, i) => Math.min(d[i] / Math.max(1 - sc, 0.0001), 1)) as V3,
  'color-burn': (s, d) => s.map((sc, i) => 1 - Math.min((1 - d[i]) / Math.max(sc, 0.0001), 1)) as V3,
}

export function compositePixelOver(
  destination: Uint8Array,
  destinationIndex: number,
  sourceR: number,
  sourceG: number,
  sourceB: number,
  sourceA: number,
  opacity: number,
  blendMode: string,
): void {
  const srcA = (sourceA / 255) * opacity
  if (srcA <= 0) return

  const dstA = destination[destinationIndex + 3] / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) return

  const s: V3 = [sourceR / 255, sourceG / 255, sourceB / 255]
  const d: V3 = dstA > 0.0001
    ? [
      destination[destinationIndex] / (dstA * 255),
      destination[destinationIndex + 1] / (dstA * 255),
      destination[destinationIndex + 2] / (dstA * 255),
    ]
    : [0, 0, 0]

  const blendFn = BLEND_FNS[blendMode] ?? BLEND_FNS.normal
  const bl = blendFn(s, d)
  destination[destinationIndex] = Math.round(Math.min(1, (bl[0] * srcA + d[0] * dstA * (1 - srcA)) / outA) * 255)
  destination[destinationIndex + 1] = Math.round(Math.min(1, (bl[1] * srcA + d[1] * dstA * (1 - srcA)) / outA) * 255)
  destination[destinationIndex + 2] = Math.round(Math.min(1, (bl[2] * srcA + d[2] * dstA * (1 - srcA)) / outA) * 255)
  destination[destinationIndex + 3] = Math.round(outA * 255)
}