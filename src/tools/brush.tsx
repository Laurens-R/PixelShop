import React, { useState } from 'react'
import { drawAirbrushCapsule } from './algorithm/bresenham'
import type { BrushShape } from './algorithm/bresenham'
import { SliderInput } from '@/components/widgets/SliderInput/SliderInput'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

// ─── Shared options ───────────────────────────────────────────────────────────
// Module-level so the handler reads them synchronously inside pointer events.

export const brushOptions = {
  size:             20,
  opacity:          80,
  hardness:         50,
  shape:            'round' as BrushShape,
  antiAlias:        true,
  velocityTracking: false,
}

// ── Velocity dynamics ─────────────────────────────────────────────────────────
// Speed reference (px / ms). At this speed, size and opacity hit their floors.
const MAX_TRACKING_SPEED  = 5
// At MAX_TRACKING_SPEED the brush narrows to this fraction of the set size.
const MIN_SIZE_FACTOR     = 0.35
// At MAX_TRACKING_SPEED, opacity is multiplied by this factor.
const MIN_OPACITY_FACTOR  = 0.65
// EMA weight for new speed samples (higher = snappier response, more jitter).
const SPEED_SMOOTHING     = 0.25

// ─── Handler ──────────────────────────────────────────────────────────────────

function createBrushHandler(): ToolHandler {
  let lastPos: { x: number; y: number; time: number } | null = null
  let touched: Map<number, number> | null = null
  let smoothSpeed = 0

  function stamp(
    x0: number, y0: number,
    x1: number, y1: number,
    effectiveSize: number,
    effectiveOpacity: number,
    ctx: ToolContext,
  ): void {
    const { renderer, layer, layers, primaryColor, selectionMask, render, growLayerToFit } = ctx
    const { r, g, b, a } = primaryColor
    const radius = effectiveSize / 2

    growLayerToFit(x0, y0, Math.ceil(radius) + 2)
    if (x1 !== x0 || y1 !== y0) growLayerToFit(x1, y1, Math.ceil(radius) + 2)

    const sel = selectionMask ? { mask: selectionMask, width: renderer.pixelWidth } : undefined

    drawAirbrushCapsule(
      renderer, layer,
      x0, y0, x1, y1,
      effectiveSize,
      r, g, b, a,
      effectiveOpacity,
      brushOptions.hardness,
      brushOptions.shape,
      brushOptions.antiAlias,
      touched ?? undefined,
      sel,
    )

    renderer.flushLayer(layer)
    render(layers)
  }

  /** Returns effective { size, opacity } modulated by stroke speed dynamics. */
  function resolveStrokeParams(speed: number): { size: number; opacity: number } {
    if (!brushOptions.velocityTracking || speed <= 0) {
      return { size: brushOptions.size, opacity: brushOptions.opacity }
    }
    const t = Math.min(1, speed / MAX_TRACKING_SPEED)
    return {
      // Fast → thinner; slow → full size
      size:    brushOptions.size    * Math.max(MIN_SIZE_FACTOR,    1 - t * (1 - MIN_SIZE_FACTOR)),
      // Fast → lighter; slow → full opacity
      opacity: brushOptions.opacity * Math.max(MIN_OPACITY_FACTOR, 1 - t * (1 - MIN_OPACITY_FACTOR)),
    }
  }

  return {
    onPointerDown({ x, y }: ToolPointerPos, ctx: ToolContext) {
      touched = new Map()
      smoothSpeed = 0
      lastPos = { x, y, time: performance.now() }
      stamp(x, y, x, y, brushOptions.size, brushOptions.opacity, ctx)
    },

    onPointerMove({ x, y }: ToolPointerPos, ctx: ToolContext) {
      if (!lastPos) return
      const now = performance.now()
      const dt  = now - lastPos.time
      const d   = Math.hypot(x - lastPos.x, y - lastPos.y)
      const rawSpeed = dt > 0 ? d / dt : 0
      // Exponential moving average keeps dynamics smooth even at irregular event rates
      smoothSpeed = smoothSpeed * (1 - SPEED_SMOOTHING) + rawSpeed * SPEED_SMOOTHING
      const { size: effectiveSize, opacity: effectiveOpacity } = resolveStrokeParams(smoothSpeed)
      stamp(lastPos.x, lastPos.y, x, y, effectiveSize, effectiveOpacity, ctx)
      lastPos = { x, y, time: now }
    },

    onPointerUp() {
      lastPos = null
      touched = null
      smoothSpeed = 0
    },
  }
}

// ─── Options UI ────────────────────────────────────────────────────────────────

const SHAPE_LABELS: { value: BrushShape; label: string }[] = [
  { value: 'round',   label: 'Round'   },
  { value: 'square',  label: 'Square'  },
  { value: 'diamond', label: 'Diamond' },
]

function BrushOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [size,             setSize]             = useState(brushOptions.size)
  const [opacity,          setOpacity]          = useState(brushOptions.opacity)
  const [hardness,         setHardness]         = useState(brushOptions.hardness)
  const [shape,            setShape]            = useState<BrushShape>(brushOptions.shape)
  const [antiAlias,        setAntiAlias]        = useState(brushOptions.antiAlias)
  const [velocityTracking, setVelocityTracking] = useState(brushOptions.velocityTracking)

  const handleSize     = (v: number): void => { brushOptions.size     = v; setSize(v) }
  const handleOpacity  = (v: number): void => { brushOptions.opacity  = v; setOpacity(v) }
  const handleHardness = (v: number): void => { brushOptions.hardness = v; setHardness(v) }

  const handleShape = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value as BrushShape
    brushOptions.shape = v
    setShape(v)
  }
  const handleAntiAlias = (e: React.ChangeEvent<HTMLInputElement>): void => {
    brushOptions.antiAlias = e.target.checked
    setAntiAlias(e.target.checked)
  }
  const handleVelocity = (e: React.ChangeEvent<HTMLInputElement>): void => {
    brushOptions.velocityTracking = e.target.checked
    setVelocityTracking(e.target.checked)
  }

  return (
    <>
      <label className={styles.optLabel}>Size:</label>
      <SliderInput value={size} min={1} max={300} inputWidth={42} onChange={handleSize} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Opacity:</label>
      <SliderInput value={opacity} min={1} max={100} suffix="%" inputWidth={42} onChange={handleOpacity} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Hardness:</label>
      <SliderInput value={hardness} min={0} max={100} suffix="%" inputWidth={42} onChange={handleHardness} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Shape:</label>
      <select className={styles.optSelect} value={shape} onChange={handleShape}>
        {SHAPE_LABELS.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <span className={styles.optSep} />
      <label
        className={styles.optCheckLabel}
        title="Sub-pixel edge feathering for smoother strokes"
      >
        <input type="checkbox" checked={antiAlias} onChange={handleAntiAlias} />
        Anti-alias
      </label>
      <span className={styles.optSep} />
      <label
        className={styles.optCheckLabel}
        title="Fast strokes produce a thinner, lighter line — simulates drawing pressure dynamics"
      >
        <input type="checkbox" checked={velocityTracking} onChange={handleVelocity} />
        Velocity
      </label>
    </>
  )
}

export const brushTool: ToolDefinition = {
  createHandler: createBrushHandler,
  Options: BrushOptions,
  modifiesPixels: true,
}

