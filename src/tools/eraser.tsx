import React, { useState } from 'react'
import { eraseLine } from './algorithm/bresenham'
import { SliderInput } from '@/components/SliderInput/SliderInput'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

function createEraserHandler(): ToolHandler {
  let lastPos: { x: number; y: number } | null = null

  return {
    onPointerDown({ x, y }: ToolPointerPos, { renderer, layer, layers, render }: ToolContext) {
      lastPos = null
      eraseLine(renderer, layer, x, y, x, y)
      renderer.flushLayer(layer)
      render(layers)
      lastPos = { x, y }
    },

    onPointerMove({ x, y }: ToolPointerPos, { renderer, layer, layers, render }: ToolContext) {
      if (!lastPos) return
      eraseLine(renderer, layer, lastPos.x, lastPos.y, x, y)
      renderer.flushLayer(layer)
      render(layers)
      lastPos = { x, y }
    },

    onPointerUp() {
      lastPos = null
    },
  }
}

function EraserOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [size, setSize] = useState(8)
  return (
    <>
      <label className={styles.optLabel}>Size:</label>
      <SliderInput value={size} min={1} max={200} inputWidth={42} onChange={setSize} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Mode:</label>
      <select className={styles.optSelect}>
        <option>Pencil</option>
        <option>Block</option>
      </select>
    </>
  )
}

export const eraserTool: ToolDefinition = {
  createHandler: createEraserHandler,
  Options: EraserOptions,
}
