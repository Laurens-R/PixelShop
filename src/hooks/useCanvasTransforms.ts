import { useCallback, useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { resizeBilinear, resizeNearest } from '@/wasm'
import { cropStore } from '@/store/cropStore'
import type { AppState } from '@/types'
import type { AppAction } from '@/store/AppContext'
import type { CanvasHandle } from '@/components/ui/Canvas/Canvas'
import type { TabRecord } from '@/store/tabTypes'
import type { ResizeImageSettings } from '@/components/dialogs/ResizeImageDialog/ResizeImageDialog'
import type { ResizeCanvasSettings } from '@/components/dialogs/ResizeCanvasDialog/ResizeCanvasDialog'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseCanvasTransformsOptions {
  canvasHandleRef: { readonly current: CanvasHandle | null }
  stateRef: MutableRefObject<AppState>
  captureHistory: (label: string) => void
  dispatch: Dispatch<AppAction>
  activeTabId: string
  setTabs: Dispatch<SetStateAction<TabRecord[]>>
  setPendingLayerData: Dispatch<SetStateAction<Map<string, string> | null>>
  pendingLayerLabelRef: MutableRefObject<string | null>
  canvasWidth: number
  canvasHeight: number
}

export interface UseCanvasTransformsReturn {
  handleResizeImage:  (settings: ResizeImageSettings)  => Promise<void>
  handleResizeCanvas: (settings: ResizeCanvasSettings) => void
  handleCrop:         () => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCanvasTransforms({
  canvasHandleRef,
  stateRef,
  captureHistory,
  dispatch,
  activeTabId,
  setTabs,
  setPendingLayerData,
  pendingLayerLabelRef,
  canvasWidth,
  canvasHeight,
}: UseCanvasTransformsOptions): UseCanvasTransformsReturn {

  const handleResizeImage = useCallback(async (settings: ResizeImageSettings): Promise<void> => {
    const { width: newW, height: newH, filter } = settings
    const oldW = canvasWidth
    const oldH = canvasHeight
    if (newW === oldW && newH === oldH) return
    const resizeFn = filter === 'nearest' ? resizeNearest : resizeBilinear
    const handle   = canvasHandleRef.current
    if (!handle) return
    try {
      const encoded = new Map<string, string>()
      for (const layer of stateRef.current.layers) {
        const pixels = handle.getLayerPixels(layer.id)
        if (!pixels) continue
        const resized = await resizeFn(pixels, oldW, oldH, newW, newH)
        const tmp     = document.createElement('canvas')
        tmp.width = newW; tmp.height = newH
        const ctx2d = tmp.getContext('2d')!
        ctx2d.putImageData(new ImageData(new Uint8ClampedArray(resized.buffer as ArrayBuffer), newW, newH), 0, 0)
        encoded.set(layer.id, tmp.toDataURL('image/png'))
      }
      captureHistory('Before Resize Image')
      const resizeTabId = activeTabId
      setTabs(prev => prev.map(t =>
        t.id === resizeTabId
          ? { ...t, canvasKey: t.canvasKey + 1, snapshot: { ...t.snapshot, canvasWidth: newW, canvasHeight: newH } }
          : t
      ))
      setPendingLayerData(encoded)
      pendingLayerLabelRef.current = 'Resize Image'
      dispatch({ type: 'RESIZE_CANVAS', payload: { width: newW, height: newH } })
    } catch (err) {
      console.error('[Resize] Failed to resize image:', err)
    }
  }, [canvasWidth, canvasHeight, canvasHandleRef, stateRef, captureHistory, activeTabId, setTabs, setPendingLayerData, pendingLayerLabelRef, dispatch])

  const handleResizeCanvas = useCallback((settings: ResizeCanvasSettings): void => {
    const { width: newW, height: newH, anchorCol, anchorRow } = settings
    const oldW = canvasWidth
    const oldH = canvasHeight
    if (newW === oldW && newH === oldH) return
    const handle = canvasHandleRef.current
    if (!handle) return

    const offsetX = anchorCol === 0 ? 0 : anchorCol === 1 ? Math.round((newW - oldW) / 2) : newW - oldW
    const offsetY = anchorRow === 0 ? 0 : anchorRow === 1 ? Math.round((newH - oldH) / 2) : newH - oldH

    const encoded = new Map<string, string>()
    for (const layer of stateRef.current.layers) {
      const oldPixels = handle.getLayerPixels(layer.id)
      if (!oldPixels) continue
      const tmp    = document.createElement('canvas')
      tmp.width = newW; tmp.height = newH
      const ctx2d  = tmp.getContext('2d')!
      const oldCvs = document.createElement('canvas')
      oldCvs.width = oldW; oldCvs.height = oldH
      const oldCtx = oldCvs.getContext('2d')!
      oldCtx.putImageData(new ImageData(new Uint8ClampedArray(oldPixels.buffer as ArrayBuffer), oldW, oldH), 0, 0)
      ctx2d.drawImage(oldCvs, offsetX, offsetY)
      encoded.set(layer.id, tmp.toDataURL('image/png'))
    }

    captureHistory('Before Resize Canvas')
    const resizeCanvasTabId = activeTabId
    setTabs(prev => prev.map(t =>
      t.id === resizeCanvasTabId
        ? { ...t, canvasKey: t.canvasKey + 1, snapshot: { ...t.snapshot, canvasWidth: newW, canvasHeight: newH } }
        : t
    ))
    setPendingLayerData(encoded)
    pendingLayerLabelRef.current = 'Resize Canvas'
    dispatch({ type: 'RESIZE_CANVAS', payload: { width: newW, height: newH } })
  }, [canvasWidth, canvasHeight, canvasHandleRef, stateRef, captureHistory, activeTabId, setTabs, setPendingLayerData, pendingLayerLabelRef, dispatch])

  const handleCrop = useCallback((): void => {
    const r = cropStore.rect
    if (!r) return
    const oldW  = canvasWidth
    const oldH  = canvasHeight
    const cropX = Math.max(0, r.x)
    const cropY = Math.max(0, r.y)
    const cropW = Math.min(r.w, oldW - cropX)
    const cropH = Math.min(r.h, oldH - cropY)
    if (cropW <= 0 || cropH <= 0) return
    const handle = canvasHandleRef.current
    if (!handle) return

    const encoded = new Map<string, string>()
    for (const layer of stateRef.current.layers) {
      const pixels = handle.getLayerPixels(layer.id)
      if (!pixels) continue
      const src    = document.createElement('canvas')
      src.width = oldW; src.height = oldH
      const srcCtx = src.getContext('2d')!
      srcCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), oldW, oldH), 0, 0)
      const dst    = document.createElement('canvas')
      dst.width = cropW; dst.height = cropH
      const dstCtx = dst.getContext('2d')!
      dstCtx.drawImage(src, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
      encoded.set(layer.id, dst.toDataURL('image/png'))
    }

    cropStore.clear()
    captureHistory('Before Crop')
    const cropTabId = activeTabId
    setTabs(prev => prev.map(t =>
      t.id === cropTabId
        ? { ...t, canvasKey: t.canvasKey + 1, snapshot: { ...t.snapshot, canvasWidth: cropW, canvasHeight: cropH } }
        : t
    ))
    setPendingLayerData(encoded)
    pendingLayerLabelRef.current = 'Crop'
    dispatch({ type: 'RESIZE_CANVAS', payload: { width: cropW, height: cropH } })
  }, [canvasWidth, canvasHeight, canvasHandleRef, stateRef, captureHistory, activeTabId, setTabs, setPendingLayerData, pendingLayerLabelRef, dispatch])

  useEffect(() => {
    cropStore.onCrop = handleCrop
    return () => { cropStore.onCrop = null }
  }, [handleCrop])

  return { handleResizeImage, handleResizeCanvas, handleCrop }
}
