import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { AppState } from '@/types'
import type { CanvasHandle } from '@/components/window/Canvas/Canvas'
import { objectSelectionStore } from '@/store/objectSelectionStore'
import { objectSelectionCallbacks, objectSelectionOptions } from '../tools/objectSelection'
import { selectionStore } from '@/store/selectionStore'
import type { SelectionMode } from '@/store/selectionStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseObjectSelectionParams {
  canvasHandleRef: { readonly current: CanvasHandle | null }
  stateRef: MutableRefObject<AppState>
  captureHistory: (label: string) => void
  activeTabId: string
  layers: AppState['layers']
}

// ─── Canvas pixel helpers ─────────────────────────────────────────────────────

async function downsampleTo1024(
  rgba: Uint8Array,
  srcWidth: number,
  srcHeight: number,
): Promise<Uint8Array> {
  // Standard SAM preprocessing: resize longest side to 1024, preserve aspect ratio,
  // zero-pad the shorter dimension. Coordinates in sam.ts are scaled the same way.
  const scale = 1024 / Math.max(srcWidth, srcHeight)
  const dstW = Math.round(srcWidth * scale)
  const dstH = Math.round(srcHeight * scale)
  const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), srcWidth, srcHeight)
  const bmp = await createImageBitmap(imgData, {
    resizeWidth: dstW,
    resizeHeight: dstH,
    resizeQuality: 'medium',
  })
  // OffscreenCanvas is zero-initialized (black), so the padded area stays 0
  const oc = new OffscreenCanvas(1024, 1024)
  oc.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  const out = oc.getContext('2d')!.getImageData(0, 0, 1024, 1024)
  return new Uint8Array(out.data.buffer)
}

async function upsampleMask(
  mask256: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
): Promise<Uint8Array> {
  // The decoder returns a 256×256 mask in the *padded* 1024×1024 space.
  // Only the top-left region corresponding to the actual (non-padded) image
  // contains real content. Crop to that region before upsampling.
  const scale = 1024 / Math.max(canvasWidth, canvasHeight)
  const dstW = Math.round(canvasWidth * scale)
  const dstH = Math.round(canvasHeight * scale)
  // 256 = 1024/4, so the content occupies [0, 0, dstW/4, dstH/4] in mask space
  const cropW = Math.max(1, Math.round(dstW / 4))
  const cropH = Math.max(1, Math.round(dstH / 4))

  const rgba256 = new Uint8ClampedArray(256 * 256 * 4)
  for (let i = 0; i < 256 * 256; i++) {
    rgba256[i * 4 + 0] = mask256[i]
    rgba256[i * 4 + 1] = mask256[i]
    rgba256[i * 4 + 2] = mask256[i]
    rgba256[i * 4 + 3] = 255
  }
  // Crop to the non-padded region, then resize to canvas dimensions
  const bmp = await createImageBitmap(
    new ImageData(rgba256, 256, 256),
    0, 0, cropW, cropH,
    { resizeWidth: canvasWidth, resizeHeight: canvasHeight, resizeQuality: 'medium' },
  )
  const oc = new OffscreenCanvas(canvasWidth, canvasHeight)
  oc.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  const px = oc.getContext('2d')!.getImageData(0, 0, canvasWidth, canvasHeight)
  const out = new Uint8Array(canvasWidth * canvasHeight)
  for (let i = 0; i < out.length; i++) out[i] = px.data[i * 4]
  return out
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useObjectSelection({
  canvasHandleRef,
  stateRef,
  captureHistory,
  activeTabId,
  layers,
}: UseObjectSelectionParams): { invalidateSamCache: () => void } {
  // ── Stable refs ────────────────────────────────────────────────────────────
  const captureHistoryRef = useRef(captureHistory)
  captureHistoryRef.current = captureHistory

  /** Saved selection mask before this session started (for non-'set' commit modes). */
  const savedMaskRef = useRef<Uint8Array | null>(null)
  const hasSavedMaskRef = useRef(false)

  /** Cache version we last encoded for. */
  const encodedCacheVersionRef = useRef(-1)

  /** Prevent concurrent inference runs. */
  const isRunningRef = useRef(false)

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Cache invalidation ─────────────────────────────────────────────────────

  const invalidateSamCache = useCallback((): void => {
    objectSelectionStore.invalidateCache()
    void window.api.sam.invalidateCache()
  }, [])

  // Reset session when tab changes
  const prevTabIdRef = useRef(activeTabId)
  useEffect(() => {
    if (activeTabId !== prevTabIdRef.current) {
      prevTabIdRef.current = activeTabId
      hasSavedMaskRef.current = false
      savedMaskRef.current = null
      objectSelectionStore.reset()
      invalidateSamCache()
    }
  }, [activeTabId, invalidateSamCache])

  // Invalidate when layer content changes
  const prevLayersRef = useRef(layers)
  useEffect(() => {
    if (layers !== prevLayersRef.current) {
      prevLayersRef.current = layers
      invalidateSamCache()
    }
  }, [layers, invalidateSamCache])

  // ── Model check on mount ───────────────────────────────────────────────────

  useEffect(() => {
    objectSelectionStore.modelStatus = 'checking'
    objectSelectionStore.notify()
    window.api.sam
      .checkModel()
      .then((status) => {
        objectSelectionStore.modelStatus =
          status.encoderReady && status.decoderReady ? 'ready' : 'error'
        objectSelectionStore.notify()
      })
      .catch(() => {
        objectSelectionStore.modelStatus = 'error'
        objectSelectionStore.notify()
      })
  }, [])

  // ── Core inference pipeline ────────────────────────────────────────────────

  const runInference = useCallback(async (): Promise<void> => {
    if (isRunningRef.current) return
    const handle = canvasHandleRef.current
    if (!handle) return

    const { canvas: { width, height } } = stateRef.current

    // Save original selection before first inference in this session
    if (!hasSavedMaskRef.current) {
      savedMaskRef.current = selectionStore.mask ? new Uint8Array(selectionStore.mask) : null
      hasSavedMaskRef.current = true
    }

    isRunningRef.current = true
    objectSelectionStore.inferenceStatus = 'running'
    objectSelectionStore.notify()

    try {
      // Encode image if cache is stale
      if (encodedCacheVersionRef.current !== objectSelectionStore.cacheVersion) {
        const { data: rgba, width: rw, height: rh } = await handle.rasterizeComposite('sample')
        const data1024 = await downsampleTo1024(rgba, rw, rh)
        await window.api.sam.encodeImage(data1024, width, height)
        encodedCacheVersionRef.current = objectSelectionStore.cacheVersion
      }

      const store = objectSelectionStore
      const decodeResult = await window.api.sam.decodeMask({
        embeddings: null,
        points: store.points,
        box: store.promptMode === 'rect' ? store.dragRect : null,
        origWidth: width,
        origHeight: height,
      })

      const upsampled = await upsampleMask(new Uint8Array(decodeResult.mask), width, height)
      objectSelectionStore.pendingMask = upsampled

      // Show as live preview (always 'set' mode during session)
      const { feather, antiAlias } = objectSelectionOptions
      selectionStore.setFromSAMMask(upsampled, 'set', feather, antiAlias)

      objectSelectionStore.inferenceStatus = 'idle'
      objectSelectionStore.notify()
    } catch (err) {
      console.error('[ObjectSelection] Inference failed:', err)
      objectSelectionStore.inferenceStatus = 'error'
      objectSelectionStore.notify()
    } finally {
      isRunningRef.current = false
    }
  }, [canvasHandleRef, stateRef])

  // ── Select Subject ─────────────────────────────────────────────────────────

  const runSelectSubject = useCallback(async (): Promise<void> => {
    if (isRunningRef.current) return
    const handle = canvasHandleRef.current
    if (!handle) return

    const { canvas: { width, height } } = stateRef.current

    if (!hasSavedMaskRef.current) {
      savedMaskRef.current = selectionStore.mask ? new Uint8Array(selectionStore.mask) : null
      hasSavedMaskRef.current = true
    }

    isRunningRef.current = true
    objectSelectionStore.inferenceStatus = 'running'
    objectSelectionStore.notify()

    try {
      if (encodedCacheVersionRef.current !== objectSelectionStore.cacheVersion) {
        const { data: rgba, width: rw, height: rh } = await handle.rasterizeComposite('sample')
        const data1024 = await downsampleTo1024(rgba, rw, rh)
        await window.api.sam.encodeImage(data1024, width, height)
        encodedCacheVersionRef.current = objectSelectionStore.cacheVersion
      }

      // Use canvas center as implicit positive point for subject detection
      const centerPoint = { x: width / 2, y: height / 2, positive: true }

      const decodeResult = await window.api.sam.decodeMask({
        embeddings: null,
        points: [centerPoint],
        box: null,
        origWidth: width,
        origHeight: height,
      })

      const upsampled = await upsampleMask(new Uint8Array(decodeResult.mask), width, height)
      objectSelectionStore.pendingMask = upsampled

      const { feather, antiAlias } = objectSelectionOptions
      selectionStore.setFromSAMMask(upsampled, 'set', feather, antiAlias)

      objectSelectionStore.inferenceStatus = 'idle'
      objectSelectionStore.notify()
    } catch (err) {
      console.error('[ObjectSelection] Select Subject failed:', err)
      objectSelectionStore.inferenceStatus = 'error'
      objectSelectionStore.notify()
    } finally {
      isRunningRef.current = false
    }
  }, [canvasHandleRef, stateRef])

  // ── Commit and Cancel ──────────────────────────────────────────────────────

  const commitSelection = useCallback((mode: SelectionMode): void => {
    const pending = objectSelectionStore.pendingMask
    if (!pending) return

    const { feather, antiAlias } = objectSelectionOptions

    // Restore the original selection, then apply new mask with the chosen mode
    if (savedMaskRef.current !== null) {
      selectionStore.restoreMask(savedMaskRef.current)
    } else {
      selectionStore.clear()
    }
    selectionStore.setFromSAMMask(pending, mode, feather, antiAlias)

    captureHistoryRef.current('Object Selection')

    hasSavedMaskRef.current = false
    savedMaskRef.current = null
    objectSelectionStore.reset()
  }, [])

  const cancelSelection = useCallback((): void => {
    if (savedMaskRef.current !== null) {
      selectionStore.restoreMask(savedMaskRef.current)
    } else {
      selectionStore.clear()
    }
    hasSavedMaskRef.current = false
    savedMaskRef.current = null
    objectSelectionStore.reset()
  }, [])

  const downloadModel = useCallback(async (): Promise<void> => {
    objectSelectionStore.modelStatus = 'downloading'
    objectSelectionStore.downloadProgress = null
    objectSelectionStore.modelError = null
    objectSelectionStore.notify()

    const unsubscribe = window.api.sam.onDownloadProgress((p) => {
      objectSelectionStore.downloadProgress = p
      objectSelectionStore.notify()
    })

    try {
      const result = await window.api.sam.downloadModel()
      if ('error' in result) {
        objectSelectionStore.modelStatus = 'error'
        objectSelectionStore.modelError = result.error
      } else {
        objectSelectionStore.modelStatus = 'ready'
        objectSelectionStore.downloadProgress = null
      }
    } catch (err) {
      objectSelectionStore.modelStatus = 'error'
      objectSelectionStore.modelError = err instanceof Error ? err.message : String(err)
    } finally {
      unsubscribe()
      objectSelectionStore.notify()
    }
  }, [])

  // ── Wire module-level callbacks (called by the Options UI) ─────────────────

  useEffect(() => {
    objectSelectionCallbacks.commit = commitSelection
    objectSelectionCallbacks.cancel = cancelSelection
    objectSelectionCallbacks.downloadModel = () => { void downloadModel() }
    objectSelectionCallbacks.runSubject = () => { void runSelectSubject() }
    return () => {
      objectSelectionCallbacks.commit = () => {}
      objectSelectionCallbacks.cancel = () => {}
      objectSelectionCallbacks.downloadModel = () => {}
      objectSelectionCallbacks.runSubject = () => {}
    }
  }, [commitSelection, cancelSelection, downloadModel, runSelectSubject])

  // ── Store subscription → trigger inference ─────────────────────────────────

  const runInferenceRef = useRef(runInference)
  runInferenceRef.current = runInference

  useEffect(() => {
    let prevPointCount = objectSelectionStore.points.length
    let prevIsDragging = objectSelectionStore.isDragging

    const onStoreChange = (): void => {
      const store = objectSelectionStore
      if (store.modelStatus !== 'ready') return

      if (store.promptMode === 'rect') {
        const dragEnded = prevIsDragging && !store.isDragging && store.dragRect !== null
        prevIsDragging = store.isDragging
        if (dragEnded) {
          void runInferenceRef.current()
        }
      } else {
        const pointAdded = store.points.length > prevPointCount
        prevPointCount = store.points.length
        if (pointAdded || store.points.length > 0) {
          if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
          if (store.points.length > 0) {
            debounceTimerRef.current = setTimeout(() => {
              void runInferenceRef.current()
            }, 300)
          }
        }
      }
    }

    objectSelectionStore.subscribe(onStoreChange)
    return () => {
      objectSelectionStore.unsubscribe(onStoreChange)
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [])

  // ── Keyboard handling (capture phase so Escape/Enter/Backspace don't bubble) ─

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (stateRef.current.activeTool !== 'object-selection') return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'Escape') {
        e.stopPropagation()
        cancelSelection()
        return
      }

      if (e.key === 'Enter') {
        e.stopPropagation()
        e.preventDefault()
        commitSelection(objectSelectionOptions.mode)
        return
      }

      if ((e.key === 'Backspace' || e.key === 'Delete') &&
          objectSelectionStore.promptMode === 'point') {
        e.stopPropagation()
        e.preventDefault()
        if (objectSelectionStore.points.length > 0) {
          objectSelectionStore.removeLastPoint()
          // Inference re-triggered via store subscription (debounced)
        }
        return
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [cancelSelection, commitSelection])

  return { invalidateSamCache }
}
