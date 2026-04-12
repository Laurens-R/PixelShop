import React, { useState } from 'react'
import { floodFill } from '@/wasm'
import { SliderInput } from '@/components/widgets/SliderInput/SliderInput'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

// ─── Module-level options ─────────────────────────────────────────────────────

const fillOptions = {
  tolerance: 32,
  contiguous: true,
}

// ─── Non-contiguous fill (replace all matching pixels in the layer) ───────────

function fillAllMatching(
  data: Uint8Array,
  width: number,
  height: number,
  targetR: number, targetG: number, targetB: number, targetA: number,
  fillR: number, fillG: number, fillB: number, fillA: number,
  tolerance: number,
): void {
  const thresh2 = tolerance * tolerance * 4
  for (let i = 0; i < width * height * 4; i += 4) {
    const dr = data[i]     - targetR
    const dg = data[i + 1] - targetG
    const db = data[i + 2] - targetB
    const da = data[i + 3] - targetA
    if (dr * dr + dg * dg + db * db + da * da <= thresh2) {
      data[i]     = fillR
      data[i + 1] = fillG
      data[i + 2] = fillB
      data[i + 3] = fillA
    }
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

function createFillHandler(): ToolHandler {
  return {
    onPointerDown({ x, y }: ToolPointerPos, ctx: ToolContext) {
      const { renderer, layer, layers, primaryColor, render, commitStroke, growLayerToFit } = ctx
      const { r, g, b, a } = primaryColor

      // Grow the layer to cover the full canvas so that clicks on transparent
      // areas outside the initial sparse buffer are still reachable.
      const cw = renderer.pixelWidth
      const ch = renderer.pixelHeight
      growLayerToFit(0, 0)
      growLayerToFit(cw - 1, 0)
      growLayerToFit(0, ch - 1)
      growLayerToFit(cw - 1, ch - 1)

      // Convert canvas-space click to layer-local coords (re-compute after growth)
      const lx = Math.floor(x) - layer.offsetX
      const ly = Math.floor(y) - layer.offsetY

      if (fillOptions.contiguous) {
        // Async WASM flood fill (contiguous)
        floodFill(
          layer.data.slice(), // copy — WASM modifies in-place
          layer.layerWidth,
          layer.layerHeight,
          lx, ly,
          r, g, b, a,
          fillOptions.tolerance,
        ).then((result) => {
          layer.data.set(result)
          renderer.flushLayer(layer)
          render(layers)
          commitStroke('Fill')
        }).catch((err) => {
          console.error('[Fill] WASM flood fill failed:', err)
        })
      } else {
        // Non-contiguous: fill all matching pixels synchronously
        if (lx < 0 || ly < 0 || lx >= layer.layerWidth || ly >= layer.layerHeight) return
        const startIdx = (ly * layer.layerWidth + lx) * 4
        const targetR = layer.data[startIdx]
        const targetG = layer.data[startIdx + 1]
        const targetB = layer.data[startIdx + 2]
        const targetA = layer.data[startIdx + 3]
        fillAllMatching(layer.data, layer.layerWidth, layer.layerHeight, targetR, targetG, targetB, targetA, r, g, b, a, fillOptions.tolerance)
        renderer.flushLayer(layer)
        render(layers)
        commitStroke('Fill')
      }
    },
    onPointerMove() {},
    onPointerUp() {},
  }
}

// ─── Options UI ───────────────────────────────────────────────────────────────

function FillOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [tolerance, setTolerance]   = useState(fillOptions.tolerance)
  const [contiguous, setContiguous] = useState(fillOptions.contiguous)

  const handleTolerance = (v: number): void => { fillOptions.tolerance = v; setTolerance(v) }
  const handleContiguous = (v: boolean): void => { fillOptions.contiguous = v; setContiguous(v) }

  return (
    <>
      <label className={styles.optLabel}>Tolerance:</label>
      <SliderInput value={tolerance} min={0} max={255} inputWidth={42} onChange={handleTolerance} />
      <span className={styles.optSep} />
      <label className={styles.optCheckLabel}>
        <input
          type="checkbox"
          checked={contiguous}
          onChange={(e) => handleContiguous(e.target.checked)}
        />
        Contiguous
      </label>
    </>
  )
}

export const fillTool: ToolDefinition = {
  createHandler: createFillHandler,
  Options: FillOptions,
  modifiesPixels: true,
  skipAutoHistory: true,
}

