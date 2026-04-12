import React from 'react'
import { selectionStore } from './selectionStore'
import type { SelectionMode } from './selectionStore'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

// ─── Handler ──────────────────────────────────────────────────────────────────

function createLassoHandler(): ToolHandler {
  let points: { x: number; y: number }[] = []
  let mode: SelectionMode = 'set'

  return {
    onPointerDown({ x, y, shiftKey, altKey }: ToolPointerPos, _ctx: ToolContext) {
      points = [{ x, y }]
      mode = altKey ? 'subtract' : shiftKey ? 'add' : 'set'
      selectionStore.setPending({ type: 'path', points: [...points] })
    },

    onPointerMove({ x, y }: ToolPointerPos, _ctx: ToolContext) {
      const last = points[points.length - 1]
      // Subsample: only record if moved at least 2px to keep array small
      if (Math.abs(x - last.x) < 2 && Math.abs(y - last.y) < 2) return
      points.push({ x, y })
      selectionStore.setPending({ type: 'path', points: [...points] })
    },

    onPointerUp({ x, y }: ToolPointerPos, _ctx: ToolContext) {
      points.push({ x, y })
      selectionStore.setPolygon(points, mode)
      points = []
    },
  }
}

// ─── Options UI ───────────────────────────────────────────────────────────────

function LassoOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  return (
    <>
      <label className={styles.optLabel}>Feather:</label>
      <input
        className={styles.optInput}
        type="number"
        defaultValue={0}
        min={0}
        max={100}
        style={{ width: 38 }}
      />
      <span className={styles.optText}>px</span>
      <span className={styles.optSep} />
      <label className={styles.optCheckLabel}>
        <input type="checkbox" defaultChecked />
        Anti-alias
      </label>
    </>
  )
}

export const lassoTool: ToolDefinition = {
  createHandler: createLassoHandler,
  Options: LassoOptions,
}
