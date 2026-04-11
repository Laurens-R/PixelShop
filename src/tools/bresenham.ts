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

/** Convenience: draw a filled line segment on a layer and flush. */
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
  bresenham(x0, y0, x1, y1, (x, y) => renderer.drawPixel(layer, x, y, r, g, b, a))
}

/** Convenience: erase a filled line segment on a layer and flush. */
export function eraseLine(
  renderer: WebGLRenderer,
  layer: WebGLLayer,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  bresenham(x0, y0, x1, y1, (x, y) => renderer.erasePixel(layer, x, y))
}
