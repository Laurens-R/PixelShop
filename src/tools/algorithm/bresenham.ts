import type { WebGLRenderer, WebGLLayer } from '@/webgl/WebGLRenderer'

/**
 * Bresenham's line algorithm — plots every integer pixel between (x0,y0) and
 * (x1,y1) inclusive, calling `plot` for each.
 */
export function bresenham(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number) => void
): void {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
  let err = dx + dy, x = x0, y = y0

  while (true) {
    plot(x, y)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
}

/** Convenience: draw a filled line segment on a layer and flush.
 * Coordinates are CANVAS-SPACE; translates to layer-local internally. */
export function drawLine(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  a: number
): void {
  bresenham(x0, y0, x1, y1, (x, y) => renderer.drawCanvasPixel(layer, x, y, r, g, b, a))
}

/**
 * Porter-Duff "over" composite with incremental coverage tracking.
 * canvasX/canvasY are CANVAS-SPACE coordinates. Translates to layer-local
 * internally. Silently ignores pixels outside the layer buffer.
 *
 * `touched` is a Map from canvas-pixel-key → max effective-alpha applied.
 * When provided:
 *   - Compute srcA = (a/255) * (opacity/100)
 *   - If srcA <= existing max: skip (pixel is already more fully covered)
 *   - Otherwise apply only the *incremental* alpha needed to go from
 *     existingA to srcA:  incA = (srcA - existingA) / (1 - existingA)
 *     This prevents accumulation while allowing coverage to be upgraded
 *     (fixes ring artifacts from overlapping AA capsule segments).
 */
function blendPixelOver(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  canvasX: number,
  canvasY: number,
  r: number,
  g: number,
  b: number,
  a: number,
  opacity: number, // 0-100, already includes geometric coverage for AA paths
  touched?: Map<number, number>,
): void {
  const lx = canvasX - layer.offsetX
  const ly = canvasY - layer.offsetY
  if (lx < 0 || lx >= layer.layerWidth || ly < 0 || ly >= layer.layerHeight) return
  const srcA = (a / 255) * (opacity / 100)
  if (srcA <= 0) return

  let blendA = srcA
  if (touched !== undefined) {
    // Key in canvas-space so it stays stable across layer growth within a stroke
    const key = canvasY * renderer.pixelWidth + canvasX
    const existingA = touched.get(key) ?? 0
    if (srcA <= existingA) return
    blendA = existingA < 1 ? (srcA - existingA) / (1 - existingA) : 0
    if (blendA <= 0) return
    touched.set(key, srcA)
  }

  const [er, eg, eb, ea] = renderer.samplePixel(layer, lx, ly)
  const dstA = ea / 255
  const outA = blendA + dstA * (1 - blendA)
  if (outA <= 0) {
    renderer.drawPixel(layer, lx, ly, 0, 0, 0, 0)
  } else {
    const dstBlend = dstA * (1 - blendA)
    renderer.drawPixel(
      layer, lx, ly,
      Math.round((r * blendA + er * dstBlend) / outA),
      Math.round((g * blendA + eg * dstBlend) / outA),
      Math.round((b * blendA + eb * dstBlend) / outA),
      Math.round(outA * 255),
    )
  }
}

/**
 * Stamps a hard-edged circular brush of radius `size/2` centered at (cx, cy).
 * Pixels whose center falls within the radius are fully painted; outside pixels
 * are skipped entirely. Behaves like the AA capsule path but without feathering.
 */
function stampCircle(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  cx: number,
  cy: number,
  size: number,
  r: number,
  g: number,
  b: number,
  a: number,
  opacity: number,
  touched?: Map<number, number>,
): void {
  const radius = size / 2
  const iRadius = Math.ceil(radius)
  for (let dy = -iRadius; dy <= iRadius; dy++) {
    for (let dx = -iRadius; dx <= iRadius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        blendPixelOver(renderer, layer, cx + dx, cy + dy, r, g, b, a, opacity, touched)
      }
    }
  }
}

/**
 * Anti-aliased thick segment using a capsule signed-distance field.
 * Iterates every pixel in the bounding box of the segment (expanded by radius),
 * computes each pixel's perpendicular distance to the segment, and derives a
 * smooth coverage value. Produces a clean pill/capsule shape with no repeating
 * stamp artifacts.
 */
function drawAAThickSegment(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  x0: number, y0: number,
  x1: number, y1: number,
  size: number,
  r: number, g: number, b: number, a: number,
  opacity: number,
  touched?: Map<number, number>,
): void {
  const radius = size / 2
  const pad = Math.ceil(radius) + 1
  const sdx = x1 - x0, sdy = y1 - y0
  const lenSq = sdx * sdx + sdy * sdy

  const minX = Math.floor(Math.min(x0, x1)) - pad
  const maxX = Math.ceil(Math.max(x0, x1)) + pad
  const minY = Math.floor(Math.min(y0, y1)) - pad
  const maxY = Math.ceil(Math.max(y0, y1)) + pad

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      let dist: number
      if (lenSq === 0) {
        // Degenerate segment: distance to the single point
        dist = Math.sqrt((px - x0) ** 2 + (py - y0) ** 2)
      } else {
        const t = Math.max(0, Math.min(1, ((px - x0) * sdx + (py - y0) * sdy) / lenSq))
        const nearX = x0 + t * sdx
        const nearY = y0 + t * sdy
        dist = Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2)
      }
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - dist))
      if (coverage > 0) {
        blendPixelOver(renderer, layer, px, py, r, g, b, a, opacity * coverage, touched)
      }
    }
  }
}

/**
 * Like drawLine but uses a square stamp brush of `size` pixels,
 * compositing at `opacity` (0-100) over existing pixel data.
 * Pass a `touched` Set to prevent any pixel being composited more than once
 * within a single stroke.
 * When `antiAlias` is true: 1-px lines use Wu's algorithm; thicker lines use
 * a circular stamp with soft edge coverage.
 */
export function drawThickLine(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  r: number,
  g: number,
  b: number,
  a: number,
  opacity = 100,
  touched?: Map<number, number>,
  antiAlias = false,
): void {
  if (antiAlias) {
    if (size <= 1) {
      wuLine(x0, y0, x1, y1, (x, y, coverage) =>
        blendPixelOver(renderer, layer, x, y, r, g, b, a, opacity * coverage, touched))
    } else {
      drawAAThickSegment(renderer, layer, x0, y0, x1, y1, size, r, g, b, a, opacity, touched)
    }
  } else {
    if (size <= 1) {
      bresenham(x0, y0, x1, y1, (x, y) =>
        blendPixelOver(renderer, layer, x, y, r, g, b, a, opacity, touched))
    } else {
      bresenham(x0, y0, x1, y1, (x, y) =>
        stampCircle(renderer, layer, x, y, size, r, g, b, a, opacity, touched))
    }
  }
}

/**
 * Xiaolin Wu's anti-aliased line algorithm.
 * Calls plot(x, y, coverage) where coverage ∈ (0, 1].
 */
function wuLine(
  x0: number, y0: number,
  x1: number, y1: number,
  plot: (x: number, y: number, coverage: number) => void,
): void {
  // Single point — plot once at full coverage
  if (x0 === x1 && y0 === y1) { plot(x0, y0, 1); return }

  const ipart = (n: number): number => Math.floor(n)
  const fpart = (n: number): number => n - Math.floor(n)
  const rfpart = (n: number): number => 1 - fpart(n)

  let [ax, ay, bx, by] = [x0, y0, x1, y1]
  const steep = Math.abs(by - ay) > Math.abs(bx - ax)
  if (steep) { [ax, ay, bx, by] = [ay, ax, by, bx] }
  if (ax > bx) { [ax, ay, bx, by] = [bx, by, ax, ay] }

  const dx = bx - ax
  const dy = by - ay
  const gradient = dy / dx

  // Emit a pixel, swapping x/y back when the line was transposed
  const emit = (px: number, py: number, c: number): void =>
    c > 0 ? (steep ? plot(py, px, c) : plot(px, py, c)) : undefined

  // First endpoint
  let xend = Math.round(ax)
  let yend = ay + gradient * (xend - ax)
  let xgap = rfpart(ax + 0.5)
  const xpxl1 = xend, ypxl1 = ipart(yend)
  emit(xpxl1, ypxl1, rfpart(yend) * xgap)
  emit(xpxl1, ypxl1 + 1, fpart(yend) * xgap)
  let intery = yend + gradient

  // Second endpoint
  xend = Math.round(bx)
  yend = by + gradient * (xend - bx)
  xgap = fpart(bx + 0.5)
  const xpxl2 = xend, ypxl2 = ipart(yend)
  emit(xpxl2, ypxl2, rfpart(yend) * xgap)
  emit(xpxl2, ypxl2 + 1, fpart(yend) * xgap)

  // Main loop — pixels between the two endpoints
  for (let x = xpxl1 + 1; x < xpxl2; x++) {
    emit(x, ipart(intery), rfpart(intery))
    emit(x, ipart(intery) + 1, fpart(intery))
    intery += gradient
  }
}

/**
 * Anti-aliased 1-pixel line using Xiaolin Wu's algorithm.
 * Composites at `opacity` (0-100) × per-pixel coverage over existing pixel data.
 * Pass a `touched` Set to prevent any pixel being composited more than once
 * within a single stroke.
 */
export function drawAALine(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  x0: number, y0: number,
  x1: number, y1: number,
  r: number, g: number, b: number, a: number,
  opacity = 100,
  touched?: Map<number, number>,
): void {
  wuLine(x0, y0, x1, y1, (x, y, coverage) => {
    blendPixelOver(renderer, layer, x, y, r, g, b, a, opacity * coverage, touched)
  })
}

/** Convenience: erase a filled line segment on a layer and flush.
 * Coordinates are CANVAS-SPACE; translates to layer-local internally. */
export function eraseLine(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  bresenham(x0, y0, x1, y1, (x, y) => {
    const lx = x - layer.offsetX
    const ly = y - layer.offsetY
    if (lx >= 0 && ly >= 0 && lx < layer.layerWidth && ly < layer.layerHeight) {
      renderer.erasePixel(layer, lx, ly)
    }
  })
}

// ─── Erase helpers ────────────────────────────────────────────────────────────

/**
 * Apply one erase pixel operation in canvas-space.
 *
 * alphaMode = false (default): blend RGB towards (secR,secG,secB), keep alpha.
 * alphaMode = true: reduce alpha by blendFactor, keep RGB values.
 *
 * `touched` tracks the max blendFactor already applied so the same pixel is
 * never over-erased within a single stroke.
 */
function erasePixelOp(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  canvasX: number,
  canvasY: number,
  secR: number,
  secG: number,
  secB: number,
  blendFactor: number, // 0-1  (coverage × strength/100)
  alphaMode: boolean,
  touched?: Map<number, number>,
): void {
  const lx = canvasX - layer.offsetX
  const ly = canvasY - layer.offsetY
  if (lx < 0 || lx >= layer.layerWidth || ly < 0 || ly >= layer.layerHeight) return
  if (blendFactor <= 0) return

  let incr = blendFactor
  if (touched !== undefined) {
    const key = canvasY * renderer.pixelWidth + canvasX
    const existing = touched.get(key) ?? 0
    if (blendFactor <= existing) return
    incr = existing < 1 ? (blendFactor - existing) / (1 - existing) : 0
    if (incr <= 0) return
    touched.set(key, blendFactor)
  }

  const [er, eg, eb, ea] = renderer.samplePixel(layer, lx, ly)

  if (alphaMode) {
    // Reduce alpha, keep RGB unchanged
    renderer.drawPixel(layer, lx, ly, er, eg, eb, Math.round(ea * (1 - incr)))
  } else {
    // Lerp RGB towards secondary color, preserve alpha
    renderer.drawPixel(
      layer, lx, ly,
      Math.round(er + (secR - er) * incr),
      Math.round(eg + (secG - eg) * incr),
      Math.round(eb + (secB - eb) * incr),
      ea,
    )
  }
}

function eraseStampCircle(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  cx: number,
  cy: number,
  size: number,
  secR: number,
  secG: number,
  secB: number,
  strength: number,
  alphaMode: boolean,
  touched?: Map<number, number>,
): void {
  const radius = size / 2
  const iRadius = Math.ceil(radius)
  const bf = strength / 100
  for (let dy = -iRadius; dy <= iRadius; dy++) {
    for (let dx = -iRadius; dx <= iRadius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        erasePixelOp(renderer, layer, cx + dx, cy + dy, secR, secG, secB, bf, alphaMode, touched)
      }
    }
  }
}

function eraseAASegment(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  x0: number, y0: number,
  x1: number, y1: number,
  size: number,
  secR: number,
  secG: number,
  secB: number,
  strength: number,
  alphaMode: boolean,
  touched?: Map<number, number>,
): void {
  const radius = size / 2
  const pad = Math.ceil(radius) + 1
  const sdx = x1 - x0, sdy = y1 - y0
  const lenSq = sdx * sdx + sdy * sdy
  const minX = Math.floor(Math.min(x0, x1)) - pad
  const maxX = Math.ceil(Math.max(x0, x1)) + pad
  const minY = Math.floor(Math.min(y0, y1)) - pad
  const maxY = Math.ceil(Math.max(y0, y1)) + pad

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      let dist: number
      if (lenSq === 0) {
        dist = Math.sqrt((px - x0) ** 2 + (py - y0) ** 2)
      } else {
        const t = Math.max(0, Math.min(1, ((px - x0) * sdx + (py - y0) * sdy) / lenSq))
        dist = Math.sqrt((px - x0 - t * sdx) ** 2 + (py - y0 - t * sdy) ** 2)
      }
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - dist))
      if (coverage > 0) {
        erasePixelOp(renderer, layer, px, py, secR, secG, secB, (strength / 100) * coverage, alphaMode, touched)
      }
    }
  }
}

/**
 * Erase a thick line segment on a layer (canvas-space coords).
 *
 * alphaMode = false: blend RGB towards (secR,secG,secB), keep alpha.
 * alphaMode = true:  reduce alpha; RGB values unchanged.
 * strength: 0-100 (100 = full erase).
 * antiAlias: use capsule SDF / Wu line for soft edges.
 */
export function eraseThickLine(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  secR: number,
  secG: number,
  secB: number,
  strength = 100,
  alphaMode = false,
  antiAlias = false,
  touched?: Map<number, number>,
): void {
  const bf = strength / 100
  if (antiAlias) {
    if (size <= 1) {
      wuLine(x0, y0, x1, y1, (x, y, coverage) => {
        erasePixelOp(renderer, layer, x, y, secR, secG, secB, bf * coverage, alphaMode, touched)
      })
    } else {
      eraseAASegment(renderer, layer, x0, y0, x1, y1, size, secR, secG, secB, strength, alphaMode, touched)
    }
  } else {
    if (size <= 1) {
      bresenham(x0, y0, x1, y1, (x, y) => {
        erasePixelOp(renderer, layer, x, y, secR, secG, secB, bf, alphaMode, touched)
      })
    } else {
      bresenham(x0, y0, x1, y1, (cx, cy) => {
        eraseStampCircle(renderer, layer, cx, cy, size, secR, secG, secB, strength, alphaMode, touched)
      })
    }
  }
}
