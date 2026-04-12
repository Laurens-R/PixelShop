import React, { useEffect, useRef } from 'react'
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
  const { canvasRef, rendererRef, render } = useWebGL({
    pixelWidth: width,
    pixelHeight: height
  })

  // Map of layerId → WebGLLayer, preserving pixel data across re-renders
  const glLayersRef = useRef<Map<string, WebGLLayer>>(new Map())
  const toolHandlerRef = useRef<ToolHandler>(TOOL_REGISTRY[state.activeTool].createHandler())
  // Guard: ensure the one-time layer init never re-runs after first success
  const hasInitializedRef = useRef(false)

  // Publish canvas element into shared context
  useEffect(() => {
    canvasElRef.current = canvasRef.current
  })

  // Initialize first layer after renderer mounts — runs once only
  useEffect(() => {
    if (hasInitializedRef.current) return
    const renderer = rendererRef.current
    if (!renderer) return
    const firstState = state.layers[0]
    if (!firstState) return
    hasInitializedRef.current = true
    const layer = renderer.createLayer(firstState.id, firstState.name)
    const bg = state.canvas.backgroundFill
    if (bg === 'white') {
      layer.data.fill(255)
    } else if (bg === 'black') {
      for (let i = 0; i < layer.data.length; i += 4) {
        layer.data[i] = 0; layer.data[i + 1] = 0; layer.data[i + 2] = 0; layer.data[i + 3] = 255
      }
    }
    // transparent: data already initialized to 0
    renderer.flushLayer(layer)
    glLayersRef.current.set(firstState.id, layer)
    render(buildOrderedGLLayers())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererRef.current])

  // Sync WebGL layers whenever AppState layer list changes
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    const map = glLayersRef.current

    // Create any missing GL layers
    for (const ls of state.layers) {
      if (!map.has(ls.id)) {
        const gl = renderer.createLayer(ls.id, ls.name)
        map.set(ls.id, gl)
      }
    }

    // Destroy removed GL layers
    const stateIds = new Set(state.layers.map((l) => l.id))
    for (const [id, gl] of map) {
      if (!stateIds.has(id)) {
        renderer.destroyLayer(gl)
        map.delete(id)
      }
    }

    // Sync opacity, visibility, blendMode from AppState → WebGL layer
    for (const ls of state.layers) {
      const gl = map.get(ls.id)
      if (!gl) continue
      gl.opacity = ls.opacity
      gl.visible = ls.visible
      gl.blendMode = ls.blendMode
    }

    render(buildOrderedGLLayers())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.layers])

  // Build ordered GL layer array matching AppState order (bottom → top)
  function buildOrderedGLLayers(): WebGLLayer[] {
    const map = glLayersRef.current
    return state.layers.map((ls) => map.get(ls.id)).filter((l): l is WebGLLayer => !!l)
  }

  // Reset handler state whenever the active tool changes
  useEffect(() => {
    toolHandlerRef.current = TOOL_REGISTRY[state.activeTool].createHandler()
  }, [state.activeTool])

  const buildCtx = (): ToolContext | null => {
    const renderer = rendererRef.current
    if (!renderer) return null
    const activeId = state.activeLayerId
    const activeLayer = activeId ? glLayersRef.current.get(activeId) : undefined
    if (!activeLayer) return null
    // Lock guard: don't draw on locked layers
    const stateMeta = state.layers.find((l) => l.id === activeId)
    if (stateMeta?.locked) return null
    return {
      renderer,
      layer: activeLayer,
      layers: buildOrderedGLLayers(),
      primaryColor: state.primaryColor,
      render
    }
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
          style={{
            width:  width  * state.canvas.zoom / window.devicePixelRatio,
            height: height * state.canvas.zoom / window.devicePixelRatio,
          }}
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
