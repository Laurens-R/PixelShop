import React from 'react'
import type { ToolDefinition, ToolHandler, ToolOptionsStyles } from './types'

function createFillHandler(): ToolHandler {
  return {
    onPointerDown() {},
    onPointerMove() {},
    onPointerUp() {},
  }
}

function FillOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  return (
    <>
      <label className={styles.optLabel}>Tolerance:</label>
      <input className={styles.optInput} type="number" defaultValue={32} min={0} max={255} style={{ width: 42 }} />
      <span className={styles.optSep} />
      <label className={styles.optCheckLabel}>
        <input type="checkbox" defaultChecked />
        Anti-alias
      </label>
      <label className={styles.optCheckLabel}>
        <input type="checkbox" defaultChecked />
        Contiguous
      </label>
    </>
  )
}

export const fillTool: ToolDefinition = {
  createHandler: createFillHandler,
  Options: FillOptions,
}
