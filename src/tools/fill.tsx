import React, { useState } from 'react'
import { SliderInput } from '@/components/SliderInput/SliderInput'
import type { ToolDefinition, ToolHandler, ToolOptionsStyles } from './types'

function createFillHandler(): ToolHandler {
  return {
    onPointerDown() {},
    onPointerMove() {},
    onPointerUp() {},
  }
}

function FillOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [tolerance, setTolerance] = useState(32)
  return (
    <>
      <label className={styles.optLabel}>Tolerance:</label>
      <SliderInput value={tolerance} min={0} max={255} inputWidth={42} onChange={setTolerance} />
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
