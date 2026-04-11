import React from 'react'
import { drawLine } from './bresenham'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

function createPencilHandler(): ToolHandler {
  let lastPos: { x: number; y: number } | null = null

  return {
    onPointerDown({ x, y }: ToolPointerPos, { renderer, layer, layers, primaryColor, render }: ToolContext) {
      lastPos = null
      const { r, g, b, a } = primaryColor
      drawLine(renderer, layer, x, y, x, y, r, g, b, a)
      renderer.flushLayer(layer)
      render(layers)
      lastPos = { x, y }
    },

    onPointerMove({ x, y }: ToolPointerPos, { renderer, layer, layers, primaryColor, render }: ToolContext) {
      if (!lastPos) return
      const { r, g, b, a } = primaryColor
      drawLine(renderer, layer, lastPos.x, lastPos.y, x, y, r, g, b, a)
      renderer.flushLayer(layer)
      render(layers)
      lastPos = { x, y }
    },

    onPointerUp() {
      lastPos = null
    },
  }
}

function PencilOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  return (
    <>
      <label className={styles.optLabel}>Size:</label>
      <input className={styles.optInput} type="number" defaultValue={1} min={1} max={100} style={{ width: 42 }} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Opacity:</label>
      <input className={styles.optInput} type="number" defaultValue={100} min={1} max={100} style={{ width: 42 }} />
      <span className={styles.optText}>%</span>
    </>
  )
}

export const pencilTool: ToolDefinition = {
  createHandler: createPencilHandler,
  Options: PencilOptions,
}

// Expose for reuse by brush (shares the same drawing engine for now)
export { createPencilHandler }
