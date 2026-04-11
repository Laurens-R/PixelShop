import React, { useState } from 'react'
import { drawLine } from './bresenham'
import { SliderInput } from '@/components/SliderInput/SliderInput'
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
  const [size, setSize] = useState(1)
  const [opacity, setOpacity] = useState(100)
  return (
    <>
      <label className={styles.optLabel}>Size:</label>
      <SliderInput value={size} min={1} max={100} inputWidth={42} onChange={setSize} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Opacity:</label>
      <SliderInput value={opacity} min={1} max={100} suffix="%" inputWidth={42} onChange={setOpacity} />
    </>
  )
}

export const pencilTool: ToolDefinition = {
  createHandler: createPencilHandler,
  Options: PencilOptions,
}

// Expose for reuse by brush (shares the same drawing engine for now)
export { createPencilHandler }
