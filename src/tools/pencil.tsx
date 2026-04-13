import React, { useState } from 'react'
import { walkQuadBezier, stampAirbrush } from './algorithm/bresenham'
import { SliderInput } from '@/components/widgets/SliderInput/SliderInput'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

// ─── Shared options ───────────────────────────────────────────────────────────

export const pencilOptions = {
  size:       1,
  opacity:    100,
  antiAlias:  true,
  smoothing:  20,   // 0 = raw coords, 100 = maximum stabilizer
  motionBlur: 5,    // 0 = round dabs, 100 = dabs elongated along stroke direction
}

/** EMA alpha: fraction of the new sample mixed in each event. */
function smoothingToAlpha(s: number): number {
  return Math.max(0.05, 1 - s / 100 * 0.92)
}

// ─── Handler ──────────────────────────────────────────────────────────────────

type Point = { x: number; y: number }

function createPencilHandler(): ToolHandler {
  let lastRendered: Point | null = null
  let lastCtrl:     Point | null = null
  let touched: Map<number, number> | null = null
  let stabX = 0, stabY = 0

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
      'round',
      pencilOptions.antiAlias,
      pencilOptions.motionBlur / 100,
      touched ?? undefined, sel,
    )
    renderer.flushLayer(layer)
    render(layers)
  }

  return {
    onPointerDown({ x, y }: ToolPointerPos, ctx: ToolContext) {
      touched      = new Map()
      stabX = x; stabY = y
      lastRendered = { x, y }
      lastCtrl     = { x, y }
      // Initial dot
      const { renderer, layer, layers, primaryColor, selectionMask, render, growLayerToFit } = ctx
      const { r, g, b, a } = primaryColor
      const padR = Math.ceil(pencilOptions.size / 2) + 2
      growLayerToFit(x, y, padR)
      const sel = selectionMask ? { mask: selectionMask, width: renderer.pixelWidth } : undefined
      stampAirbrush(
        renderer, layer, x, y,
        pencilOptions.size, r, g, b, a, pencilOptions.opacity,
        100, 'round', pencilOptions.antiAlias,
        touched ?? undefined, sel,
      )
      renderer.flushLayer(layer)
      render(layers)
    },

    onPointerMove({ x, y }: ToolPointerPos, ctx: ToolContext) {
      if (!lastRendered || !lastCtrl) return

      const alpha = smoothingToAlpha(pencilOptions.smoothing)
      stabX = stabX * (1 - alpha) + x * alpha
      stabY = stabY * (1 - alpha) + y * alpha

      const spacing = Math.max(1, pencilOptions.size * 0.2)
      const tipX = (lastCtrl.x + stabX) * 0.5
      const tipY = (lastCtrl.y + stabY) * 0.5

      if (Math.hypot(tipX - lastRendered.x, tipY - lastRendered.y) >= spacing) {
        paint(
          lastRendered.x, lastRendered.y,
          lastCtrl.x, lastCtrl.y,
          tipX, tipY,
          ctx,
        )
        lastRendered = { x: tipX, y: tipY }
      }
      lastCtrl = { x: stabX, y: stabY }
    },

    onPointerUp(_pos: ToolPointerPos, ctx: ToolContext) {
      if (lastRendered && lastCtrl) {
        if (Math.hypot(lastCtrl.x - lastRendered.x, lastCtrl.y - lastRendered.y) >= 1) {
          paint(
            lastRendered.x, lastRendered.y,
            lastCtrl.x, lastCtrl.y,
            lastCtrl.x, lastCtrl.y,
            ctx,
          )
        }
      }
      lastRendered = null
      lastCtrl     = null
      touched      = null
    },
  }
}

// ─── Options UI ────────────────────────────────────────────────────────────────

function PencilOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [size,       setSize]       = useState(pencilOptions.size)
  const [opacity,    setOpacity]    = useState(pencilOptions.opacity)
  const [antiAlias,  setAA]         = useState(pencilOptions.antiAlias)
  const [smoothing,  setSmoothing]  = useState(pencilOptions.smoothing)
  const [motionBlur, setMotionBlur] = useState(pencilOptions.motionBlur)

  const handleSize       = (v: number): void => { pencilOptions.size       = v; setSize(v) }
  const handleOpacity    = (v: number): void => { pencilOptions.opacity    = v; setOpacity(v) }
  const handleSmoothing  = (v: number): void => { pencilOptions.smoothing  = v; setSmoothing(v) }
  const handleMotionBlur = (v: number): void => { pencilOptions.motionBlur = v; setMotionBlur(v) }
  const handleAA = (v: boolean): void => { pencilOptions.antiAlias = v; setAA(v) }

  return (
    <>
      <label className={styles.optLabel}>Size:</label>
      <SliderInput value={size} min={1} max={100} inputWidth={42} onChange={handleSize} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Opacity:</label>
      <SliderInput value={opacity} min={1} max={100} suffix="%" inputWidth={42} onChange={handleOpacity} />
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
