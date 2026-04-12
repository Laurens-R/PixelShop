import React, { useState } from 'react'
import { createPencilHandler } from './pencil'
import { SliderInput } from '@/components/widgets/SliderInput/SliderInput'
import type { ToolDefinition, ToolOptionsStyles } from './types'

// Brush shares pencil's Bresenham engine for now.
// Diverge here when soft/anti-aliased strokes are implemented.

function BrushOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [size, setSize] = useState(5)
  const [opacity, setOpacity] = useState(100)
  const [hardness, setHardness] = useState(100)
  return (
    <>
      <label className={styles.optLabel}>Size:</label>
      <SliderInput value={size} min={1} max={200} inputWidth={42} onChange={setSize} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Opacity:</label>
      <SliderInput value={opacity} min={1} max={100} suffix="%" inputWidth={42} onChange={setOpacity} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Hardness:</label>
      <SliderInput value={hardness} min={0} max={100} suffix="%" inputWidth={42} onChange={setHardness} />
    </>
  )
}

export const brushTool: ToolDefinition = {
  createHandler: createPencilHandler,
  Options: BrushOptions,
  modifiesPixels: true,
}
