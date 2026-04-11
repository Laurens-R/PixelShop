import React from 'react'
import type { ToolDefinition, ToolHandler, ToolOptionsStyles } from './types'

function createSelectHandler(): ToolHandler {
  return {
    onPointerDown() {},
    onPointerMove() {},
    onPointerUp() {},
  }
}

function SelectOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  return (
    <>
      <label className={styles.optLabel}>Feather:</label>
      <input className={styles.optInput} type="number" defaultValue={0} min={0} max={100} style={{ width: 38 }} />
      <span className={styles.optText}>px</span>
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Style:</label>
      <select className={styles.optSelect}>
        <option>Normal</option>
        <option>Fixed Ratio</option>
        <option>Fixed Size</option>
      </select>
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Width:</label>
      <input className={styles.optInput} type="text" defaultValue="" style={{ width: 52 }} />
      <label className={styles.optLabel}>Height:</label>
      <input className={styles.optInput} type="text" defaultValue="" style={{ width: 52 }} />
    </>
  )
}

export const selectTool: ToolDefinition = {
  createHandler: createSelectHandler,
  Options: SelectOptions,
}
