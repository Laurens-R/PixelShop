import React from 'react'
import type { ToolDefinition, ToolHandler, ToolOptionsStyles } from './types'

function createEyedropperHandler(): ToolHandler {
  return {
    onPointerDown() {},
    onPointerMove() {},
    onPointerUp() {},
  }
}

function EyedropperOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  return (
    <>
      <label className={styles.optLabel}>Sample:</label>
      <select className={styles.optSelect}>
        <option>Point</option>
        <option>3×3 Average</option>
        <option>5×5 Average</option>
      </select>
    </>
  )
}

export const eyedropperTool: ToolDefinition = {
  createHandler: createEyedropperHandler,
  Options: EyedropperOptions,
}
