import React, { useState } from 'react'
import { SliderInput } from '@/components/widgets/SliderInput/SliderInput'
import { selectionStore } from './selectionStore'
import type { SelectionMode } from './selectionStore'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

// ─── Shared options ───────────────────────────────────────────────────────────

export const wandOptions = { tolerance: 32, contiguous: true }

// ─── Handler ──────────────────────────────────────────────────────────────────

function createMagicWandHandler(): ToolHandler {
  return {
    onPointerDown({ x, y, shiftKey, altKey }: ToolPointerPos, ctx: ToolContext) {
      const mode: SelectionMode = altKey ? 'subtract' : shiftKey ? 'add' : 'set'
      selectionStore.floodFillSelect(
        x, y,
        ctx.layer.data,
        wandOptions.tolerance,
        wandOptions.contiguous,
        mode
      )
    },

    onPointerMove() {},
    onPointerUp()   {},
  }
}

// ─── Options UI ───────────────────────────────────────────────────────────────

function MagicWandOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [tolerance, setTolerance]     = useState(wandOptions.tolerance)
  const [contiguous, setContiguous]   = useState(wandOptions.contiguous)

  return (
    <>
      <label className={styles.optLabel}>Tolerance:</label>
      <SliderInput
        value={tolerance}
        min={0}
        max={255}
        inputWidth={42}
        onChange={v => { wandOptions.tolerance = v; setTolerance(v) }}
      />
      <span className={styles.optSep} />
      <label className={styles.optCheckLabel}>
        <input
          type="checkbox"
          checked={contiguous}
          onChange={e => { wandOptions.contiguous = e.target.checked; setContiguous(e.target.checked) }}
        />
        Contiguous
      </label>
    </>
  )
}

export const magicWandTool: ToolDefinition = {
  createHandler: createMagicWandHandler,
  Options: MagicWandOptions,
}
