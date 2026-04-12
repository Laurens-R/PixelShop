import React from 'react'
import { selectionStore } from '@/store/selectionStore'
import type { ToolDefinition, ToolHandler, ToolPointerPos, ToolContext, ToolOptionsStyles } from './types'

// ─── Handler ──────────────────────────────────────────────────────────────────

function createMoveHandler(): ToolHandler {
  // State captured at pointer-down, used each pointer-move to rebase from scratch.
  let startX = 0
  let startY = 0
  let lastDx = 0
  let lastDy = 0
  let originalPixels: Uint8Array | null = null
  let originalMask: Uint8Array | null = null
  let isDown = false

  function apply(dx: number, dy: number, ctx: ToolContext): void {
    const { renderer, layer, layers, render } = ctx
    const w = renderer.pixelWidth
    const h = renderer.pixelHeight
    const src = originalPixels!
    const dst = layer.data

    if (originalMask) {
      // ── Selection move: clear selected area, paint at offset ──────────────
      // Step 1: restore original pixels
      dst.set(src)
      // Step 2: erase selected pixels from their original position
      for (let i = 0; i < w * h; i++) {
        const a = originalMask[i]
        if (a === 0) continue
        const f = 1 - a / 255
        dst[i * 4]     = Math.round(dst[i * 4]     * f)
        dst[i * 4 + 1] = Math.round(dst[i * 4 + 1] * f)
        dst[i * 4 + 2] = Math.round(dst[i * 4 + 2] * f)
        dst[i * 4 + 3] = Math.round(dst[i * 4 + 3] * f)
      }
      // Step 3: composite selected pixels at the new position (over)
      for (let sy = 0; sy < h; sy++) {
        const ty = sy + dy
        if (ty < 0 || ty >= h) continue
        for (let sx = 0; sx < w; sx++) {
          const tx = sx + dx
          if (tx < 0 || tx >= w) continue
          const mi = sy * w + sx
          const a = originalMask[mi]
          if (a === 0) continue
          const si = mi * 4
          const di = (ty * w + tx) * 4
          const srcA = src[si + 3] * a / 255
          const dstA = dst[di + 3]
          const outA = srcA + dstA * (1 - srcA / 255)
          if (outA === 0) continue
          dst[di]     = Math.round((src[si]     * srcA + dst[di]     * dstA * (1 - srcA / 255)) / outA)
          dst[di + 1] = Math.round((src[si + 1] * srcA + dst[di + 1] * dstA * (1 - srcA / 255)) / outA)
          dst[di + 2] = Math.round((src[si + 2] * srcA + dst[di + 2] * dstA * (1 - srcA / 255)) / outA)
          dst[di + 3] = Math.min(255, Math.round(outA))
        }
      }
    } else {
      // ── Whole-layer move ──────────────────────────────────────────────────
      dst.fill(0)
      for (let sy = 0; sy < h; sy++) {
        const ty = sy + dy
        if (ty < 0 || ty >= h) continue
        for (let sx = 0; sx < w; sx++) {
          const tx = sx + dx
          if (tx < 0 || tx >= w) continue
          const si = (sy * w + sx) * 4
          const di = (ty * w + tx) * 4
          dst[di]     = src[si]
          dst[di + 1] = src[si + 1]
          dst[di + 2] = src[si + 2]
          dst[di + 3] = src[si + 3]
        }
      }
    }

    renderer.flushLayer(layer)
    render(layers)
  }

  return {
    onPointerDown({ x, y }: ToolPointerPos, ctx: ToolContext) {
      startX = Math.round(x)
      startY = Math.round(y)
      lastDx = 0
      lastDy = 0
      originalPixels = ctx.layer.data.slice()
      originalMask   = selectionStore.mask ? selectionStore.mask.slice() : null
      isDown = true
    },

    onPointerMove({ x, y }: ToolPointerPos, ctx: ToolContext) {
      if (!isDown || !originalPixels) return
      const dx = Math.round(x) - startX
      const dy = Math.round(y) - startY
      if (dx === lastDx && dy === lastDy) return
      lastDx = dx
      lastDy = dy
      apply(dx, dy, ctx)
    },

    onPointerUp({ x, y }: ToolPointerPos, ctx: ToolContext) {
      if (!isDown || !originalPixels) return
      isDown = false
      const dx = Math.round(x) - startX
      const dy = Math.round(y) - startY
      if (dx !== lastDx || dy !== lastDy) {
        apply(dx, dy, ctx)
      }
      // Translate the selection mask to its new position
      if (originalMask && (dx !== 0 || dy !== 0)) {
        selectionStore.translateMask(dx, dy)
      }
      originalPixels = null
      originalMask   = null
    },
  }
}

// ─── Options UI ───────────────────────────────────────────────────────────────

function MoveOptions(_props: { styles: ToolOptionsStyles }): React.JSX.Element {
  return <></>
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const moveTool: ToolDefinition = {
  createHandler: createMoveHandler,
  Options: MoveOptions,
  modifiesPixels: true,
}
