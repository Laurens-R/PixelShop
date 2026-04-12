import React, { useState } from 'react'
import { selectionStore } from './selectionStore'
import type { SelectionMode } from './selectionStore'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

// ─── Shared options ───────────────────────────────────────────────────────────

const selectOptions = { feather: 0, style: 'normal' as 'normal' | 'fixed-ratio' | 'fixed-size' }

// ─── Handler ──────────────────────────────────────────────────────────────────

function createSelectHandler(): ToolHandler {
  let startX = 0
  let startY = 0
  let mode: SelectionMode = 'set'

  return {
    onPointerDown({ x, y, shiftKey, altKey }: ToolPointerPos, _ctx: ToolContext) {
      startX = x
      startY = y
      mode = altKey ? 'subtract' : shiftKey ? 'add' : 'set'
      selectionStore.setPending({ type: 'rect', x1: x, y1: y, x2: x, y2: y })
    },

    onPointerMove({ x, y }: ToolPointerPos, _ctx: ToolContext) {
      selectionStore.setPending({ type: 'rect', x1: startX, y1: startY, x2: x, y2: y })
    },

    onPointerUp({ x, y }: ToolPointerPos, _ctx: ToolContext) {
      selectionStore.setRect(startX, startY, x, y, mode)
    },
  }
}

// ─── Options UI ───────────────────────────────────────────────────────────────

function SelectOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [style, setStyle] = useState(selectOptions.style)

  return (
    <>
      <label className={styles.optLabel}>Feather:</label>
      <input
        className={styles.optInput}
        type="number"
        defaultValue={selectOptions.feather}
        min={0}
        max={100}
        style={{ width: 38 }}
        onChange={e => { selectOptions.feather = Number(e.target.value) }}
      />
      <span className={styles.optText}>px</span>
      <span className={styles.optSep} />
      <label className={styles.optLabel}>Style:</label>
      <select
        className={styles.optSelect}
        value={style}
        onChange={e => {
          selectOptions.style = e.target.value as typeof selectOptions.style
          setStyle(e.target.value as typeof selectOptions.style)
        }}
      >
        <option value="normal">Normal</option>
        <option value="fixed-ratio">Fixed Ratio</option>
        <option value="fixed-size">Fixed Size</option>
      </select>
    </>
  )
}

export const selectTool: ToolDefinition = {
  createHandler: createSelectHandler,
  Options: SelectOptions,
}
