import React, { useState } from 'react'
import { drawThickLine } from './algorithm/bresenham'
import { SliderInput } from '@/components/widgets/SliderInput/SliderInput'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

// ─── Shared options ───────────────────────────────────────────────────────────
// Module-level object so both createPencilHandler and PencilOptions share state
// without needing React context or prop drilling.

const pencilOptions = { size: 1, opacity: 100, antiAlias: false }

// ─── Handler ──────────────────────────────────────────────────────────────────

function createPencilHandler(): ToolHandler {
  let lastPos: { x: number; y: number } | null = null
  let touched: Map<number, number> | null = null

  function stamp(
    x0: number, y0: number, x1: number, y1: number,
    ctx: ToolContext
  ): void {
    const { renderer, layer, layers, primaryColor, selectionMask, render, growLayerToFit } = ctx
    const { r, g, b, a } = primaryColor
    const radius = pencilOptions.size / 2
    // Grow the layer to cover both endpoints (plus brush radius)
    growLayerToFit(x0, y0, Math.ceil(radius))
    if (x1 !== x0 || y1 !== y0) growLayerToFit(x1, y1, Math.ceil(radius))
    const sel = selectionMask ? { mask: selectionMask, width: renderer.pixelWidth } : undefined
    drawThickLine(renderer, layer, x0, y0, x1, y1, pencilOptions.size, r, g, b, a, pencilOptions.opacity, touched ?? undefined, pencilOptions.antiAlias, sel)
    renderer.flushLayer(layer)
    render(layers)
  }

  return {
    onPointerDown({ x, y }: ToolPointerPos, ctx: ToolContext) {
      touched = new Map()
      lastPos = null
      stamp(x, y, x, y, ctx)
      lastPos = { x, y }
    },

    onPointerMove({ x, y }: ToolPointerPos, ctx: ToolContext) {
      if (!lastPos) return
      stamp(lastPos.x, lastPos.y, x, y, ctx)
      lastPos = { x, y }
    },

    onPointerUp() {
      lastPos = null
      touched = null
    },
  }
}

// ─── Options UI ────────────────────────────────────────────────────────────────

function PencilOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [size, setSize]         = useState(pencilOptions.size)
  const [opacity, setOpacity]   = useState(pencilOptions.opacity)
  const [antiAlias, setAA]      = useState(pencilOptions.antiAlias)

  const handleSize = (v: number): void => {
    pencilOptions.size = v
    setSize(v)
  }

  const handleOpacity = (v: number): void => {
    pencilOptions.opacity = v
    setOpacity(v)
  }

  const handleAA = (v: boolean): void => {
    pencilOptions.antiAlias = v
    setAA(v)
  }

  return (
    <>
      <label className={styles.optLabel}>Size:</label>
      <SliderInput value={size} min={1} max={100} inputWidth={42} onChange={handleSize} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Opacity:</label>
      <SliderInput value={opacity} min={1} max={100} suffix="%" inputWidth={42} onChange={handleOpacity} />
      <span className={styles.optSep} />
      <label className={styles.optCheckLabel} title="Anti-alias applies to 1px size only">
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
}

// Expose for reuse by brush (shares the same drawing engine for now)
export { createPencilHandler, pencilOptions }
