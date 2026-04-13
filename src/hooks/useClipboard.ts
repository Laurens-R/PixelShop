import { useCallback } from 'react'
import type { Dispatch, MutableRefObject } from 'react'
import { selectionStore } from '@/store/selectionStore'
import { clipboardStore } from '@/store/clipboardStore'
import { makeTabId } from '@/store/tabTypes'
import type { AppState } from '@/types'
import type { AppAction } from '@/store/AppContext'
import type { CanvasHandle } from '@/components/window/Canvas/Canvas'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseClipboardOptions {
  canvasHandleRef: { readonly current: CanvasHandle | null }
  state: AppState
  dispatch: Dispatch<AppAction>
  captureHistory: (label: string) => void
  pendingLayerLabelRef: MutableRefObject<string | null>
}

export interface UseClipboardReturn {
  handleCopy:   () => void
  handleCut:    () => void
  handlePaste:  () => void
  handleDelete: () => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useClipboard({
  canvasHandleRef,
  state,
  dispatch,
  captureHistory,
  pendingLayerLabelRef,
}: UseClipboardOptions): UseClipboardReturn {

  const handleCopy = useCallback((): void => {
    const activeId = state.activeLayerId
    if (!activeId) return
    const pixels = canvasHandleRef.current?.getLayerPixels(activeId)
    if (!pixels) return
    const { width, height } = state.canvas

    // Apply selection mask: scale alpha by selection strength (supports feathered edges)
    if (selectionStore.mask) {
      for (let i = 0; i < selectionStore.mask.length; i++) {
        pixels[i * 4 + 3] = Math.round(pixels[i * 4 + 3] * selectionStore.mask[i] / 255)
      }
    }

    // Tight bounding box around non-transparent pixels
    let minX = width, minY = height, maxX = -1, maxY = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] > 0) {
          if (x < minX) minX = x; if (x > maxX) maxX = x
          if (y < minY) minY = y; if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return // fully transparent — nothing to copy

    const bboxW    = maxX - minX + 1
    const bboxH    = maxY - minY + 1
    const bboxData = new Uint8Array(bboxW * bboxH * 4)
    for (let y = 0; y < bboxH; y++) {
      for (let x = 0; x < bboxW; x++) {
        const si = ((minY + y) * width + (minX + x)) * 4
        const di = (y * bboxW + x) * 4
        bboxData[di]     = pixels[si]
        bboxData[di + 1] = pixels[si + 1]
        bboxData[di + 2] = pixels[si + 2]
        bboxData[di + 3] = pixels[si + 3]
      }
    }
    clipboardStore.current = { data: bboxData, width: bboxW, height: bboxH, offsetX: minX, offsetY: minY }
  }, [state.activeLayerId, state.canvas, canvasHandleRef])

  const handleCut = useCallback((): void => {
    const activeId = state.activeLayerId
    if (!activeId) return
    handleCopy()
    const totalPixels = state.canvas.width * state.canvas.height
    const mask        = selectionStore.mask ?? new Uint8Array(totalPixels).fill(255)
    canvasHandleRef.current?.clearLayerPixels(activeId, mask)
    captureHistory('Cut')
  }, [state.activeLayerId, state.canvas, handleCopy, captureHistory, canvasHandleRef])

  const handleDelete = useCallback((): void => {
    const activeId = state.activeLayerId
    if (!activeId) return
    const totalPixels = state.canvas.width * state.canvas.height
    const mask        = selectionStore.mask ?? new Uint8Array(totalPixels).fill(255)
    canvasHandleRef.current?.clearLayerPixels(activeId, mask)
    captureHistory('Delete')
  }, [state.activeLayerId, state.canvas, captureHistory, canvasHandleRef])

  const handlePaste = useCallback((): void => {
    const clip = clipboardStore.current
    if (!clip) return
    const { width: dstW, height: dstH }          = state.canvas
    const { data: srcData, width: srcW, height: srcH, offsetX, offsetY } = clip

    const layerData = new Uint8Array(dstW * dstH * 4)
    for (let sy = 0; sy < srcH; sy++) {
      const dy = offsetY + sy
      if (dy < 0 || dy >= dstH) continue
      for (let sx = 0; sx < srcW; sx++) {
        const dx = offsetX + sx
        if (dx < 0 || dx >= dstW) continue
        const si = (sy * srcW + sx) * 4
        const di = (dy * dstW + dx) * 4
        layerData[di]     = srcData[si]
        layerData[di + 1] = srcData[si + 1]
        layerData[di + 2] = srcData[si + 2]
        layerData[di + 3] = srcData[si + 3]
      }
    }
    const newId = makeTabId()
    canvasHandleRef.current?.prepareNewLayer(newId, 'Paste', layerData)
    pendingLayerLabelRef.current = 'Paste'
    dispatch({ type: 'ADD_LAYER', payload: { id: newId, name: 'Paste', visible: true, opacity: 1, locked: false, blendMode: 'normal' } })
  }, [state.canvas, dispatch, canvasHandleRef, pendingLayerLabelRef])

  return { handleCopy, handleCut, handlePaste, handleDelete }
}
