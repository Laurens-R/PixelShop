import React from 'react'
import { createPencilHandler } from './pencil'
import type { ToolDefinition, ToolOptionsStyles } from './types'

// Brush shares pencil's Bresenham engine for now.
// Diverge here when soft/anti-aliased strokes are implemented.

function BrushOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  return (
    <>
      <label className={styles.optLabel}>Size:</label>
      <input className={styles.optInput} type="number" defaultValue={5} min={1} max={200} style={{ width: 42 }} />
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Opacity:</label>
      <input className={styles.optInput} type="number" defaultValue={100} min={1} max={100} style={{ width: 42 }} />
      <span className={styles.optText}>%</span>
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Hardness:</label>
      <input className={styles.optInput} type="number" defaultValue={100} min={0} max={100} style={{ width: 42 }} />
      <span className={styles.optText}>%</span>
    </>
  )
}

export const brushTool: ToolDefinition = {
  createHandler: createPencilHandler,
  Options: BrushOptions,
}
