import React, { useState } from 'react'
import { bresenham, blendPixelOver, walkQuadBezier, stampAirbrush } from './algorithm/bresenham'
import type { BrushShape } from './algorithm/bresenham'
import { SliderInput } from '@/ux/widgets/SliderInput/SliderInput'
import { useAppContext } from '@/core/store/AppContext'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

// ─── Shared options ───────────────────────────────────────────────────────────

export const pencilOptions = {
  size:         1,
  opacity:      100,
  shape:        'round' as BrushShape,
  pixelPerfect: false,  // Aseprite-style: remove L-corner pixels for clean diagonals
  antiAlias:    true,
  smoothing:    20,     // 0 = raw coords, 100 = maximum stabilizer (size > 1 only)
  motionBlur:   5,      // 0 = round dabs, 100 = dabs elongated along stroke direction (size > 1)
}

/** EMA alpha: fraction of the new sample mixed in each event (used for size > 1 path). */
function smoothingToAlpha(s: number): number {
  return Math.max(0.05, 1 - s / 100 * 0.92)
}

// ─── Pixel-perfect helpers ────────────────────────────────────────────────────

type Point = { x: number; y: number }

/**
 * Returns true if B is a redundant L-corner pixel between A and C.
 * An L-corner occurs when A→B is axis-aligned and B→C is also axis-aligned
 * but in the perpendicular direction — removing B still leaves A and C connected
 * diagonally, so B is unnecessary and creates a notch in the diagonal stroke.
 */
function isLCorner(a: Point, b: Point, c: Point): boolean {
  return (b.x === a.x && b.y === c.y) || (b.y === a.y && b.x === c.x)
}

// ─── Color shade helpers (for options UI) ─────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  switch (max) {
    case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break
    case gn: h = (bn - rn) / d + 2; break
    case bn: h = (rn - gn) / d + 4; break
  }
  return [h / 6, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (p2: number, q2: number, t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t
    if (t < 1 / 2) return q2
    if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6
    return p2
  }
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

/** Generate 5 lightness variants of (r,g,b,a): 2 darker, base, 2 lighter. */
function getColorShades(
  r: number, g: number, b: number, a: number,
): Array<{ r: number; g: number; b: number; a: number }> {
  const [h, s, l] = rgbToHsl(r, g, b)
  return [-0.28, -0.14, 0, 0.14, 0.28].map(offset => {
    const nl = Math.max(0, Math.min(1, l + offset))
    const [nr, ng, nb] = hslToRgb(h, s, nl)
    return { r: nr, g: ng, b: nb, a }
  })
}

// ─── Handler ──────────────────────────────────────────────────────────────────

function createPencilHandler(): ToolHandler {
  // ── State for size > 1 bezier path ──
  let lastRendered: Point | null = null
  let lastCtrl:     Point | null = null
  let stabX = 0, stabY = 0

  // ── State for 1px Bresenham path ──
  // lastPx:    last Bresenham pixel emitted (end of previous segment)
  // ppPrev:    pixel before ppPending (L-shape left context)
  // ppPending: buffered pixel not yet drawn (waiting for next pixel as right context)
  let lastPx:    Point | null = null
  let ppPrev:    Point | null = null
  let ppPending: Point | null = null

  let touched: Map<number, number> | null = null

  // ── 1px helpers ────────────────────────────────────────────────────────────

  function paintOnePixel(px: number, py: number, ctx: ToolContext): void {
    const { renderer, layer, primaryColor, selectionMask, growLayerToFit } = ctx
    const { r, g, b, a } = primaryColor
    growLayerToFit(px, py, 2)
    const sel = selectionMask ? { mask: selectionMask, width: renderer.pixelWidth } : undefined
    blendPixelOver(renderer, layer, px, py, r, g, b, a, pencilOptions.opacity, touched ?? undefined, sel)
  }

  /**
   * Feed a new pixel into the pixel-perfect state machine.
   * Draws ppPending only after seeing the next pixel so L-corners can be skipped.
   */
  function addPPPixel(pt: Point, ctx: ToolContext): void {
    if (ppPending !== null) {
      if (ppPrev !== null && isLCorner(ppPrev, ppPending, pt)) {
        // ppPending is a redundant L-corner — discard it; ppPrev stays
      } else {
        paintOnePixel(ppPending.x, ppPending.y, ctx)
        ppPrev = ppPending
      }
      ppPending = null
    }
    ppPending = pt
  }

  /** Flush the buffered pending pixel at end of stroke. */
  function flushPPPending(ctx: ToolContext): void {
    if (ppPending !== null) {
      paintOnePixel(ppPending.x, ppPending.y, ctx)
      ppPending = null
    }
    ppPrev = null
  }

  /**
   * Draw from lastPx to (tx, ty) using Bresenham, with optional pixel-perfect
   * L-corner removal. Updates lastPx to the new endpoint.
   */
  function draw1pxSegment(tx: number, ty: number, ctx: ToolContext): void {
    if (!lastPx) return
    const x1 = Math.round(tx), y1 = Math.round(ty)
    if (lastPx.x === x1 && lastPx.y === y1) return

    const pixels: Point[] = []
    bresenham(lastPx.x, lastPx.y, x1, y1, (x, y) => pixels.push({ x, y }))

    // Skip pixel[0] — it equals lastPx and was already painted
    for (let i = 1; i < pixels.length; i++) {
      if (pencilOptions.pixelPerfect) {
        addPPPixel(pixels[i], ctx)
      } else {
        paintOnePixel(pixels[i].x, pixels[i].y, ctx)
      }
    }
    lastPx = { x: x1, y: y1 }
  }

  // ── Size > 1 bezier path ────────────────────────────────────────────────────

  function paint(
    p0x: number, p0y: number,
    cpx: number, cpy: number,
    p1x: number, p1y: number,
    ctx: ToolContext,
  ): void {
    const { renderer, layer, layers, primaryColor, selectionMask, render, growLayerToFit } = ctx
    const { r, g, b, a } = primaryColor
    const padR = Math.ceil(pencilOptions.size / 2) + 2
    growLayerToFit(Math.round(p0x), Math.round(p0y), padR)
    growLayerToFit(Math.round(cpx),  Math.round(cpy),  padR)
    growLayerToFit(Math.round(p1x), Math.round(p1y), padR)
    const sel = selectionMask ? { mask: selectionMask, width: renderer.pixelWidth } : undefined
    walkQuadBezier(
      renderer, layer,
      p0x, p0y, cpx, cpy, p1x, p1y,
      pencilOptions.size, r, g, b, a, pencilOptions.opacity,
      100, // hardness always 100 for pencil
      pencilOptions.shape,
      pencilOptions.antiAlias,
      pencilOptions.motionBlur / 100,
      touched ?? undefined, sel,
    )
    renderer.flushLayer(layer)
    render(layers)
  }

  // ── ToolHandler ─────────────────────────────────────────────────────────────

  return {
    onPointerDown({ x, y }: ToolPointerPos, ctx: ToolContext) {
      touched = new Map()

      if (pencilOptions.size === 1) {
        // 1px path — direct Bresenham, no smoothing
        lastRendered = null; lastCtrl = null
        const px = Math.round(x), py = Math.round(y)
        paintOnePixel(px, py, ctx)
        lastPx    = { x: px, y: py }
        ppPrev    = { x: px, y: py }
        ppPending = null
        const { renderer, layer, layers, render } = ctx
        renderer.flushLayer(layer)
        render(layers)
      } else {
        // Bezier/dab path
        lastPx = null; ppPrev = null; ppPending = null
        stabX = x; stabY = y
        lastRendered = { x, y }
        lastCtrl     = { x, y }
        const { renderer, layer, layers, primaryColor, selectionMask, render, growLayerToFit } = ctx
        const { r, g, b, a } = primaryColor
        const padR = Math.ceil(pencilOptions.size / 2) + 2
        growLayerToFit(x, y, padR)
        const sel = selectionMask ? { mask: selectionMask, width: renderer.pixelWidth } : undefined
        stampAirbrush(
          renderer, layer, x, y,
          pencilOptions.size, r, g, b, a, pencilOptions.opacity,
          100, pencilOptions.shape, pencilOptions.antiAlias,
          touched ?? undefined, sel,
        )
        renderer.flushLayer(layer)
        render(layers)
      }
    },

    onPointerMove({ x, y }: ToolPointerPos, ctx: ToolContext) {
      if (pencilOptions.size === 1) {
        if (!lastPx) return
        draw1pxSegment(x, y, ctx)
        const { renderer, layer, layers, render } = ctx
        renderer.flushLayer(layer)
        render(layers)
      } else {
        if (!lastRendered || !lastCtrl) return
        const alpha = smoothingToAlpha(pencilOptions.smoothing)
        stabX = stabX * (1 - alpha) + x * alpha
        stabY = stabY * (1 - alpha) + y * alpha

        const spacing = Math.max(1, pencilOptions.size * 0.2)
        const tipX = (lastCtrl.x + stabX) * 0.5
        const tipY = (lastCtrl.y + stabY) * 0.5

        if (Math.hypot(tipX - lastRendered.x, tipY - lastRendered.y) >= spacing) {
          paint(lastRendered.x, lastRendered.y, lastCtrl.x, lastCtrl.y, tipX, tipY, ctx)
          lastRendered = { x: tipX, y: tipY }
        }
        lastCtrl = { x: stabX, y: stabY }
      }
    },

    onPointerUp(_pos: ToolPointerPos, ctx: ToolContext) {
      if (pencilOptions.size === 1) {
        flushPPPending(ctx)
        const { renderer, layer, layers, render } = ctx
        renderer.flushLayer(layer)
        render(layers)
      } else {
        if (lastRendered && lastCtrl) {
          if (Math.hypot(lastCtrl.x - lastRendered.x, lastCtrl.y - lastRendered.y) >= 1) {
            paint(lastRendered.x, lastRendered.y, lastCtrl.x, lastCtrl.y, lastCtrl.x, lastCtrl.y, ctx)
          }
        }
      }
      lastRendered = null; lastCtrl = null
      lastPx = null; ppPrev = null; ppPending = null
      touched = null
    },
  }
}

// ─── Options UI ────────────────────────────────────────────────────────────────

function PencilOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const { primaryColor } = state

  const [size,         setSize]        = useState(pencilOptions.size)
  const [opacity,      setOpacity]     = useState(pencilOptions.opacity)
  const [shape,        setShape]       = useState<BrushShape>(pencilOptions.shape)
  const [pixelPerfect, setPixelPerfect] = useState(pencilOptions.pixelPerfect)
  const [antiAlias,    setAA]          = useState(pencilOptions.antiAlias)
  const [smoothing,    setSmoothing]   = useState(pencilOptions.smoothing)
  const [motionBlur,   setMotionBlur]  = useState(pencilOptions.motionBlur)

  const handleSize        = (v: number): void => { pencilOptions.size        = v; setSize(v) }
  const handleOpacity     = (v: number): void => { pencilOptions.opacity     = v; setOpacity(v) }
  const handleSmoothing   = (v: number): void => { pencilOptions.smoothing   = v; setSmoothing(v) }
  const handleMotionBlur  = (v: number): void => { pencilOptions.motionBlur  = v; setMotionBlur(v) }
  const handleAA          = (v: boolean): void => { pencilOptions.antiAlias  = v; setAA(v) }
  const handleShape = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value as BrushShape
    pencilOptions.shape = v
    setShape(v)
  }
  const handlePixelPerfect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    pencilOptions.pixelPerfect = e.target.checked
    setPixelPerfect(e.target.checked)
  }

  const shades = getColorShades(primaryColor.r, primaryColor.g, primaryColor.b, primaryColor.a)

  return (
    <>
      <label className={styles.optLabel}>Size:</label>
      <SliderInput value={size} min={1} max={100} inputWidth={42} onChange={handleSize} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Opacity:</label>
      <SliderInput value={opacity} min={1} max={100} suffix="%" inputWidth={42} onChange={handleOpacity} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Shape:</label>
      <select className={styles.optSelect} value={shape} onChange={handleShape} style={{ width: 70 }}>
        <option value="round">Round</option>
        <option value="square">Square</option>
      </select>
      <span className={styles.optSep} />
      {/* 5 shades of the current primary color */}
      {shades.map((shade, i) => (
        <button
          key={i}
          title={i === 2 ? 'Current color' : i < 2 ? 'Darker shade' : 'Lighter shade'}
          style={{
            width: 14,
            height: 14,
            background: `rgb(${shade.r},${shade.g},${shade.b})`,
            border: i === 2
              ? '2px solid rgba(255,255,255,0.85)'
              : '1px solid rgba(255,255,255,0.25)',
            borderRadius: 2,
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
            outline: 'none',
            boxShadow: i === 2 ? '0 0 0 1px rgba(0,0,0,0.5)' : undefined,
          }}
          onClick={() => dispatch({ type: 'SET_PRIMARY_COLOR', payload: shade })}
        />
      ))}
      <span className={styles.optSep} />
      <label className={styles.optCheckLabel} title="Remove L-corner pixels for clean pixel-art diagonals (1px only)">
        <input
          type="checkbox"
          checked={pixelPerfect}
          onChange={handlePixelPerfect}
        />
        Pixel perfect
      </label>
      <span className={styles.optSep} />
      <label className={styles.optLabel} title="Filter pointer noise — higher values smooth the path at the cost of slight lag">Smoothing:</label>
      <SliderInput value={smoothing} min={0} max={100} suffix="%" inputWidth={42} onChange={handleSmoothing} />
      <span className={styles.optSep} />
      <label className={styles.optLabel} title="Elongates dabs along the stroke direction for a calligraphic smear">Motion:</label>
      <SliderInput value={motionBlur} min={0} max={100} suffix="%" inputWidth={42} onChange={handleMotionBlur} />
      <span className={styles.optSep} />
      <label className={styles.optCheckLabel}>
        <input
          type="checkbox"
          checked={antiAlias}
          onChange={(e) => handleAA(e.target.checked)}
        />
        Anti-alias
      </label>
    </>
  )
}

export const pencilTool: ToolDefinition = {
  createHandler: createPencilHandler,
  Options: PencilOptions,
  modifiesPixels: true,
  paintsOntoPixelLayer: true,
}

// Expose for potential reuse by other tools
export { createPencilHandler }
