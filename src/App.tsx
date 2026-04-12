import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AppProvider } from '@/store/AppContext'
import { CanvasProvider } from '@/store/CanvasContext'
import { selectionStore } from '@/store/selectionStore'
import { clipboardStore } from '@/store/clipboardStore'
import { historyStore } from '@/store/historyStore'
import type { HistoryEntry } from '@/store/historyStore'
import { cropStore } from '@/store/cropStore'
import { TopBar } from '@/components/window/TopBar/TopBar'
import { ToolOptionsBar } from '@/components/window/ToolOptionsBar/ToolOptionsBar'
import { TabBar } from '@/components/window/TabBar/TabBar'
import type { TabInfo } from '@/components/window/TabBar/TabBar'
import { Toolbar } from '@/components/window/Toolbar/Toolbar'
import { Canvas } from '@/components/window/Canvas/Canvas'
import type { CanvasHandle } from '@/components/window/Canvas/Canvas'
import { RightPanel } from '@/components/window/RightPanel/RightPanel'
import { StatusBar } from '@/components/window/StatusBar/StatusBar'
import { NewImageDialog } from '@/components/dialogs/NewImageDialog/NewImageDialog'
import { ExportDialog } from '@/components/dialogs/ExportDialog/ExportDialog'
import type { ExportSettings } from '@/components/dialogs/ExportDialog/ExportDialog'
import { ResizeImageDialog } from '@/components/dialogs/ResizeImageDialog/ResizeImageDialog'
import type { ResizeImageSettings } from '@/components/dialogs/ResizeImageDialog/ResizeImageDialog'
import { ResizeCanvasDialog } from '@/components/dialogs/ResizeCanvasDialog/ResizeCanvasDialog'
import type { ResizeCanvasSettings } from '@/components/dialogs/ResizeCanvasDialog/ResizeCanvasDialog'
import { resizeBilinear, resizeNearest } from '@/wasm'
import { useAppContext } from '@/store/AppContext'
import type { LayerState, BackgroundFill } from '@/types'
import { exportPng } from '@/export/exportPng'
import { exportJpeg } from '@/export/exportJpeg'
import { exportWebp } from '@/export/exportWebp'
import styles from './App.module.scss'

// ─── Tab types ────────────────────────────────────────────────────────────────

interface TabSnapshot {
  canvasWidth: number
  canvasHeight: number
  backgroundFill: BackgroundFill
  layers: LayerState[]
  activeLayerId: string | null
  zoom: number
}

interface TabRecord {
  id: string
  title: string
  filePath: string | null
  snapshot: TabSnapshot
  /** Pixel data for each layer — null while tab is active (data lives in WebGL) */
  savedLayerData: Map<string, string> | null
  /** History stack — null while tab is active (historyStore holds the live data) */
  savedHistory: { entries: HistoryEntry[]; currentIndex: number } | null
}

function makeTabId(): string { return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}` }
function fileTitle(p: string): string { return p.split(/[\\/]/).pop() ?? 'Untitled' }

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const EXT_TO_MIME: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.bmp':  'image/bmp',
}
function loadImagePixels(dataUrl: string): Promise<{ data: Uint8Array; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const tmp = document.createElement('canvas')
      tmp.width = img.naturalWidth
      tmp.height = img.naturalHeight
      const ctx = tmp.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve({
        data: new Uint8Array(ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data.buffer),
        width: img.naturalWidth,
        height: img.naturalHeight,
      })
    }
    img.onerror = () => reject(new Error('Failed to decode image'))
    img.src = dataUrl
  })
}

const INITIAL_SNAPSHOT: TabSnapshot = {
  canvasWidth: 512, canvasHeight: 512, backgroundFill: 'white',
  layers: [{ id: 'layer-0', name: 'Background', visible: true, opacity: 1, locked: false, blendMode: 'normal' }],
  activeLayerId: 'layer-0', zoom: 1
}

// ─── AppContent ───────────────────────────────────────────────────────────────

function AppContent(): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const canvasHandleRef = useRef<CanvasHandle>(null)

  // ── History ─────────────────────────────────────────────────────────────
  const stateRef = useRef(state)
  stateRef.current = state
  const isRestoringRef = useRef(false)
  const suppressReadyCaptureRef = useRef(false)
  const pendingLayerLabelRef = useRef<string | null>(null)
  const prevLayersRef = useRef(state.layers)

  const captureHistory = useCallback((label: string): void => {
    if (isRestoringRef.current) return
    if (suppressReadyCaptureRef.current) {
      suppressReadyCaptureRef.current = false
      return
    }
    const layerPixels = canvasHandleRef.current?.captureAllLayerPixels()
    if (!layerPixels || layerPixels.size === 0) return
    const s = stateRef.current
    historyStore.push({
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label,
      timestamp: Date.now(),
      layerPixels,
      layerState: s.layers,
      activeLayerId: s.activeLayerId,
      canvasWidth: s.canvas.width,
      canvasHeight: s.canvas.height,
    })
  }, [])

  useEffect(() => {
    historyStore.onPreview = (index: number): void => {
      const entry = historyStore.entries[index]
      if (!entry) return
      // Don't try to preview entries with different canvas dimensions — the
      // pixel buffers would have the wrong size and corrupt the display.
      if (
        entry.canvasWidth !== stateRef.current.canvas.width ||
        entry.canvasHeight !== stateRef.current.canvas.height
      ) return
      canvasHandleRef.current?.restoreAllLayerPixels(entry.layerPixels)
    }
    return () => { historyStore.onPreview = null }
  }, [])

  useEffect(() => {
    historyStore.onJumpTo = (index: number): void => {
      const entry = historyStore.entries[index]
      if (!entry) return
      isRestoringRef.current = true
      const currentW = stateRef.current.canvas.width
      const currentH = stateRef.current.canvas.height

      if (entry.canvasWidth !== currentW || entry.canvasHeight !== currentH) {
        // The target state has different canvas dimensions — we must remount the
        // Canvas (same path as resize/crop). Encode the snapshot pixels as PNGs
        // so the new Canvas initializer can load them.
        const encoded = new Map<string, string>()
        for (const [id, pixels] of entry.layerPixels) {
          const tmp = document.createElement('canvas')
          tmp.width = entry.canvasWidth; tmp.height = entry.canvasHeight
          const ctx2d = tmp.getContext('2d')!
          ctx2d.putImageData(
            new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), entry.canvasWidth, entry.canvasHeight),
            0, 0
          )
          encoded.set(id, tmp.toDataURL('image/png'))
        }
        // Suppress the onReady 'Initial State' capture — history is already correct.
        suppressReadyCaptureRef.current = true
        setPendingLayerData(encoded)
        dispatch({
          type: 'RESTORE_TAB',
          payload: {
            width: entry.canvasWidth,
            height: entry.canvasHeight,
            backgroundFill: stateRef.current.canvas.backgroundFill,
            layers: entry.layerState,
            activeLayerId: entry.activeLayerId,
            zoom: stateRef.current.canvas.zoom,
          },
        })
      } else {
        // Same canvas size — fast path: swap pixels in-place.
        canvasHandleRef.current?.restoreAllLayerPixels(entry.layerPixels)
        dispatch({
          type: 'RESTORE_LAYERS',
          payload: {
            layers: entry.layerState,
            activeLayerId: entry.activeLayerId,
          },
        })
      }

      historyStore.setCurrent(index)
      setTimeout(() => { isRestoringRef.current = false }, 200)
    }
    return () => { historyStore.onJumpTo = null }
  }, [dispatch])

  useEffect(() => {
    if (isRestoringRef.current) {
      prevLayersRef.current = state.layers
      isRestoringRef.current = false
      return
    }
    const prev = prevLayersRef.current
    const curr = state.layers
    if (prev !== curr) {
      if (curr.length > prev.length) {
        captureHistory(pendingLayerLabelRef.current ?? 'New Layer')
        pendingLayerLabelRef.current = null
      } else if (curr.length < prev.length) {
        captureHistory('Delete Layer')
      }
      prevLayersRef.current = curr
    }
  }, [state.layers, captureHistory])

  const [untitledCounter, setUntitledCounter] = useState(1)
  const [showNewImageDialog, setShowNewImageDialog] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [showResizeDialog, setShowResizeDialog] = useState(false)
  const [showResizeCanvasDialog, setShowResizeCanvasDialog] = useState(false)
  const [pendingLayerData, setPendingLayerData] = useState<Map<string, string> | null>(null)

  const initialTabId = useRef(makeTabId()).current
  const [tabs, setTabs] = useState<TabRecord[]>([{
    id: initialTabId,
    title: 'Untitled-1',
    filePath: null,
    snapshot: INITIAL_SNAPSHOT,
    savedLayerData: null,
    savedHistory: null,
  }])
  const [activeTabId, setActiveTabId] = useState(initialTabId)

  // ── Helpers ───────────────────────────────────────────────────────
  const captureActiveSnapshot = useCallback((): TabSnapshot => ({
    canvasWidth: state.canvas.width,
    canvasHeight: state.canvas.height,
    backgroundFill: state.canvas.backgroundFill,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    zoom: state.canvas.zoom,
  }), [state])

  const captureActiveLayerData = useCallback((): Map<string, string> => {
    const map = new Map<string, string>()
    for (const layer of state.layers) {
      const png = canvasHandleRef.current?.exportLayerPng(layer.id)
      if (png) map.set(layer.id, png)
    }
    return map
  }, [state.layers])

  // ── Switch tab ────────────────────────────────────────────────────
  const switchToTab = useCallback((toId: string, tabs_: TabRecord[]): void => {
    const toTab = tabs_.find(t => t.id === toId)
    if (!toTab) return
    const data = toTab.savedLayerData
    setPendingLayerData(data)
    setActiveTabId(toId)
    // Restore this tab's history (suppress the onReady 'Initial State' push if
    // there are already entries to restore)
    if (toTab.savedHistory && toTab.savedHistory.entries.length > 0) {
      suppressReadyCaptureRef.current = true
      historyStore.restore(toTab.savedHistory.entries, toTab.savedHistory.currentIndex)
    } else {
      historyStore.clear()
    }
    dispatch({
      type: 'RESTORE_TAB',
      payload: {
        width: toTab.snapshot.canvasWidth,
        height: toTab.snapshot.canvasHeight,
        backgroundFill: toTab.snapshot.backgroundFill,
        layers: toTab.snapshot.layers,
        activeLayerId: toTab.snapshot.activeLayerId,
        zoom: toTab.snapshot.zoom,
      }
    })
  }, [dispatch])

  const handleSwitchTab = useCallback((toId: string): void => {
    if (toId === activeTabId) return
    const snapshot = captureActiveSnapshot()
    const layerData = captureActiveLayerData()
    const savedHistory = {
      entries: historyStore.entries.slice(),
      currentIndex: historyStore.currentIndex,
    }
    const updated = tabs.map(t =>
      t.id === activeTabId ? { ...t, snapshot, savedLayerData: layerData, savedHistory } : t
    )
    setTabs(updated)
    switchToTab(toId, updated)
  }, [activeTabId, tabs, captureActiveSnapshot, captureActiveLayerData, switchToTab])

  // ── Close tab ─────────────────────────────────────────────────────
  const handleCloseTab = useCallback((tabId: string): void => {
    if (tabs.length === 1) return // never close the last tab
    const idx = tabs.findIndex(t => t.id === tabId)
    const next = tabs.filter(t => t.id !== tabId)
    setTabs(next)
    if (tabId === activeTabId) {
      const fallback = next[Math.min(idx, next.length - 1)]
      switchToTab(fallback.id, next)
    }
  }, [tabs, activeTabId, switchToTab])

  // ── New ───────────────────────────────────────────────────────────
  const handleNewConfirm = useCallback(({ width, height, backgroundFill }: { width: number; height: number; backgroundFill: BackgroundFill }): void => {
    const snapshot = captureActiveSnapshot()
    const layerData = captureActiveLayerData()
    const savedHistory = {
      entries: historyStore.entries.slice(),
      currentIndex: historyStore.currentIndex,
    }
    const n = untitledCounter
    setUntitledCounter(n + 1)
    const newId = makeTabId()
    const newSnapshot: TabSnapshot = {
      canvasWidth: width, canvasHeight: height, backgroundFill,
      layers: [{ id: 'layer-0', name: 'Background', visible: true, opacity: 1, locked: false, blendMode: 'normal' }],
      activeLayerId: 'layer-0', zoom: 1,
    }
    const updated: TabRecord[] = [
      ...tabs.map(t => t.id === activeTabId ? { ...t, snapshot, savedLayerData: layerData, savedHistory } : t),
      { id: newId, title: `Untitled-${n + 1}`, filePath: null, snapshot: newSnapshot, savedLayerData: null, savedHistory: null }
    ]
    setTabs(updated)
    setActiveTabId(newId)
    historyStore.clear()
    setPendingLayerData(null)
    dispatch({ type: 'NEW_CANVAS', payload: { width, height, backgroundFill } })
    setShowNewImageDialog(false)
  }, [tabs, activeTabId, untitledCounter, captureActiveSnapshot, captureActiveLayerData, dispatch])

  // ── Open ──────────────────────────────────────────────────────────
  const handleOpen = useCallback(async (): Promise<void> => {
    const path = await window.api.openPxshopDialog()
    if (!path) return

    // ── Image file import ──────────────────────────────────────────────────
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
    if (IMAGE_EXTENSIONS.has(ext)) {
      const base64 = await window.api.readFileBase64(path)
      const mime = EXT_TO_MIME[ext] ?? 'image/png'
      const { data, width, height } = await loadImagePixels(`data:${mime};base64,${base64}`)
      const layerId = 'layer-0'
      const tmp = document.createElement('canvas')
      tmp.width = width; tmp.height = height
      const ctx2d = tmp.getContext('2d')!
      ctx2d.putImageData(new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), width, height), 0, 0)
      const layerData = new Map([[layerId, tmp.toDataURL('image/png')]])
      const layers: LayerState[] = [{ id: layerId, name: 'Background', visible: true, opacity: 1, locked: false, blendMode: 'normal' }]
      const title = fileTitle(path)
      const newSnapshot: TabSnapshot = {
        canvasWidth: width, canvasHeight: height, backgroundFill: 'transparent',
        layers, activeLayerId: layerId, zoom: 1,
      }
      const snapshot = captureActiveSnapshot()
      const currentLayerData = captureActiveLayerData()
      const savedHistory = { entries: historyStore.entries.slice(), currentIndex: historyStore.currentIndex }
      const newId = makeTabId()
      const updated: TabRecord[] = [
        ...tabs.map(t => t.id === activeTabId ? { ...t, snapshot, savedLayerData: currentLayerData, savedHistory } : t),
        { id: newId, title, filePath: null, snapshot: newSnapshot, savedLayerData: null, savedHistory: null }
      ]
      setTabs(updated)
      setActiveTabId(newId)
      historyStore.clear()
      setPendingLayerData(layerData)
      dispatch({ type: 'RESTORE_TAB', payload: { width, height, backgroundFill: 'transparent', layers, activeLayerId: layerId, zoom: 1 } })
      return
    }

    // Already open? Just switch.
    const existing = tabs.find(t => t.filePath === path)
    if (existing) { handleSwitchTab(existing.id); return }

    const json = await window.api.openPxshopFile(path)
    const doc = JSON.parse(json) as {
      version: number
      canvas: { width: number; height: number; backgroundFill?: BackgroundFill }
      activeLayerId: string | null
      layers: Array<LayerState & { pngData?: string | null }>
    }

    const layerData = new Map<string, string>()
    const layers: LayerState[] = doc.layers.map(({ pngData, ...meta }) => {
      if (pngData) layerData.set(meta.id, pngData)
      return meta
    })
    const title = fileTitle(path)
    const bg = doc.canvas.backgroundFill ?? 'transparent'
    const newSnapshot: TabSnapshot = {
      canvasWidth: doc.canvas.width, canvasHeight: doc.canvas.height, backgroundFill: bg,
      layers, activeLayerId: doc.activeLayerId ?? layers[0]?.id ?? null, zoom: 1,
    }

    const snapshot = captureActiveSnapshot()
    const currentLayerData = captureActiveLayerData()
    const savedHistory = {
      entries: historyStore.entries.slice(),
      currentIndex: historyStore.currentIndex,
    }
    const newId = makeTabId()
    const updated: TabRecord[] = [
      ...tabs.map(t => t.id === activeTabId ? { ...t, snapshot, savedLayerData: currentLayerData, savedHistory } : t),
      { id: newId, title, filePath: path, snapshot: newSnapshot, savedLayerData: null, savedHistory: null }
    ]
    setTabs(updated)
    setActiveTabId(newId)
    historyStore.clear()
    setPendingLayerData(layerData)
    dispatch({
      type: 'RESTORE_TAB',
      payload: { width: doc.canvas.width, height: doc.canvas.height, backgroundFill: bg, layers, activeLayerId: newSnapshot.activeLayerId, zoom: 1 }
    })
  }, [tabs, activeTabId, captureActiveSnapshot, captureActiveLayerData, handleSwitchTab, dispatch])

  // ── Save ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async (saveAs = false): Promise<void> => {
    const activeTab = tabs.find(t => t.id === activeTabId)
    let path = saveAs ? null : (activeTab?.filePath ?? null)
    if (!path) {
      path = await window.api.savePxshopDialog(activeTab?.filePath ?? undefined)
      if (!path) return
    }

    const layerPngs: Record<string, string> = {}
    for (const layer of state.layers) {
      const png = canvasHandleRef.current?.exportLayerPng(layer.id)
      if (png) layerPngs[layer.id] = png
    }

    const doc = {
      version: 1,
      canvas: { width: state.canvas.width, height: state.canvas.height, backgroundFill: state.canvas.backgroundFill },
      activeLayerId: state.activeLayerId,
      layers: state.layers.map((l) => ({ ...l, pngData: layerPngs[l.id] ?? null }))
    }
    await window.api.savePxshopFile(path, JSON.stringify(doc))

    const title = fileTitle(path)
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, filePath: path, title } : t))
  }, [tabs, activeTabId, state])

  // ── Clipboard ──────────────────────────────────────────────────────
  const handleCopy = useCallback((): void => {
    const activeId = state.activeLayerId
    if (!activeId) return
    const pixels = canvasHandleRef.current?.getLayerPixels(activeId)
    if (!pixels) return
    const { width, height } = state.canvas
    // Apply mask: scale alpha by selection strength (0–255), supports feathered edges
    if (selectionStore.mask) {
      for (let i = 0; i < selectionStore.mask.length; i++) {
        pixels[i * 4 + 3] = Math.round(pixels[i * 4 + 3] * selectionStore.mask[i] / 255)
      }
    }
    // Compute tight bounding box of non-transparent pixels so the clipboard
    // data is canvas-size-independent and can be pasted anywhere.
    let minX = width, minY = height, maxX = -1, maxY = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] > 0) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return // fully transparent — nothing to copy
    const bboxW = maxX - minX + 1
    const bboxH = maxY - minY + 1
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
  }, [state.activeLayerId, state.canvas])

  const handleCut = useCallback((): void => {
    const activeId = state.activeLayerId
    if (!activeId) return
    handleCopy()
    const totalPixels = state.canvas.width * state.canvas.height
    const mask = selectionStore.mask ?? new Uint8Array(totalPixels).fill(255)
    canvasHandleRef.current?.clearLayerPixels(activeId, mask)
    captureHistory('Cut')
  }, [state.activeLayerId, state.canvas, handleCopy, captureHistory])

  const handleDelete = useCallback((): void => {
    const activeId = state.activeLayerId
    if (!activeId) return
    const totalPixels = state.canvas.width * state.canvas.height
    const mask = selectionStore.mask ?? new Uint8Array(totalPixels).fill(255)
    canvasHandleRef.current?.clearLayerPixels(activeId, mask)
    captureHistory('Delete')
  }, [state.activeLayerId, state.canvas, captureHistory])

  const handlePaste = useCallback((): void => {
    const clip = clipboardStore.current
    if (!clip) return
    const { width: dstW, height: dstH } = state.canvas
    // Composite the bounding-box clipboard content into a destination-canvas-
    // sized buffer. This works regardless of source / destination canvas size.
    const layerData = new Uint8Array(dstW * dstH * 4)
    const { data: srcData, width: srcW, height: srcH, offsetX, offsetY } = clip
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
    dispatch({
      type: 'ADD_LAYER',
      payload: { id: newId, name: 'Paste', visible: true, opacity: 1, locked: false, blendMode: 'normal' }
    })
  }, [state.canvas, dispatch])

  const handleUndo = useCallback((): void => { historyStore.undo() }, [])
  const handleRedo = useCallback((): void => { historyStore.redo() }, [])

  const handleResizeImage = useCallback(async (settings: ResizeImageSettings): Promise<void> => {
    setShowResizeDialog(false)
    const { width: newW, height: newH, filter } = settings
    const oldW = state.canvas.width
    const oldH = state.canvas.height
    if (newW === oldW && newH === oldH) return

    const resizeFn = filter === 'nearest' ? resizeNearest : resizeBilinear
    const handle = canvasHandleRef.current
    if (!handle) return

    try {
      // Resize every layer's pixel data and encode to PNG in one pass
      const layerPixels = handle.captureAllLayerPixels()
      const encoded = new Map<string, string>()
      for (const [id, pixels] of layerPixels) {
        const resized = await resizeFn(pixels, oldW, oldH, newW, newH)
        const tmp = document.createElement('canvas')
        tmp.width = newW; tmp.height = newH
        const ctx2d = tmp.getContext('2d')!
        ctx2d.putImageData(new ImageData(new Uint8ClampedArray(resized.buffer as ArrayBuffer), newW, newH), 0, 0)
        encoded.set(id, tmp.toDataURL('image/png'))
      }

      // Capture pre-op state so the user can undo this resize
      captureHistory('Before Resize Image')
      // Set pendingLayerData BEFORE dispatching so Canvas reads it on remount
      setPendingLayerData(encoded)
      pendingLayerLabelRef.current = 'Resize Image'
      dispatch({ type: 'RESIZE_CANVAS', payload: { width: newW, height: newH } })
    } catch (err) {
      console.error('[Resize] Failed to resize image:', err)
    }
  }, [state.canvas.width, state.canvas.height, dispatch, captureHistory])

  const handleResizeCanvas = useCallback((settings: ResizeCanvasSettings): void => {
    setShowResizeCanvasDialog(false)
    const { width: newW, height: newH, anchorCol, anchorRow } = settings
    const oldW = state.canvas.width
    const oldH = state.canvas.height
    if (newW === oldW && newH === oldH) return

    const handle = canvasHandleRef.current
    if (!handle) return

    // Compute pixel offset of the existing content in the new canvas.
    // anchorCol/Row: 0=start, 1=center, 2=end → maps to offsetX/Y.
    const offsetX = anchorCol === 0 ? 0
      : anchorCol === 1 ? Math.round((newW - oldW) / 2)
      : newW - oldW
    const offsetY = anchorRow === 0 ? 0
      : anchorRow === 1 ? Math.round((newH - oldH) / 2)
      : newH - oldH

    const layerPixels = handle.captureAllLayerPixels()
    const encoded = new Map<string, string>()
    for (const [id, oldPixels] of layerPixels) {
      const tmp = document.createElement('canvas')
      tmp.width = newW; tmp.height = newH
      const ctx2d = tmp.getContext('2d')!

      // Draw the old layer data into the offset position
      const oldCvs = document.createElement('canvas')
      oldCvs.width = oldW; oldCvs.height = oldH
      const oldCtx = oldCvs.getContext('2d')!
      oldCtx.putImageData(new ImageData(new Uint8ClampedArray(oldPixels.buffer as ArrayBuffer), oldW, oldH), 0, 0)
      ctx2d.drawImage(oldCvs, offsetX, offsetY)
      encoded.set(id, tmp.toDataURL('image/png'))
    }

    // Capture pre-op state so the user can undo this resize
    captureHistory('Before Resize Canvas')
    setPendingLayerData(encoded)
    pendingLayerLabelRef.current = 'Resize Canvas'
    dispatch({ type: 'RESIZE_CANVAS', payload: { width: newW, height: newH } })
  }, [state.canvas.width, state.canvas.height, dispatch, captureHistory])

  const handleCrop = useCallback((): void => {
    const r = cropStore.rect
    if (!r) return
    const oldW = state.canvas.width
    const oldH = state.canvas.height
    // Clamp crop rect to canvas bounds
    const cropX = Math.max(0, r.x)
    const cropY = Math.max(0, r.y)
    const cropW = Math.min(r.w, oldW - cropX)
    const cropH = Math.min(r.h, oldH - cropY)
    if (cropW <= 0 || cropH <= 0) return
    const handle = canvasHandleRef.current
    if (!handle) return

    const layerPixels = handle.captureAllLayerPixels()
    const encoded = new Map<string, string>()
    for (const [id, pixels] of layerPixels) {
      const src = document.createElement('canvas')
      src.width = oldW; src.height = oldH
      const srcCtx = src.getContext('2d')!
      srcCtx.putImageData(
        new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), oldW, oldH),
        0, 0
      )
      const dst = document.createElement('canvas')
      dst.width = cropW; dst.height = cropH
      const dstCtx = dst.getContext('2d')!
      dstCtx.drawImage(src, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
      encoded.set(id, dst.toDataURL('image/png'))
    }

    cropStore.clear()
    // Capture pre-op state so the user can undo this crop
    captureHistory('Before Crop')
    setPendingLayerData(encoded)
    pendingLayerLabelRef.current = 'Crop'
    dispatch({ type: 'RESIZE_CANVAS', payload: { width: cropW, height: cropH } })
  }, [state.canvas.width, state.canvas.height, dispatch, captureHistory])

  useEffect(() => {
    cropStore.onCrop = handleCrop
    return () => { cropStore.onCrop = null }
  }, [handleCrop])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') { selectionStore.clear(); cropStore.clear(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); handleDelete(); return }
      if (!e.ctrlKey) return
      if (e.key === 'z') { e.preventDefault(); handleUndo() }
      else if (e.key === 'y') { e.preventDefault(); handleRedo() }
      else if (e.key === 'c') { e.preventDefault(); handleCopy() }
      else if (e.key === 'x') { e.preventDefault(); handleCut() }
      else if (e.key === 'v') { e.preventDefault(); handlePaste() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
}, [handleUndo, handleRedo, handleCopy, handleCut, handlePaste, handleDelete])

  // ── Export ────────────────────────────────────────────────────────
  const handleExportConfirm = useCallback(async (settings: ExportSettings): Promise<void> => {
    setShowExportDialog(false)
    const flat = canvasHandleRef.current?.exportFlatPixels()
    if (!flat) return
    const { data, width, height } = flat

    let dataUrl: string
    if (settings.format === 'png') {
      dataUrl = exportPng(data, width, height)
    } else if (settings.format === 'webp') {
      dataUrl = exportWebp(data, width, height, { quality: settings.webpQuality })
    } else {
      dataUrl = exportJpeg(data, width, height, {
        quality: settings.jpegQuality,
        background: settings.jpegBackground,
      })
    }

    // Strip the data URL prefix to get the raw base64 payload.
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
    await window.api.exportImage(settings.filePath, base64)
  }, [])

  // ── Tab info for TabBar ───────────────────────────────────────────
  const tabInfos: TabInfo[] = tabs.map(t => ({ id: t.id, title: t.title }))

  return (
    <div className={styles.app}>
      <TopBar
        onDebug={() => window.api.openDevTools()}
        onNew={() => setShowNewImageDialog(true)}
        onOpen={handleOpen}
        onSave={() => handleSave(false)}
        onSaveAs={() => handleSave(true)}
        onExport={() => setShowExportDialog(true)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onDelete={handleDelete}
        onResizeImage={() => setShowResizeDialog(true)}
        onResizeCanvas={() => setShowResizeCanvasDialog(true)}
      />
      <ToolOptionsBar />
      <TabBar
        tabs={tabInfos}
        activeTabId={activeTabId}
        activeZoom={state.canvas.zoom}
        onSwitch={handleSwitchTab}
        onClose={handleCloseTab}
      />

      <div className={styles.workspace}>
        <Toolbar
          activeTool={state.activeTool}
          onToolChange={(tool) => dispatch({ type: 'SET_TOOL', payload: tool })}
        />
        <main className={styles.canvasArea}>
          <Canvas
            key={state.canvas.key}
            ref={canvasHandleRef}
            width={state.canvas.width}
            height={state.canvas.height}
            initialLayerData={pendingLayerData ?? undefined}
            onStrokeEnd={captureHistory}
            onReady={() => {
              captureHistory(pendingLayerLabelRef.current ?? 'Initial State')
              pendingLayerLabelRef.current = null
            }}
          />
        </main>
        <RightPanel />
      </div>

      <StatusBar />

      <NewImageDialog
        open={showNewImageDialog}
        onCancel={() => setShowNewImageDialog(false)}
        onConfirm={handleNewConfirm}
      />

      <ExportDialog
        open={showExportDialog}
        onCancel={() => setShowExportDialog(false)}
        onConfirm={handleExportConfirm}
      />

      <ResizeImageDialog
        open={showResizeDialog}
        currentWidth={state.canvas.width}
        currentHeight={state.canvas.height}
        onCancel={() => setShowResizeDialog(false)}
        onConfirm={handleResizeImage}
      />

      <ResizeCanvasDialog
        open={showResizeCanvasDialog}
        currentWidth={state.canvas.width}
        currentHeight={state.canvas.height}
        onCancel={() => setShowResizeCanvasDialog(false)}
        onConfirm={handleResizeCanvas}
      />
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <AppProvider>
      <CanvasProvider>
        <AppContent />
      </CanvasProvider>
    </AppProvider>
  )
}

export default App

