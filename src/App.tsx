import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  /** Incremented to force this tab’s Canvas to remount (resize / crop). */
  canvasKey: number
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

  // ── Per-tab Canvas handle map — avoids ref-null races on tab close/switch ───
  const canvasHandlesRef = useRef(new Map<string, CanvasHandle>())
  const canvasRefCallbacksRef = useRef(new Map<string, (h: CanvasHandle | null) => void>())
  // Stable proxy — always returns the ACTIVE tab’s canvas handle
  const activeTabIdRef = useRef('')
  const canvasHandleRef = useMemo(() => ({
    get current(): CanvasHandle | null {
      return canvasHandlesRef.current.get(activeTabIdRef.current) ?? null
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])
  /** Returns a stable callback ref for a given tab id. */
  function tabCanvasRef(tabId: string): (h: CanvasHandle | null) => void {
    if (!canvasRefCallbacksRef.current.has(tabId)) {
      canvasRefCallbacksRef.current.set(tabId, (h) => {
        if (h) canvasHandlesRef.current.set(tabId, h)
        else   canvasHandlesRef.current.delete(tabId)
      })
    }
    return canvasRefCallbacksRef.current.get(tabId)!
  }

  // A ref for setTabs so async closures (onJumpTo) can call it without stale deps
  const setTabsRef = useRef<React.Dispatch<React.SetStateAction<TabRecord[]>>>(() => {})

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
    const layerGeometry = canvasHandleRef.current?.captureAllLayerGeometry() ?? new Map()
    const s = stateRef.current
    historyStore.push({
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label,
      timestamp: Date.now(),
      layerPixels,
      layerGeometry,
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
      canvasHandleRef.current?.restoreAllLayerPixels(entry.layerPixels, entry.layerGeometry)
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
        // The target state has different canvas dimensions — must remount the Canvas.
        const encoded = new Map<string, string>()
      for (const [id, pixels] of entry.layerPixels) {
          const geo = entry.layerGeometry?.get(id)
          const lw = geo?.layerWidth ?? entry.canvasWidth
          const lh = geo?.layerHeight ?? entry.canvasHeight
          const tmp = document.createElement('canvas')
          tmp.width = lw; tmp.height = lh
          const ctx2d = tmp.getContext('2d')!
          ctx2d.putImageData(
            new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), lw, lh),
            0, 0
          )
          encoded.set(id, tmp.toDataURL('image/png'))
          if (geo) {
            encoded.set(`${id}:geo`, JSON.stringify(geo))
          }
        }
        suppressReadyCaptureRef.current = true
        setPendingLayerData(encoded)
        // Increment the active tab's canvasKey to trigger Canvas remount
        const jumpTabId = activeTabIdRef.current
        setTabsRef.current(prev => prev.map(t =>
          t.id === jumpTabId
            ? { ...t, canvasKey: t.canvasKey + 1, snapshot: { ...t.snapshot, canvasWidth: entry.canvasWidth, canvasHeight: entry.canvasHeight } }
            : t
        ))
        dispatch({
          type: 'SWITCH_TAB',
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
        canvasHandleRef.current?.restoreAllLayerPixels(entry.layerPixels, entry.layerGeometry)
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
    canvasKey: 1,
  }])
  const [activeTabId, setActiveTabId] = useState(initialTabId)
  // Keep refs in sync each render so async closures always see fresh values
  activeTabIdRef.current = activeTabId
  setTabsRef.current = setTabs

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
      const result = canvasHandleRef.current?.exportLayerPng(layer.id)
      if (result) {
        map.set(layer.id, result.png)
        map.set(`${layer.id}:geo`, JSON.stringify({
          layerWidth: result.layerWidth,
          layerHeight: result.layerHeight,
          offsetX: result.offsetX,
          offsetY: result.offsetY,
        }))
      }
    }
    return map
  }, [state.layers])

  // ── Switch tab ────────────────────────────────────────────────────
  const switchToTab = useCallback((toId: string, tabs_: TabRecord[]): void => {
    const toTab = tabs_.find(t => t.id === toId)
    if (!toTab) return
    if (toTab.savedHistory && toTab.savedHistory.entries.length > 0) {
      historyStore.restore(toTab.savedHistory.entries, toTab.savedHistory.currentIndex)
    } else {
      historyStore.clear()
    }
    setActiveTabId(toId)
    dispatch({
      type: 'SWITCH_TAB',
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
    const savedHistory = {
      entries: historyStore.entries.slice(),
      currentIndex: historyStore.currentIndex,
    }
    const updated = tabs.map(t =>
      t.id === activeTabId ? { ...t, snapshot, savedHistory } : t
    )
    setTabs(updated)
    switchToTab(toId, updated)
  }, [activeTabId, tabs, captureActiveSnapshot, switchToTab])

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
      ...tabs.map(t => t.id === activeTabId ? { ...t, snapshot, savedHistory } : t),
      { id: newId, title: `Untitled-${n + 1}`, filePath: null, snapshot: newSnapshot, savedLayerData: null, savedHistory: null, canvasKey: 1 }
    ]
    setTabs(updated)
    setActiveTabId(newId)
    historyStore.clear()
    setPendingLayerData(null)
    dispatch({ type: 'NEW_CANVAS', payload: { width, height, backgroundFill } })
    setShowNewImageDialog(false)
  }, [tabs, activeTabId, untitledCounter, captureActiveSnapshot, dispatch])

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
      const savedHistory = { entries: historyStore.entries.slice(), currentIndex: historyStore.currentIndex }
      const newId = makeTabId()
      const updated: TabRecord[] = [
        ...tabs.map(t => t.id === activeTabId ? { ...t, snapshot, savedHistory } : t),
        { id: newId, title, filePath: null, snapshot: newSnapshot, savedLayerData: layerData, savedHistory: null, canvasKey: 1 }
      ]
      setTabs(updated)
      setActiveTabId(newId)
      historyStore.clear()
      setPendingLayerData(null)
      dispatch({ type: 'SWITCH_TAB', payload: { width, height, backgroundFill: 'transparent', layers, activeLayerId: layerId, zoom: 1 } })
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
      layers: Array<LayerState & { pngData?: string | null; layerGeo?: { layerWidth: number; layerHeight: number; offsetX: number; offsetY: number } | null }>
    }

    const layerData = new Map<string, string>()
    const layers: LayerState[] = doc.layers.map(({ pngData, layerGeo, ...meta }) => {
      if (pngData) layerData.set(meta.id, pngData)
      if (layerGeo) layerData.set(`${meta.id}:geo`, JSON.stringify(layerGeo))
      return meta
    })
    const title = fileTitle(path)
    const bg = doc.canvas.backgroundFill ?? 'transparent'
    const newSnapshot: TabSnapshot = {
      canvasWidth: doc.canvas.width, canvasHeight: doc.canvas.height, backgroundFill: bg,
      layers, activeLayerId: doc.activeLayerId ?? layers[0]?.id ?? null, zoom: 1,
    }

    const snapshot = captureActiveSnapshot()
    const savedHistory = {
      entries: historyStore.entries.slice(),
      currentIndex: historyStore.currentIndex,
    }
    const newId = makeTabId()
    const updated: TabRecord[] = [
      ...tabs.map(t => t.id === activeTabId ? { ...t, snapshot, savedHistory } : t),
      { id: newId, title, filePath: path, snapshot: newSnapshot, savedLayerData: layerData, savedHistory: null, canvasKey: 1 }
    ]
    setTabs(updated)
    setActiveTabId(newId)
    historyStore.clear()
    setPendingLayerData(null)
    dispatch({
      type: 'SWITCH_TAB',
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
    const layerGeos: Record<string, { layerWidth: number; layerHeight: number; offsetX: number; offsetY: number }> = {}
    for (const layer of state.layers) {
      const result = canvasHandleRef.current?.exportLayerPng(layer.id)
      if (result) {
        layerPngs[layer.id] = result.png
        layerGeos[layer.id] = { layerWidth: result.layerWidth, layerHeight: result.layerHeight, offsetX: result.offsetX, offsetY: result.offsetY }
      }
    }

    const doc = {
      version: 1,
      canvas: { width: state.canvas.width, height: state.canvas.height, backgroundFill: state.canvas.backgroundFill },
      activeLayerId: state.activeLayerId,
      layers: state.layers.map((l) => ({ ...l, pngData: layerPngs[l.id] ?? null, layerGeo: layerGeos[l.id] ?? null }))
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

  // ── Merge helpers ──────────────────────────────────────────────────────────
  // All merge functions read from stateRef.current so they never have stale closures.

  function compositeLayers(layerList: LayerState[]): Uint8Array {
    const { width, height } = stateRef.current.canvas

    // Blend mode functions operating on [0,1] channel values (matching the GLSL shader)
    type V3 = [number, number, number]
    const blendNormal    = (_s: V3, _d: V3): V3 => _s
    const blendMultiply  = (s: V3, d: V3): V3 => [s[0]*d[0], s[1]*d[1], s[2]*d[2]]
    const blendScreen    = (s: V3, d: V3): V3 => [s[0]+d[0]-s[0]*d[0], s[1]+d[1]-s[1]*d[1], s[2]+d[2]-s[2]*d[2]]
    const blendOverlay   = (s: V3, d: V3): V3 => d.map((dc, i) => dc < 0.5 ? 2*s[i]*dc : 1-2*(1-s[i])*(1-dc)) as V3
    const blendSoftLight = (s: V3, d: V3): V3 => d.map((dc, i) => {
      const sc = s[i]; const q = sc < 0.5 ? dc : Math.sqrt(dc)
      return sc < 0.5 ? dc - (1-2*sc)*dc*(1-dc) : dc + (2*sc-1)*(q-dc)
    }) as V3
    const blendHardLight = (s: V3, d: V3): V3 => s.map((sc, i) => sc < 0.5 ? 2*sc*d[i] : 1-2*(1-sc)*(1-d[i])) as V3
    const blendDarken    = (s: V3, d: V3): V3 => [Math.min(s[0],d[0]), Math.min(s[1],d[1]), Math.min(s[2],d[2])]
    const blendLighten   = (s: V3, d: V3): V3 => [Math.max(s[0],d[0]), Math.max(s[1],d[1]), Math.max(s[2],d[2])]
    const blendDiff      = (s: V3, d: V3): V3 => [Math.abs(d[0]-s[0]), Math.abs(d[1]-s[1]), Math.abs(d[2]-s[2])]
    const blendExcl      = (s: V3, d: V3): V3 => [s[0]+d[0]-2*s[0]*d[0], s[1]+d[1]-2*s[1]*d[1], s[2]+d[2]-2*s[2]*d[2]]
    const blendDodge     = (s: V3, d: V3): V3 => s.map((sc, i) => Math.min(d[i] / Math.max(1-sc, 0.0001), 1)) as V3
    const blendBurn      = (s: V3, d: V3): V3 => s.map((sc, i) => 1 - Math.min((1-d[i]) / Math.max(sc, 0.0001), 1)) as V3

    const modeToFn: Record<string, (s: V3, d: V3) => V3> = {
      normal:       blendNormal,
      multiply:     blendMultiply,
      screen:       blendScreen,
      overlay:      blendOverlay,
      'soft-light': blendSoftLight,
      'hard-light': blendHardLight,
      darken:       blendDarken,
      lighten:      blendLighten,
      difference:   blendDiff,
      exclusion:    blendExcl,
      'color-dodge': blendDodge,
      'color-burn':  blendBurn,
    }

    const out = new Uint8Array(width * height * 4)
    for (const layer of layerList) {
      const src = canvasHandleRef.current?.getLayerPixels(layer.id)
      if (!src) continue
      const blendFn = modeToFn[layer.blendMode] ?? blendNormal
      const opacity = layer.opacity
      for (let i = 0; i < src.length; i += 4) {
        const srcA = (src[i + 3] / 255) * opacity
        if (srcA <= 0) continue
        const dstA = out[i + 3] / 255
        const outA = srcA + dstA * (1 - srcA)
        if (outA <= 0) continue

        // Normalise to [0,1] for blend function; dst is un-premultiplied
        const s: V3 = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255]
        const d: V3 = dstA > 0.0001
          ? [out[i] / (dstA * 255), out[i + 1] / (dstA * 255), out[i + 2] / (dstA * 255)]
          : [0, 0, 0]

        const blended = blendFn(s, d)

        // Porter-Duff src-over with blended rgb (same formula as shader)
        out[i]     = Math.round(Math.min(1, (blended[0] * srcA + d[0] * dstA * (1 - srcA)) / outA) * 255)
        out[i + 1] = Math.round(Math.min(1, (blended[1] * srcA + d[1] * dstA * (1 - srcA)) / outA) * 255)
        out[i + 2] = Math.round(Math.min(1, (blended[2] * srcA + d[2] * dstA * (1 - srcA)) / outA) * 255)
        out[i + 3] = Math.round(outA * 255)
      }
    }
    return out
  }

  const handleMergeSelected = useCallback((ids: string[]): void => {
    if (ids.length < 2 || !canvasHandleRef.current) return
    const layers = stateRef.current.layers
    const selectedSet = new Set(ids)
    const selectedLayers = layers.filter((l) => selectedSet.has(l.id))
    if (selectedLayers.length < 2) return
    captureHistory('Merge Layers')
    const merged = compositeLayers(selectedLayers)
    const topIdx = layers.findLastIndex((l) => selectedSet.has(l.id))
    const mergedName = selectedLayers[selectedLayers.length - 1].name
    const newId = `layer-${Date.now()}`
    canvasHandleRef.current.prepareNewLayer(newId, mergedName, merged)
    const newLayers: LayerState[] = []
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]
      if (i === topIdx) {
        newLayers.push({ id: newId, name: mergedName, visible: true, opacity: 1, locked: false, blendMode: 'normal' })
      } else if (!selectedSet.has(l.id)) {
        newLayers.push(l)
      }
    }
    dispatch({ type: 'REORDER_LAYERS', payload: newLayers })
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: newId })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureHistory, dispatch])

  const handleMergeDown = useCallback((): void => {
    const layers = stateRef.current.layers
    const activeLayerId = stateRef.current.activeLayerId
    if (!canvasHandleRef.current || !activeLayerId) return
    const activeIdx = layers.findIndex((l) => l.id === activeLayerId)
    if (activeIdx <= 0) return
    const toMerge = layers.slice(0, activeIdx + 1)
    captureHistory('Merge Down')
    const merged = compositeLayers(toMerge)
    const newId = `layer-${Date.now()}`
    const mergedName = layers[0].name
    const mergeIds = new Set(toMerge.map((l) => l.id))
    canvasHandleRef.current.prepareNewLayer(newId, mergedName, merged)
    const newLayers: LayerState[] = []
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]
      if (i === 0) {
        newLayers.push({ id: newId, name: mergedName, visible: true, opacity: 1, locked: false, blendMode: 'normal' })
      } else if (!mergeIds.has(l.id)) {
        newLayers.push(l)
      }
    }
    dispatch({ type: 'REORDER_LAYERS', payload: newLayers })
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: newId })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureHistory, dispatch])

  const handleMergeVisible = useCallback((): void => {
    const layers = stateRef.current.layers
    if (!canvasHandleRef.current) return
    const visibleLayers = layers.filter((l) => l.visible)
    if (visibleLayers.length < 2) return
    captureHistory('Merge Visible')
    const merged = compositeLayers(visibleLayers)
    const visibleIds = new Set(visibleLayers.map((l) => l.id))
    const topIdx = layers.findLastIndex((l) => visibleIds.has(l.id))
    const newId = `layer-${Date.now()}`
    canvasHandleRef.current.prepareNewLayer(newId, 'Merged', merged)
    const newLayers: LayerState[] = []
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]
      if (i === topIdx) {
        newLayers.push({ id: newId, name: 'Merged', visible: true, opacity: 1, locked: false, blendMode: 'normal' })
      } else if (!visibleIds.has(l.id)) {
        newLayers.push(l)
      }
    }
    dispatch({ type: 'REORDER_LAYERS', payload: newLayers })
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: newId })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureHistory, dispatch])

  const handleNewLayer = useCallback((): void => {
    const id = `layer-${Date.now()}`
    pendingLayerLabelRef.current = 'New Layer'
    dispatch({
      type: 'ADD_LAYER',
      payload: { id, name: `Layer ${stateRef.current.layers.length + 1}`, visible: true, opacity: 1, locked: false, blendMode: 'normal' }
    })
  }, [dispatch])

  const handleDuplicateLayer = useCallback((): void => {
    const { activeLayerId, layers } = stateRef.current
    if (!activeLayerId || !canvasHandleRef.current) return
    const src = layers.find((l) => l.id === activeLayerId)
    if (!src) return
    const pixels = canvasHandleRef.current.getLayerPixels(src.id)
    if (!pixels) return
    const newId = `layer-${Date.now()}`
    const name = `${src.name} copy`
    canvasHandleRef.current.prepareNewLayer(newId, name, pixels)
    pendingLayerLabelRef.current = 'Duplicate Layer'
    dispatch({ type: 'ADD_LAYER', payload: { ...src, id: newId, name } })
  }, [dispatch])

  const handleDeleteActiveLayer = useCallback((): void => {
    const id = stateRef.current.activeLayerId
    if (id) dispatch({ type: 'REMOVE_LAYER', payload: id })
  }, [dispatch])

  const handleFlattenImage = useCallback((): void => {
    const layers = stateRef.current.layers
    if (!canvasHandleRef.current || layers.length < 2) return
    captureHistory('Flatten Image')
    const merged = compositeLayers(layers)
    const newId = `layer-${Date.now()}`
    canvasHandleRef.current.prepareNewLayer(newId, 'Background', merged)
    dispatch({ type: 'REORDER_LAYERS', payload: [{ id: newId, name: 'Background', visible: true, opacity: 1, locked: false, blendMode: 'normal' }] })
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: newId })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureHistory, dispatch])

  // ── View actions ────────────────────────────────────────────────────────
  const handleZoomIn = useCallback((): void => {
    const newZoom = parseFloat(Math.min(32, stateRef.current.canvas.zoom * 1.25).toFixed(4))
    dispatch({ type: 'SET_ZOOM', payload: newZoom })
  }, [dispatch])

  const handleZoomOut = useCallback((): void => {
    const newZoom = parseFloat(Math.max(0.05, stateRef.current.canvas.zoom * 0.8).toFixed(4))
    dispatch({ type: 'SET_ZOOM', payload: newZoom })
  }, [dispatch])

  const handleFitToWindow = useCallback((): void => {
    canvasHandleRef.current?.fitToWindow()
  }, [])

  const handleToggleGrid = useCallback((): void => {
    dispatch({ type: 'TOGGLE_GRID' })
  }, [dispatch])

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
      const encoded = new Map<string, string>()
      for (const layer of stateRef.current.layers) {
        const pixels = handle.getLayerPixels(layer.id)
        if (!pixels) continue
        const resized = await resizeFn(pixels, oldW, oldH, newW, newH)
        const tmp = document.createElement('canvas')
        tmp.width = newW; tmp.height = newH
        const ctx2d = tmp.getContext('2d')!
        ctx2d.putImageData(new ImageData(new Uint8ClampedArray(resized.buffer as ArrayBuffer), newW, newH), 0, 0)
        encoded.set(layer.id, tmp.toDataURL('image/png'))
      }
      captureHistory('Before Resize Image')
      // Increment canvasKey to trigger Canvas remount with the new dimensions
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

    const encoded = new Map<string, string>()
    for (const layer of stateRef.current.layers) {
      const oldPixels = handle.getLayerPixels(layer.id)
      if (!oldPixels) continue
      const tmp = document.createElement('canvas')
      tmp.width = newW; tmp.height = newH
      const ctx2d = tmp.getContext('2d')!

      // Draw the old layer data into the offset position
      const oldCvs = document.createElement('canvas')
      oldCvs.width = oldW; oldCvs.height = oldH
      const oldCtx = oldCvs.getContext('2d')!
      oldCtx.putImageData(new ImageData(new Uint8ClampedArray(oldPixels.buffer as ArrayBuffer), oldW, oldH), 0, 0)
      ctx2d.drawImage(oldCvs, offsetX, offsetY)
      encoded.set(layer.id, tmp.toDataURL('image/png'))
    }

    // Capture pre-op state so the user can undo this resize
    captureHistory('Before Resize Canvas')
    // Increment canvasKey to trigger Canvas remount with the new dimensions
    const resizeCanvasTabId = activeTabId
    setTabs(prev => prev.map(t =>
      t.id === resizeCanvasTabId
        ? { ...t, canvasKey: t.canvasKey + 1, snapshot: { ...t.snapshot, canvasWidth: newW, canvasHeight: newH } }
        : t
    ))
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

    const encoded = new Map<string, string>()
    for (const layer of stateRef.current.layers) {
      const pixels = handle.getLayerPixels(layer.id)
      if (!pixels) continue
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
      encoded.set(layer.id, dst.toDataURL('image/png'))
    }

    cropStore.clear()
    // Capture pre-op state so the user can undo this crop
    captureHistory('Before Crop')
    // Increment canvasKey to trigger Canvas remount with the new dimensions
    const cropTabId = activeTabId
    setTabs(prev => prev.map(t =>
      t.id === cropTabId
        ? { ...t, canvasKey: t.canvasKey + 1, snapshot: { ...t.snapshot, canvasWidth: cropW, canvasHeight: cropH } }
        : t
    ))
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
      else if (e.key === '=' || e.key === '+') { e.preventDefault(); handleZoomIn() }
      else if (e.key === '-') { e.preventDefault(); handleZoomOut() }
      else if (e.key === '0') { e.preventDefault(); handleFitToWindow() }
      else if (e.key === 'g') { e.preventDefault(); handleToggleGrid() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
}, [handleUndo, handleRedo, handleCopy, handleCut, handlePaste, handleDelete, handleZoomIn, handleZoomOut, handleFitToWindow, handleToggleGrid])

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
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToWindow={handleFitToWindow}
        onToggleGrid={handleToggleGrid}
        showGrid={state.canvas.showGrid}
        onNewLayer={handleNewLayer}
        onDuplicateLayer={handleDuplicateLayer}
        onDeleteLayer={handleDeleteActiveLayer}
        onMergeDown={handleMergeDown}
        onMergeVisible={handleMergeVisible}
        onFlattenImage={handleFlattenImage}
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
          {tabs.map(tab => {
            const tabActive = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                style={tabActive
                  ? { display: 'flex', flex: 1, overflow: 'hidden' }
                  : { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' }
                }
              >
                <Canvas
                  key={`${tab.id}-${tab.canvasKey}`}
                  ref={tabCanvasRef(tab.id)}
                  width={tab.snapshot.canvasWidth}
                  height={tab.snapshot.canvasHeight}
                  initialLayerData={tabActive && pendingLayerData ? pendingLayerData : tab.savedLayerData ?? undefined}
                  isActive={tabActive}
                  onStrokeEnd={captureHistory}
                  onReady={() => {
                    setPendingLayerData(null)
                    setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, savedLayerData: null } : t))
                    captureHistory(pendingLayerLabelRef.current ?? 'Initial State')
                    pendingLayerLabelRef.current = null
                  }}
                />
              </div>
            )
          })}
        </main>
        <RightPanel onMergeSelected={handleMergeSelected} onMergeVisible={handleMergeVisible} onMergeDown={handleMergeDown} onFlattenImage={handleFlattenImage} />
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

