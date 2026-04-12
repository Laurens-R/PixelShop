import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useWebGL } from '@/hooks/useWebGL'
import { useCanvas } from '@/hooks/useCanvas'
import { useAppContext } from '@/store/AppContext'
import { useCanvasContext } from '@/store/CanvasContext'
import type { WebGLLayer } from '@/webgl/WebGLRenderer'
import { TOOL_REGISTRY } from '@/tools'
import type { ToolContext, ToolHandler } from '@/tools'
import { selectionStore } from '@/store/selectionStore'
import styles from './Canvas.module.scss'

// ─── Public handle (for save / export / clipboard) ─────────────────────────

export interface CanvasHandle {
  /** Encode a layer's pixel data to a PNG data-URL synchronously. */
  exportLayerPng: (layerId: string) => string | null
  /**
   * Composite all visible layers (in state order) and return the raw RGBA
   * pixel data together with the image dimensions.
   * Returns null when the renderer is not yet initialised.
   */
  exportFlatPixels: () => { data: Uint8Array; width: number; height: number } | null
  /** Return a copy of a layer's raw RGBA pixel data. */
  getLayerPixels: (layerId: string) => Uint8Array | null
  /**
   * Create a new GL layer, fill it with data, and render.
   * Call BEFORE dispatching ADD_LAYER so the sync effect is a no-op.
   */
  prepareNewLayer: (layerId: string, name: string, data: Uint8Array) => void
  /** Zero out every pixel in a layer that is covered by the selection mask, then flush+render. */
  clearLayerPixels: (layerId: string, mask: Uint8Array) => void
  /** Snapshot all current layers' raw pixel data for history (returns copies). */
  captureAllLayerPixels: () => Map<string, Uint8Array>
  /** Restore previously snapshotted pixel data and flush+render for each layer. */
  restoreAllLayerPixels: (data: Map<string, Uint8Array>) => void
}

// ─── PNG helpers ──────────────────────────────────────────────────────────────

function encodePng(data: Uint8Array, w: number, h: number): string {
  const tmp = document.createElement('canvas')
  tmp.width = w; tmp.height = h
  const ctx = tmp.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), w, h), 0, 0)
  return tmp.toDataURL('image/png')
}

function decodePng(dataUrl: string, w: number, h: number): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const tmp = document.createElement('canvas')
      tmp.width = w; tmp.height = h
      const ctx = tmp.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer))
    }
    img.onerror = () => reject(new Error('Failed to decode PNG'))
    img.src = dataUrl
  })
}

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
}

export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  { width, height, initialLayerData, onStrokeEnd, onReady },
  ref
) {
  const { state } = useAppContext()
  const { canvasElRef } = useCanvasContext()
  const { canvasRef, rendererRef, render } = useWebGL({
    pixelWidth: width,
    pixelHeight: height
  })

  const glLayersRef = useRef<Map<string, WebGLLayer>>(new Map())
  const toolHandlerRef = useRef<ToolHandler>(TOOL_REGISTRY[state.activeTool].createHandler())
  const hasInitializedRef = useRef(false)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  // Keep a ref to the current layer list so the imperative handle can access
  // up-to-date ordering and visibility without being re-created on every render.
  const layersStateRef = useRef(state.layers)
  layersStateRef.current = state.layers
  const onStrokeEndRef = useRef(onStrokeEnd)
  onStrokeEndRef.current = onStrokeEnd
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  // ── Expose handle for save / export / clipboard ────────────────
  useImperativeHandle(ref, () => ({
    exportLayerPng: (layerId: string): string | null => {
      const renderer = rendererRef.current
      const layer = glLayersRef.current.get(layerId)
      if (!renderer || !layer) return null
      const w = renderer.pixelWidth
      const h = renderer.pixelHeight
      return encodePng(renderer.readLayerPixels(layer), w, h)
    },
    exportFlatPixels: (): { data: Uint8Array; width: number; height: number } | null => {
      const renderer = rendererRef.current
      if (!renderer) return null
      const glLayers = layersStateRef.current
        .map((l) => glLayersRef.current.get(l.id))
        .filter((l): l is WebGLLayer => l !== undefined)
      const data = renderer.readFlattenedPixels(glLayers)
      return { data, width: renderer.pixelWidth, height: renderer.pixelHeight }
    },
    getLayerPixels: (layerId: string): Uint8Array | null => {
      const renderer = rendererRef.current
      const layer = glLayersRef.current.get(layerId)
      if (!renderer || !layer) return null
      return renderer.readLayerPixels(layer)
    },
    prepareNewLayer: (layerId: string, name: string, data: Uint8Array): void => {
      const renderer = rendererRef.current
      if (!renderer) return
      const layer = renderer.createLayer(layerId, name)
      layer.data.set(data)
      renderer.flushLayer(layer)
      glLayersRef.current.set(layerId, layer)
      // Render with current layers + new one
      const ordered = [
        ...layersStateRef.current
          .map((l) => glLayersRef.current.get(l.id))
          .filter((l): l is WebGLLayer => !!l),
        layer,
      ]
      render(ordered)
    },
    clearLayerPixels: (layerId: string, mask: Uint8Array): void => {
      const renderer = rendererRef.current
      const layer = glLayersRef.current.get(layerId)
      if (!renderer || !layer) return
      for (let i = 0; i < mask.length; i++) {
        if (mask[i]) {
          const f = 1 - mask[i] / 255
          layer.data[i * 4]     = Math.round(layer.data[i * 4]     * f)
          layer.data[i * 4 + 1] = Math.round(layer.data[i * 4 + 1] * f)
          layer.data[i * 4 + 2] = Math.round(layer.data[i * 4 + 2] * f)
          layer.data[i * 4 + 3] = Math.round(layer.data[i * 4 + 3] * f)
        }
      }
      renderer.flushLayer(layer)
      // Use layersStateRef so we get the current layer order, not a stale closure
      const ordered = layersStateRef.current
        .map((l) => glLayersRef.current.get(l.id))
        .filter((l): l is WebGLLayer => !!l)
      render(ordered)
    },
    captureAllLayerPixels: (): Map<string, Uint8Array> => {
      const result = new Map<string, Uint8Array>()
      for (const ls of layersStateRef.current) {
        const layer = glLayersRef.current.get(ls.id)
        if (layer) result.set(ls.id, layer.data.slice())
      }
      return result
    },
    restoreAllLayerPixels: (data: Map<string, Uint8Array>): void => {
      const renderer = rendererRef.current
      if (!renderer) return
      for (const [id, pixels] of data) {
        let layer = glLayersRef.current.get(id)
        if (!layer) {
          layer = renderer.createLayer(id, 'Restored')
          glLayersRef.current.set(id, layer)
        }
        layer.data.set(pixels)
        renderer.flushLayer(layer)
      }
      // Render immediately — when only pixels changed (no layer add/remove),
      // state.layers reference is unchanged so the sync effect won't fire.
      const ordered = layersStateRef.current
        .map((l) => glLayersRef.current.get(l.id))
        .filter((l): l is WebGLLayer => !!l)
      render(ordered)
    },
  }), [width, height]) // eslint-disable-line react-hooks/exhaustive-deps

  // Init selection store dimensions once canvas is sized
  useEffect(() => {
    selectionStore.setDimensions(width, height)
    return () => { selectionStore.clear() }
  }, [width, height])

  // Marching-ants RAF loop — mounted once
  useEffect(() => {
    let rafId: number
    let dashOffset = 0

    const tick = (): void => {
      rafId = requestAnimationFrame(tick)
      const overlay = overlayRef.current
      if (!overlay) return
      const ctx2d = overlay.getContext('2d')
      if (!ctx2d) return

      ctx2d.clearRect(0, 0, overlay.width, overlay.height)

      const { mask, pending, borderSegments } = selectionStore
      if (!mask && !pending) return

      // Draw in image pixel coords — CSS scaling handles zoom
      if (borderSegments && borderSegments.length > 0) {
        dashOffset = (dashOffset + 0.25) % 8
        ctx2d.lineWidth = 1
        ctx2d.setLineDash([4, 4])

        for (const [color, extra] of [['#000000', 0], ['#ffffff', 4]] as const) {
          ctx2d.strokeStyle = color
          ctx2d.lineDashOffset = dashOffset + extra
          ctx2d.beginPath()
          for (let i = 0; i < borderSegments.length; i += 4) {
            ctx2d.moveTo(borderSegments[i],     borderSegments[i + 1])
            ctx2d.lineTo(borderSegments[i + 2], borderSegments[i + 3])
          }
          ctx2d.stroke()
        }
      }

      // ── Pending drag preview ───────────────────────────────────────────────
      if (pending) {
        ctx2d.strokeStyle = '#00aaff'
        ctx2d.lineWidth   = 1
        ctx2d.setLineDash([4, 2])
        ctx2d.lineDashOffset = 0
        ctx2d.beginPath()

        if (pending.type === 'rect') {
          const { x1, y1, x2, y2 } = pending
          ctx2d.rect(
            Math.min(x1, x2), Math.min(y1, y2),
            Math.abs(x2 - x1), Math.abs(y2 - y1)
          )
        } else {
          const pts = pending.points
          if (pts.length > 1) {
            ctx2d.moveTo(pts[0].x, pts[0].y)
            for (let i = 1; i < pts.length; i++) ctx2d.lineTo(pts[i].x, pts[i].y)
          }
        }
        ctx2d.stroke()
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Publish canvas element into shared context
  useEffect(() => {
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
      const { pixelWidth: w, pixelHeight: h } = renderer
      for (let i = 0; i < state.layers.length; i++) {
        const ls = state.layers[i]
        const layer = renderer.createLayer(ls.id, ls.name)
        layer.opacity = ls.opacity
        layer.visible = ls.visible
        layer.blendMode = ls.blendMode

        const pngData = initialLayerData?.get(ls.id)
        if (pngData) {
          try {
            const rgba = await decodePng(pngData, w, h)
            layer.data.set(rgba)
          } catch (e) {
            console.error('[Canvas] Failed to load layer PNG:', e)
          }
        } else if (i === 0 && !initialLayerData) {
          // New document — apply background fill to first layer only
          const bg = state.canvas.backgroundFill
          if (bg === 'white') {
            layer.data.fill(255)
          } else if (bg === 'black') {
            for (let j = 0; j < layer.data.length; j += 4) {
              layer.data[j] = 0; layer.data[j + 1] = 0; layer.data[j + 2] = 0; layer.data[j + 3] = 255
            }
          }
        }

        renderer.flushLayer(layer)
        glLayersRef.current.set(ls.id, layer)
      }
      render(buildOrderedGLLayers())
      onReadyRef.current?.()
    }

    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererRef.current])

  // Sync WebGL layers whenever AppState layer list changes
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    const map = glLayersRef.current

    for (const ls of state.layers) {
      if (!map.has(ls.id)) {
        const gl = renderer.createLayer(ls.id, ls.name)
        map.set(ls.id, gl)
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
    }

    render(buildOrderedGLLayers())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.layers])

  function buildOrderedGLLayers(): WebGLLayer[] {
    const map = glLayersRef.current
    return state.layers.map((ls) => map.get(ls.id)).filter((l): l is WebGLLayer => !!l)
  }

  useEffect(() => {
    const sel = state.activeTool
    if (sel !== 'select' && sel !== 'lasso' && sel !== 'magic-wand') {
      selectionStore.setPending(null)
    }
    toolHandlerRef.current = TOOL_REGISTRY[state.activeTool].createHandler()
  }, [state.activeTool])

  const buildCtx = (): ToolContext | null => {
    const renderer = rendererRef.current
    if (!renderer) return null
    const activeId = state.activeLayerId
    const activeLayer = activeId ? glLayersRef.current.get(activeId) : undefined
    if (!activeLayer) return null
    // Only block pixel-modifying tools on locked layers.
    // Selection tools (select, lasso, magic-wand) must work regardless of locking.
    if (TOOL_REGISTRY[state.activeTool].modifiesPixels) {
      const stateMeta = state.layers.find((l) => l.id === activeId)
      if (stateMeta?.locked) return null
    }
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
      if (TOOL_REGISTRY[state.activeTool].modifiesPixels && ctx) {
        const label = state.activeTool.charAt(0).toUpperCase() + state.activeTool.slice(1)
        onStrokeEndRef.current?.(label)
      }
    },
  })

  return (
    <div className={styles.viewport} data-canvas-viewport>
      <div className={styles.viewportInner}>
        <div
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
            ref={overlayRef}
            className={styles.overlay}
            width={width}
            height={height}
          />
        </div>
      </div>
    </div>
  )
})

