import type React from 'react'
import type { WebGLRenderer, WebGLLayer } from '@/webgl/WebGLRenderer'
import type { RGBAColor } from '@/types'

// ─── Runtime context passed to tool handlers on each pointer event ────────────

export interface ToolContext {
  renderer: WebGLRenderer
  layer: WebGLLayer
  layers: WebGLLayer[]
  primaryColor: RGBAColor
  render: (layers: WebGLLayer[]) => void
}

// ─── Pointer position passed to tool handlers ─────────────────────────────────

export interface ToolPointerPos {
  x: number
  y: number
  pressure: number
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
}
