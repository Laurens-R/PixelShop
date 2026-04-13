import React, { forwardRef, useEffect, useRef, useState } from 'react'
import { useWebGL } from '@/hooks/useWebGL'
import { useCanvas } from '@/hooks/useCanvas'
import { useAppContext } from '@/store/AppContext'
import { useCanvasContext } from '@/store/CanvasContext'
import type { WebGLLayer } from '@/webgl/WebGLRenderer'
import type { TextLayerState } from '@/types'
import { TOOL_REGISTRY } from '@/tools'
import type { ToolContext, ToolHandler } from '@/tools'
import { selectionStore } from '@/store/selectionStore'
import { cursorStore } from '@/store/cursorStore'
import { TextLayerEditor } from './TextLayerEditor'
import { rasterizeTextToLayer } from './textRasterizer'
import { decodePng } from './pngHelpers'
import { useCanvasHandle } from './canvasHandle'
import type { CanvasHandle } from './canvasHandle'
import { useMarchingAnts } from './useMarchingAnts'
import { useScrollZoom } from './useScrollZoom'
import styles from './Canvas.module.scss'

// Re-export so external importers (App.tsx etc.) don't need to change their paths.
export type { CanvasHandle } from './canvasHandle'

// ─── Component ────────────────────────────────────────────────────────────────

interface CanvasProps {
  width: number
  height: number
  /** Per-layer base64 PNG data URLs to populate on mount (used when opening a file). */
  initialLayerData?: Map<string, string>
  /** Called with the tool label after a pixel-modifying stroke completes. */
  onStrokeEnd?: (label: string) => void
  /** Called once after the canvas has finished its first initialization render. */
  onReady?: () => void
  /** When false the canvas is hidden and all interactive effects are suspended. Default true. */
  isActive?: boolean
}

export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  { width, height, initialLayerData, onStrokeEnd, onReady, isActive = true },
  ref
) {
  const { state, dispatch } = useAppContext()
  const { canvasElRef } = useCanvasContext()
  const { canvasRef, rendererRef, render } = useWebGL({
    pixelWidth: width,
    pixelHeight: height
  })

  const glLayersRef = useRef<Map<string, WebGLLayer>>(new Map())
  const toolHandlerRef = useRef<ToolHandler>(TOOL_REGISTRY[state.activeTool].createHandler())
  const hasInitializedRef = useRef(false)
  // Track isActive in a ref so async init can read the current value
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  // Saved scroll position, restored when the canvas becomes active again
  const scrollPosRef = useRef({ left: 0, top: 0 })
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const toolOverlayRef = useRef<HTMLCanvasElement>(null)
  const canvasWrapperRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(state.canvas.zoom)
  zoomRef.current = state.canvas.zoom
  const pendingScrollRef = useRef<{ scrollLeft: number; scrollTop: number } | null>(null)

  // Keep a ref to the current layer list so the imperative handle can access
  // up-to-date ordering and visibility without being re-created on every render.
  const layersStateRef = useRef(state.layers)
  layersStateRef.current = state.layers
  const onStrokeEndRef = useRef(onStrokeEnd)
  onStrokeEndRef.current = onStrokeEnd
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  // ── Inline text layer editor state ────────────────────────────
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null)

  // ── Expose handle for save / export / clipboard ────────────────
  useCanvasHandle({ ref, rendererRef, glLayersRef, layersStateRef, render, width, height, viewportRef, onZoom: (zoom) => dispatch({ type: 'SET_ZOOM', payload: zoom }) })

  // ── Zoom to cursor + scroll save/restore ───────────────────────
  useScrollZoom(
    isActive, isActiveRef, viewportRef, zoomRef, pendingScrollRef, scrollPosRef,
    state.canvas.zoom,
    (zoom) => dispatch({ type: 'SET_ZOOM', payload: zoom }),
  )

  // Init selection store dimensions once canvas is sized
  useEffect(() => {
    if (!isActive) return
    selectionStore.setDimensions(width, height)
    return () => { selectionStore.clear() }
  }, [width, height, isActive])

  // ── Marching ants + crop overlay animation ─────────────────────
  useMarchingAnts(isActive, overlayRef)

  // Publish canvas element into shared context (active canvas only)
  useEffect(() => {
    if (!isActive) return
    canvasElRef.current = canvasRef.current
  })

  // Initialize all layers once renderer is ready — runs once per mount
  useEffect(() => {
    if (hasInitializedRef.current) return
    const renderer = rendererRef.current
    if (!renderer) return
    if (!state.layers.length) return
    hasInitializedRef.current = true

    const init = async (): Promise<void> => {
      const { pixelWidth: cw, pixelHeight: ch } = renderer
      for (let i = 0; i < state.layers.length; i++) {
        const ls = state.layers[i]

        let layer
        const pngData = initialLayerData?.get(ls.id)
        if (pngData) {
          // ── Opening a file: pngData may be layer-local or canvas-size.
          // We store a JSON-encoded geometry blob alongside or fall back to canvas-size.
          const geoKey = `${ls.id}:geo`
          const geoJson = initialLayerData?.get(geoKey)
          if (geoJson) {
            const geo = JSON.parse(geoJson) as { layerWidth: number; layerHeight: number; offsetX: number; offsetY: number }
            layer = renderer.createLayer(ls.id, ls.name, geo.layerWidth, geo.layerHeight, geo.offsetX, geo.offsetY)
            try {
              const rgba = await decodePng(pngData, geo.layerWidth, geo.layerHeight)
              layer.data.set(rgba)
            } catch (e) {
              console.error('[Canvas] Failed to load layer PNG:', e)
            }
          } else {
            // Legacy / image import: PNG is canvas-sized
            layer = renderer.createLayer(ls.id, ls.name, cw, ch, 0, 0)
            try {
              const rgba = await decodePng(pngData, cw, ch)
              layer.data.set(rgba)
            } catch (e) {
              console.error('[Canvas] Failed to load layer PNG:', e)
            }
          }
        } else if (i === 0 && !initialLayerData) {
          // New document — background layer covers the full canvas
          layer = renderer.createLayer(ls.id, ls.name, cw, ch, 0, 0)
          const bg = state.canvas.backgroundFill
          if (bg === 'white') {
            layer.data.fill(255)
          } else if (bg === 'black') {
            for (let j = 0; j < layer.data.length; j += 4) {
              layer.data[j] = 0; layer.data[j + 1] = 0; layer.data[j + 2] = 0; layer.data[j + 3] = 255
            }
          }
        } else {
          // New blank layer — start at 128×128 centered on the canvas
          const initW = Math.min(128, cw)
          const initH = Math.min(128, ch)
          const ox = Math.round((cw - initW) / 2)
          const oy = Math.round((ch - initH) / 2)
          layer = renderer.createLayer(ls.id, ls.name, initW, initH, ox, oy)
        }

        layer.opacity = ls.opacity
        layer.visible = ls.visible
        layer.blendMode = ls.blendMode
        renderer.flushLayer(layer)
        glLayersRef.current.set(ls.id, layer)
      }
      render(buildOrderedGLLayers())
      if (isActiveRef.current) {
        onReadyRef.current?.()
      }
    }

    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererRef.current])

  // Sync WebGL layers whenever AppState layer list changes
  useEffect(() => {
    if (!isActive) return
    const renderer = rendererRef.current
    if (!renderer) return
    const map = glLayersRef.current

    for (const ls of state.layers) {
      if (!map.has(ls.id)) {
        if ('type' in ls && ls.type === 'text') {
          // Text layers are created imperatively in addTextLayer before the dispatch;
          // if they somehow still aren't in the map, create a full-canvas layer for them.
          const cw = renderer.pixelWidth
          const ch = renderer.pixelHeight
          const gl = renderer.createLayer(ls.id, ls.name, cw, ch, 0, 0)
          rasterizeTextToLayer(ls, gl)
          renderer.flushLayer(gl)
          map.set(ls.id, gl)
        } else {
          // Pixel layers start at 128×128 centered on the canvas
          const cw = renderer.pixelWidth
          const ch = renderer.pixelHeight
          const initW = Math.min(128, cw)
          const initH = Math.min(128, ch)
          const ox = Math.round((cw - initW) / 2)
          const oy = Math.round((ch - initH) / 2)
          const gl = renderer.createLayer(ls.id, ls.name, initW, initH, ox, oy)
          map.set(ls.id, gl)
        }
      }
    }

    const stateIds = new Set(state.layers.map((l) => l.id))
    for (const [id, gl] of map) {
      if (!stateIds.has(id)) {
        renderer.destroyLayer(gl)
        map.delete(id)
      }
    }

    for (const ls of state.layers) {
      const gl = map.get(ls.id)
      if (!gl) continue
      gl.opacity = ls.opacity
      gl.visible = ls.visible
      gl.blendMode = ls.blendMode
      // Re-rasterize text layers whenever their state changes (text, style, position, color).
      // While a text layer is being edited, blank its bitmap so only the textarea is visible.
      if ('type' in ls && ls.type === 'text') {
        // Always reset offset — move tool may have shifted it temporarily for preview.
        gl.offsetX = 0
        gl.offsetY = 0
        if (ls.id === editingLayerId) {
          gl.data.fill(0)
        } else {
          rasterizeTextToLayer(ls, gl)
        }
        renderer.flushLayer(gl)
      }
    }

    render(buildOrderedGLLayers())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.layers, isActive, editingLayerId])

  function buildOrderedGLLayers(): WebGLLayer[] {
    const map = glLayersRef.current
    return state.layers.map((ls) => map.get(ls.id)).filter((l): l is WebGLLayer => !!l)
  }

  useEffect(() => {
    if (!isActive) return
    const sel = state.activeTool
    if (sel !== 'select' && sel !== 'lasso' && sel !== 'magic-wand') {
      selectionStore.setPending(null)
    }
    toolHandlerRef.current = TOOL_REGISTRY[state.activeTool].createHandler()
  }, [state.activeTool, isActive])

  const buildCtx = (): ToolContext | null => {
    const renderer = rendererRef.current
    if (!renderer) return null
    const activeId = state.activeLayerId
    const activeLayer = activeId ? glLayersRef.current.get(activeId) : undefined
    // Text tool doesn't need an existing pixel layer — it creates its own
    if (!activeLayer && state.activeTool !== 'text') return null
    // Only block pixel-modifying tools on locked layers.
    if (TOOL_REGISTRY[state.activeTool].modifiesPixels) {
      const stateMeta = state.layers.find((l) => l.id === activeId)
      if (stateMeta?.locked) return null
    }
    return {
      renderer,
      layer: activeLayer!, // text tool never dereferences this; all others are guarded above
      layers: buildOrderedGLLayers(),
      primaryColor: state.primaryColor,
      secondaryColor: state.secondaryColor,
      selectionMask: selectionStore.mask,
      render,
      growLayerToFit: (canvasX: number, canvasY: number, extraRadius = 0): void => {
        renderer.growLayerToFit(activeLayer!, canvasX, canvasY, extraRadius)
      },
      setColor: (color) => {
        dispatch({ type: 'SET_PRIMARY_COLOR', payload: color })
      },
      commitStroke: (label: string) => {
        onStrokeEndRef.current?.(label)
      },
      overlayCanvas: toolOverlayRef.current,
      addTextLayer: (ls) => {
        const cw = renderer.pixelWidth
        const ch = renderer.pixelHeight
        const gl = renderer.createLayer(ls.id, ls.name, cw, ch, 0, 0)
        rasterizeTextToLayer(ls, gl)
        renderer.flushLayer(gl)
        glLayersRef.current.set(ls.id, gl)
        render([...buildOrderedGLLayers(), gl])
        dispatch({ type: 'ADD_TEXT_LAYER', payload: ls })
        setEditingLayerId(ls.id)
      },
      updateTextLayer: (ls) => {
        dispatch({ type: 'UPDATE_TEXT_LAYER', payload: ls })
      },
      openTextLayerEditor: (id) => {
        dispatch({ type: 'SET_ACTIVE_LAYER', payload: id })
        setEditingLayerId(id)
      },
      textLayers: state.layers.filter(
        (l): l is TextLayerState => 'type' in l && l.type === 'text'
      ),
      previewTextAt: (ls, x, y) => {
        const gl = glLayersRef.current.get(ls.id)
        if (!gl) return
        rasterizeTextToLayer({ ...ls, x, y }, gl)
        renderer.flushLayer(gl)
        render(buildOrderedGLLayers())
      },
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
      const def = TOOL_REGISTRY[state.activeTool]
      if (def.modifiesPixels && !def.skipAutoHistory && ctx) {
        const label = state.activeTool.charAt(0).toUpperCase() + state.activeTool.slice(1)
        onStrokeEndRef.current?.(label)
      }
    },
    onHover: (pos) => {
      if (isActive) cursorStore.setPosition(pos.x, pos.y)
      const ctx = buildCtx()
      if (ctx) toolHandlerRef.current.onHover?.(pos, ctx)
    },
    onLeave: () => {
      cursorStore.hide()
      const ctx = buildCtx()
      if (ctx) toolHandlerRef.current.onLeave?.(ctx)
    },
  })

  return (
    <>
    <div ref={viewportRef} className={styles.viewport} data-canvas-viewport data-active-viewport={isActive ? '' : undefined}>
      <div className={styles.viewportInner}>
        <div
          ref={canvasWrapperRef}
          className={styles.canvasWrapper}
          style={{
            width:  width  * state.canvas.zoom / window.devicePixelRatio,
            height: height * state.canvas.zoom / window.devicePixelRatio,
          }}
        >
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
          <canvas
            ref={toolOverlayRef}
            className={styles.overlay}
            width={width}
            height={height}
          />
          <canvas
            ref={overlayRef}
            className={styles.overlay}
            width={width}
            height={height}
          />
          {state.canvas.showGrid && (
            <div
              className={styles.gridOverlay}
              style={{
                '--grid-size': `${state.canvas.gridSize * state.canvas.zoom / window.devicePixelRatio}px`,
                '--grid-color': state.canvas.gridColor,
              } as React.CSSProperties}
            />
          )}
        </div>
      </div>
    </div>
    <TextLayerEditor
      editingLayerId={editingLayerId}
      layers={state.layers}
      zoom={state.canvas.zoom}
      canvasWrapperRef={canvasWrapperRef}
      onCommit={(ls) => dispatch({ type: 'UPDATE_TEXT_LAYER', payload: ls })}
      onClose={() => {
        onStrokeEndRef.current?.('Text')
        setEditingLayerId(null)
      }}
    />
    </>
  )
})

