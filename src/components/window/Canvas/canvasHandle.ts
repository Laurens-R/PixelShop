import { useImperativeHandle } from 'react'
import type React from 'react'
import type { WebGLLayer, WebGLRenderer } from '@/webgl/WebGLRenderer'
import type { LayerState } from '@/types'
import { encodePng } from './pngHelpers'

// ─── Public handle type (imported by App.tsx and other callers) ────────────

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
  /** Zoom to fit the whole canvas inside the current viewport with a small margin. */
  fitToWindow: () => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseCanvasHandleParams {
  ref: React.ForwardedRef<CanvasHandle>
  rendererRef: { readonly current: WebGLRenderer | null }
  glLayersRef: { readonly current: Map<string, WebGLLayer> }
  layersStateRef: { readonly current: readonly LayerState[] }
  render: (layers: WebGLLayer[]) => void
  width: number
  height: number
  viewportRef: React.RefObject<HTMLDivElement | null>
  onZoom: (zoom: number) => void
}

export function useCanvasHandle({
  ref,
  rendererRef,
  glLayersRef,
  layersStateRef,
  render,
  width,
  height,
  viewportRef,
  onZoom,
}: UseCanvasHandleParams): void {
  useImperativeHandle(ref, () => ({
    exportLayerPng: (layerId) => {
      const renderer = rendererRef.current
      const layer = glLayersRef.current.get(layerId)
      if (!renderer || !layer) return null
      const png = encodePng(renderer.readLayerPixels(layer), layer.layerWidth, layer.layerHeight)
      return { png, layerWidth: layer.layerWidth, layerHeight: layer.layerHeight, offsetX: layer.offsetX, offsetY: layer.offsetY }
    },

    exportFlatPixels: () => {
      const renderer = rendererRef.current
      if (!renderer) return null
      const stateLayers = layersStateRef.current
      // Exclude mask layers from the composite list (they are applied via maskMap)
      const glLayers = stateLayers
        .filter((l) => !('type' in l && l.type === 'mask'))
        .map((l) => glLayersRef.current.get(l.id))
        .filter((l): l is WebGLLayer => l !== undefined)
      // Build mask map: parentId → mask GL layer (visible masks only)
      const maskMap = new Map<string, WebGLLayer>()
      for (const l of stateLayers) {
        if ('type' in l && l.type === 'mask' && l.visible) {
          const gl = glLayersRef.current.get(l.id)
          if (gl) maskMap.set((l as { parentId: string }).parentId, gl)
        }
      }
      const data = renderer.readFlattenedPixels(glLayers, maskMap)
      return { data, width: renderer.pixelWidth, height: renderer.pixelHeight }
    },

    getLayerPixels: (layerId) => {
      const renderer = rendererRef.current
      const layer = glLayersRef.current.get(layerId)
      if (!renderer || !layer) return null
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

    prepareNewLayer: (layerId, name, data, lw?, lh?, ox?, oy?) => {
      const renderer = rendererRef.current
      if (!renderer) return
      const useW  = lw ?? renderer.pixelWidth
      const useH  = lh ?? renderer.pixelHeight
      const useOx = ox ?? 0
      const useOy = oy ?? 0
      const layer = renderer.createLayer(layerId, name, useW, useH, useOx, useOy)
      layer.data.set(data)
      renderer.flushLayer(layer)
      glLayersRef.current.set(layerId, layer)
      render([
        ...layersStateRef.current
          .map((l) => glLayersRef.current.get(l.id))
          .filter((l): l is WebGLLayer => !!l),
        layer,
      ])
    },

    clearLayerPixels: (layerId, mask) => {
      const renderer = rendererRef.current
      const layer = glLayersRef.current.get(layerId)
      if (!renderer || !layer) return
      const w = renderer.pixelWidth
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
      render(
        layersStateRef.current
          .map((l) => glLayersRef.current.get(l.id))
          .filter((l): l is WebGLLayer => !!l)
      )
    },

    captureAllLayerPixels: () => {
      const result = new Map<string, Uint8Array>()
      for (const ls of layersStateRef.current) {
        const layer = glLayersRef.current.get(ls.id)
        if (layer) result.set(ls.id, layer.data.slice())
      }
      return result
    },

    captureAllLayerGeometry: () => {
      const result = new Map<string, { layerWidth: number; layerHeight: number; offsetX: number; offsetY: number }>()
      for (const ls of layersStateRef.current) {
        const layer = glLayersRef.current.get(ls.id)
        if (layer) result.set(ls.id, { layerWidth: layer.layerWidth, layerHeight: layer.layerHeight, offsetX: layer.offsetX, offsetY: layer.offsetY })
      }
      return result
    },

    fitToWindow: () => {
      const vp = viewportRef.current
      if (!vp) return
      const dpr = window.devicePixelRatio || 1
      const margin = 0.9
      const zoom = Math.min(
        (vp.clientWidth  / (width  / dpr)) * margin,
        (vp.clientHeight / (height / dpr)) * margin,
      )
      onZoom(parseFloat(Math.max(0.05, Math.min(32, zoom)).toFixed(4)))
    },

    restoreAllLayerPixels: (data, geometry?) => {
      const renderer = rendererRef.current
      if (!renderer) return
      for (const [id, pixels] of data) {
        const geo = geometry?.get(id)
        let layer = glLayersRef.current.get(id)
        if (geo) {
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
      render(
        layersStateRef.current
          .map((l) => glLayersRef.current.get(l.id))
          .filter((l): l is WebGLLayer => !!l)
      )
    },
  }), [width, height]) // eslint-disable-line react-hooks/exhaustive-deps
}
