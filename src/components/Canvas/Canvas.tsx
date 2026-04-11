import React, { useEffect, useRef, useState } from 'react'
import { useWebGL } from '@/hooks/useWebGL'
import { useCanvas } from '@/hooks/useCanvas'
import { useAppContext } from '@/store/AppContext'
import { useCanvasContext } from '@/store/CanvasContext'
import type { WebGLLayer } from '@/webgl/WebGLRenderer'
import { TOOL_REGISTRY } from '@/tools'
import type { ToolContext, ToolHandler } from '@/tools'
import styles from './Canvas.module.scss'

interface CanvasProps {
  width: number
  height: number
}

export function Canvas({ width, height }: CanvasProps): React.JSX.Element {
  const { state } = useAppContext()
  const { canvasElRef } = useCanvasContext()
  const { canvasRef, rendererRef, createLayer, render } = useWebGL({
    pixelWidth: width,
    pixelHeight: height
  })
  const [layers, setLayers] = useState<WebGLLayer[]>([])
  const activeLayerRef = useRef<WebGLLayer | null>(null)
  const toolHandlerRef = useRef<ToolHandler>(TOOL_REGISTRY[state.activeTool].createHandler())

  // Publish canvas element into shared context
  useEffect(() => {
    canvasElRef.current = canvasRef.current
  })

  // Initialize first layer after renderer mounts
  useEffect(() => {
    const layer = createLayer('layer-0', 'Background')
    if (layer) {
      layer.data.fill(255) // white, fully opaque
      rendererRef.current?.flushLayer(layer)
      setLayers([layer])
      activeLayerRef.current = layer
      render([layer])
    }
  }, [createLayer, render])

  // Re-render when layer visibility/opacity changes
  useEffect(() => {
    if (layers.length > 0) render(layers)
  }, [state.layers, layers, render])

  // Reset handler state whenever the active tool changes
  useEffect(() => {
    toolHandlerRef.current = TOOL_REGISTRY[state.activeTool].createHandler()
  }, [state.activeTool])

  const buildCtx = (): ToolContext | null => {
    const renderer = rendererRef.current
    const layer = activeLayerRef.current
    if (!renderer || !layer) return null
    return { renderer, layer, layers, primaryColor: state.primaryColor, render }
  }

  const { handlePointerDown, handlePointerMove, handlePointerUp, handlePointerLeave } = useCanvas({
    onPointerDown: (pos) => {
      const ctx = buildCtx()
      if (ctx) toolHandlerRef.current.onPointerDown(pos, ctx)
    },
    onPointerMove: (pos) => {
      const ctx = buildCtx()
      if (ctx) toolHandlerRef.current.onPointerMove(pos, ctx)
    },
    onPointerUp: (pos) => {
      const ctx = buildCtx()
      if (ctx) toolHandlerRef.current.onPointerUp(pos, ctx)
    },
  })

  return (
    <div className={styles.viewport} data-canvas-viewport>
      <div className={styles.viewportInner}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          width={width}
          height={height}
          style={{ width: width * state.canvas.zoom, height: height * state.canvas.zoom }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          aria-label={`Canvas ${width}\u00d7${height}`}
        />
      </div>
    </div>
  )
}
