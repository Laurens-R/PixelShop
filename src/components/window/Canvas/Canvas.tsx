import { forwardRef, useEffect, useLayoutEffect, useImperativeHandle, useRef } from 'react'
import { useWebGL } from '@/hooks/useWebGL'
import { useCanvas } from '@/hooks/useCanvas'
import { useAppContext } from '@/store/AppContext'
import { useCanvasContext } from '@/store/CanvasContext'
import type { WebGLLayer } from '@/webgl/WebGLRenderer'
import { TOOL_REGISTRY } from '@/tools'
import type { ToolContext, ToolHandler } from '@/tools'
import { selectionStore } from '@/store/selectionStore'
import { cropStore } from '@/store/cropStore'
import styles from './Canvas.module.scss'

// ─── Public handle (for save / export / clipboard) ─────────────────────────

export interface CanvasHandle {
  /** Encode a layer's pixel data to a PNG data-URL synchronously. Returns layer-local PNG + geometry. */
  exportLayerPng: (layerId: string) => { png: string; layerWidth: number; layerHeight: number; offsetX: number; offsetY: number } | null
  /**
   * Composite all visible layers (in state order) and return the raw RGBA
   * pixel data together with the image dimensions.
   * Returns null when the renderer is not yet initialised.
   */
  exportFlatPixels: () => { data: Uint8Array; width: number; height: number } | null
  /** Return a copy of a layer's raw RGBA pixel data IN CANVAS-SIZE buffer (pixels outside layer bounds are transparent). */
  getLayerPixels: (layerId: string) => Uint8Array | null
  /**
   * Create a new GL layer, fill it with data, and render.
   * data is canvas-size RGBA. Call BEFORE dispatching ADD_LAYER so the sync effect is a no-op.
   * offsetX/offsetY/lw/lh let you specify exact layer bounds (for paste from clipboard).
   */
  prepareNewLayer: (layerId: string, name: string, data: Uint8Array, lw?: number, lh?: number, ox?: number, oy?: number) => void
  /** Zero out every pixel in a layer that is covered by the selection mask (canvas-space), then flush+render. */
  clearLayerPixels: (layerId: string, mask: Uint8Array) => void
  /** Snapshot all current layers' raw pixel data + geometry for history. */
  captureAllLayerPixels: () => Map<string, Uint8Array>
  /** Snapshot per-layer geometry (width/height/offset). */
  captureAllLayerGeometry: () => Map<string, { layerWidth: number; layerHeight: number; offsetX: number; offsetY: number }>
  /** Restore previously snapshotted pixel data + geometry and flush+render for each layer. */
  restoreAllLayerPixels: (data: Map<string, Uint8Array>, geometry?: Map<string, { layerWidth: number; layerHeight: number; offsetX: number; offsetY: number }>) => void
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

  // ── Expose handle for save / export / clipboard ────────────────
  useImperativeHandle(ref, () => ({
    exportLayerPng: (layerId: string) => {
      const renderer = rendererRef.current
      const layer = glLayersRef.current.get(layerId)
      if (!renderer || !layer) return null
      const png = encodePng(renderer.readLayerPixels(layer), layer.layerWidth, layer.layerHeight)
      return { png, layerWidth: layer.layerWidth, layerHeight: layer.layerHeight, offsetX: layer.offsetX, offsetY: layer.offsetY }
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
      // Return canvas-size buffer with layer placed at its offset
      const w = renderer.pixelWidth
      const h = renderer.pixelHeight
      const result = new Uint8Array(w * h * 4)
      for (let ly = 0; ly < layer.layerHeight; ly++) {
        const cy = layer.offsetY + ly
        if (cy < 0 || cy >= h) continue
        for (let lx = 0; lx < layer.layerWidth; lx++) {
          const cx = layer.offsetX + lx
          if (cx < 0 || cx >= w) continue
          const si = (ly * layer.layerWidth + lx) * 4
          const di = (cy * w + cx) * 4
          result[di]     = layer.data[si]
          result[di + 1] = layer.data[si + 1]
          result[di + 2] = layer.data[si + 2]
          result[di + 3] = layer.data[si + 3]
        }
      }
      return result
    },
    prepareNewLayer: (layerId: string, name: string, data: Uint8Array, lw?: number, lh?: number, ox?: number, oy?: number): void => {
      const renderer = rendererRef.current
      if (!renderer) return
      const useW = lw ?? renderer.pixelWidth
      const useH = lh ?? renderer.pixelHeight
      const useOx = ox ?? 0
      const useOy = oy ?? 0
      const layer = renderer.createLayer(layerId, name, useW, useH, useOx, useOy)
      layer.data.set(data)
      renderer.flushLayer(layer)
      glLayersRef.current.set(layerId, layer)
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
      const w = renderer.pixelWidth
      // mask is canvas-size; translate each canvas pixel to layer-local
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue
        const cx = i % w
        const cy = Math.floor(i / w)
        const lx = cx - layer.offsetX
        const ly = cy - layer.offsetY
        if (lx < 0 || ly < 0 || lx >= layer.layerWidth || ly >= layer.layerHeight) continue
        const pi = (ly * layer.layerWidth + lx) * 4
        const f = 1 - mask[i] / 255
        layer.data[pi]     = Math.round(layer.data[pi]     * f)
        layer.data[pi + 1] = Math.round(layer.data[pi + 1] * f)
        layer.data[pi + 2] = Math.round(layer.data[pi + 2] * f)
        layer.data[pi + 3] = Math.round(layer.data[pi + 3] * f)
      }
      renderer.flushLayer(layer)
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
    captureAllLayerGeometry: (): Map<string, { layerWidth: number; layerHeight: number; offsetX: number; offsetY: number }> => {
      const result = new Map<string, { layerWidth: number; layerHeight: number; offsetX: number; offsetY: number }>()
      for (const ls of layersStateRef.current) {
        const layer = glLayersRef.current.get(ls.id)
        if (layer) result.set(ls.id, { layerWidth: layer.layerWidth, layerHeight: layer.layerHeight, offsetX: layer.offsetX, offsetY: layer.offsetY })
      }
      return result
    },
    restoreAllLayerPixels: (data: Map<string, Uint8Array>, geometry?: Map<string, { layerWidth: number; layerHeight: number; offsetX: number; offsetY: number }>): void => {
      const renderer = rendererRef.current
      if (!renderer) return
      for (const [id, pixels] of data) {
        const geo = geometry?.get(id)
        let layer = glLayersRef.current.get(id)
        if (geo) {
          // Geometry changed: must recreate the GL texture at the right size
          if (!layer || layer.layerWidth !== geo.layerWidth || layer.layerHeight !== geo.layerHeight) {
            if (layer) renderer.destroyLayer(layer)
            layer = renderer.createLayer(id, layer?.name ?? 'Restored', geo.layerWidth, geo.layerHeight, geo.offsetX, geo.offsetY)
            glLayersRef.current.set(id, layer)
          } else {
            layer.offsetX = geo.offsetX
            layer.offsetY = geo.offsetY
          }
        }
        if (!layer) {
          layer = renderer.createLayer(id, 'Restored')
          glLayersRef.current.set(id, layer)
        }
        layer.data.set(pixels)
        renderer.flushLayer(layer)
      }
      const ordered = layersStateRef.current
        .map((l) => glLayersRef.current.get(l.id))
        .filter((l): l is WebGLLayer => !!l)
      render(ordered)
    },
  }), [width, height]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+scroll → zoom to cursor
  useEffect(() => {
    if (!isActive) return
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = vp.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      const oldZoom = zoomRef.current
      // Smooth on trackpad (pixel deltaMode), fixed step on mouse wheel
      const factor = e.deltaMode === 0
        ? Math.pow(0.998, e.deltaY)
        : e.deltaY < 0 ? 1.25 : 0.8
      const newZoom = parseFloat(
        Math.min(32, Math.max(0.05, oldZoom * factor)).toFixed(4)
      )
      pendingScrollRef.current = {
        scrollLeft: (vp.scrollLeft + cursorX) * (newZoom / oldZoom) - cursorX,
        scrollTop:  (vp.scrollTop  + cursorY) * (newZoom / oldZoom) - cursorY,
      }
      dispatch({ type: 'SET_ZOOM', payload: newZoom })
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [dispatch, isActive])

  // Continuously track scroll position — only while active so browser-triggered
  // scroll resets (on visibility change) don't overwrite the saved position.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onScroll = (): void => {
      if (isActiveRef.current) {
        scrollPosRef.current = { left: vp.scrollLeft, top: vp.scrollTop }
      }
    }
    vp.addEventListener('scroll', onScroll, { passive: true })
    return () => vp.removeEventListener('scroll', onScroll)
  }, [])
  // Restore scroll before paint when becoming active (layout change may have reset it)
  useLayoutEffect(() => {
    if (!isActive) return
    const vp = viewportRef.current
    if (vp) { vp.scrollLeft = scrollPosRef.current.left; vp.scrollTop = scrollPosRef.current.top }
  }, [isActive])

  // Apply pending scroll after zoom re-render, before paint
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current
    if (!pending) return
    pendingScrollRef.current = null
    const vp = viewportRef.current
    if (!vp) return
    vp.scrollLeft = pending.scrollLeft
    vp.scrollTop  = pending.scrollTop
  }, [state.canvas.zoom])

  // Init selection store dimensions once canvas is sized
  useEffect(() => {
    if (!isActive) return
    selectionStore.setDimensions(width, height)
    return () => { selectionStore.clear() }
  }, [width, height, isActive])

  // Marching-ants RAF loop — active only while this canvas is visible
  useEffect(() => {
    if (!isActive) return
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
      const hasCrop = !!(cropStore.pendingRect || cropStore.rect)
      if (!mask && !pending && !hasCrop) return

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

      // ── Crop overlay ──────────────────────────────────────────────────────
      const cp = cropStore.pendingRect
      const cr = cropStore.rect
      if (cp) {
        // Live drag preview — orange dashed rect
        ctx2d.strokeStyle = '#ff9900'
        ctx2d.lineWidth   = 1
        ctx2d.setLineDash([4, 2])
        ctx2d.lineDashOffset = 0
        ctx2d.strokeRect(
          Math.min(cp.x1, cp.x2), Math.min(cp.y1, cp.y2),
          Math.abs(cp.x2 - cp.x1), Math.abs(cp.y2 - cp.y1)
        )
      } else if (cr) {
        // Committed crop rect — orange marching ants
        dashOffset = (dashOffset + 0.25) % 8
        ctx2d.lineWidth = 1
        ctx2d.setLineDash([4, 4])
        for (const [color, extra] of [['#000000', 0], ['#ff9900', 4]] as const) {
          ctx2d.strokeStyle = color
          ctx2d.lineDashOffset = dashOffset + extra
          ctx2d.strokeRect(cr.x, cr.y, cr.w, cr.h)
        }
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

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
        // New layers start at 128×128 centered on the canvas
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
  }, [state.layers, isActive])

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
    if (!activeLayer) return null
    // Only block pixel-modifying tools on locked layers.
    if (TOOL_REGISTRY[state.activeTool].modifiesPixels) {
      const stateMeta = state.layers.find((l) => l.id === activeId)
      if (stateMeta?.locked) return null
    }
    return {
      renderer,
      layer: activeLayer,
      layers: buildOrderedGLLayers(),
      primaryColor: state.primaryColor,
      render,
      growLayerToFit: (canvasX: number, canvasY: number, extraRadius = 0): void => {
        renderer.growLayerToFit(activeLayer, canvasX, canvasY, extraRadius)
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
      if (TOOL_REGISTRY[state.activeTool].modifiesPixels && ctx) {
        const label = state.activeTool.charAt(0).toUpperCase() + state.activeTool.slice(1)
        onStrokeEndRef.current?.(label)
      }
    },
  })

  return (
    <div ref={viewportRef} className={styles.viewport} data-canvas-viewport>
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

