import type React from 'react'
import type { WebGLRenderer, WebGLLayer } from '@/webgl/WebGLRenderer'
import type { RGBAColor } from '@/types'

// ─── Runtime context passed to tool handlers on each pointer event ────────────

export interface ToolContext {
  renderer: WebGLRenderer
  layer: WebGLLayer
  layers: WebGLLayer[]
  primaryColor: RGBAColor
  secondaryColor: RGBAColor
  render: (layers: WebGLLayer[]) => void
  /**
   * Grow the active layer's buffer if the given canvas-space point (with
   * optional extra radius) would fall outside it. Call before writing pixels
   * at canvas coords near the edge.
   */
  growLayerToFit: (canvasX: number, canvasY: number, extraRadius?: number) => void
  /**
   * Active selection mask in canvas-space (1 byte per pixel, 0 = not selected,
   * non-zero = selected). null means the whole canvas is selected.
   */
  selectionMask: Uint8Array | null
  /** Set the primary color in app state (used by the eyedropper tool). */
  setColor: (color: RGBAColor) => void
  /**
   * For async tools (e.g. fill): call this after the operation completes to
   * push a history entry. Tools that use this must also set `skipAutoHistory`
   * on their ToolDefinition to prevent a duplicate capture on pointer up.
   */
  commitStroke: (label: string) => void
  /**
   * The overlay 2D canvas drawn on top of the WebGL canvas (used for
   * live drag previews — e.g. gradient guide line, selection marquee).
   * May be null if the canvas is not yet mounted.
   */
  overlayCanvas: HTMLCanvasElement | null
}

// ─── Pointer position passed to tool handlers ─────────────────────────────────

export interface ToolPointerPos {
  x: number
  y: number
  pressure: number
  shiftKey: boolean
  altKey: boolean
}

// ─── Stateful handler created fresh for each tool activation ──────────────────

export interface ToolHandler {
  onPointerDown(pos: ToolPointerPos, ctx: ToolContext): void
  onPointerMove(pos: ToolPointerPos, ctx: ToolContext): void
  onPointerUp(pos: ToolPointerPos, ctx: ToolContext): void
}

// ─── CSS module classes passed to each Options component ──────────────────────

export interface ToolOptionsStyles {
  optLabel: string
  optText: string
  optInput: string
  optSelect: string
  optCheckLabel: string
  optSep: string
  optBtn: string
}

// ─── Full tool definition registered in the tool registry ─────────────────────

export interface ToolDefinition {
  createHandler(): ToolHandler
  Options(props: { styles: ToolOptionsStyles }): React.JSX.Element
  /** True for tools that write pixels; Canvas uses this to block locked layers and trigger history capture on pointer up. */
  modifiesPixels?: boolean
  /** Set true for async tools that call ctx.commitStroke() themselves; suppresses the automatic pointer-up capture. */
  skipAutoHistory?: boolean
}
