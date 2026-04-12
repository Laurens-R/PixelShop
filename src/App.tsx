import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AppProvider } from '@/store/AppContext'
import { CanvasProvider } from '@/store/CanvasContext'
import { selectionStore } from '@/store/selectionStore'
import { clipboardStore } from '@/store/clipboardStore'
import { historyStore } from '@/store/historyStore'
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
import { useAppContext } from '@/store/AppContext'
import type { LayerState, BackgroundFill } from '@/types'
import { exportPng } from '@/export/exportPng'
import { exportJpeg } from '@/export/exportJpeg'
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
}

function makeTabId(): string { return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}` }
function fileTitle(p: string): string { return p.split(/[\\/]/).pop() ?? 'Untitled' }

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
  const pendingLayerLabelRef = useRef<string | null>(null)
  const prevLayersRef = useRef(state.layers)

  const captureHistory = useCallback((label: string): void => {
    if (isRestoringRef.current) return
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
      canvasHandleRef.current?.restoreAllLayerPixels(entry.layerPixels)
    }
    return () => { historyStore.onPreview = null }
  }, [])

  useEffect(() => {
    historyStore.onJumpTo = (index: number): void => {
      const entry = historyStore.entries[index]
      if (!entry) return
      isRestoringRef.current = true
      canvasHandleRef.current?.restoreAllLayerPixels(entry.layerPixels)
      dispatch({
        type: 'RESTORE_LAYERS',
        payload: {
          layers: entry.layerState,
          activeLayerId: entry.activeLayerId,
        },
      })
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
  const [pendingLayerData, setPendingLayerData] = useState<Map<string, string> | null>(null)

  const initialTabId = useRef(makeTabId()).current
  const [tabs, setTabs] = useState<TabRecord[]>([{
    id: initialTabId,
    title: 'Untitled-1',
    filePath: null,
    snapshot: INITIAL_SNAPSHOT,
    savedLayerData: null,
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
    const updated = tabs.map(t =>
      t.id === activeTabId ? { ...t, snapshot, savedLayerData: layerData } : t
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
    const n = untitledCounter
    setUntitledCounter(n + 1)
    const newId = makeTabId()
    const newSnapshot: TabSnapshot = {
      canvasWidth: width, canvasHeight: height, backgroundFill,
      layers: [{ id: 'layer-0', name: 'Background', visible: true, opacity: 1, locked: false, blendMode: 'normal' }],
      activeLayerId: 'layer-0', zoom: 1,
    }
    const updated: TabRecord[] = [
      ...tabs.map(t => t.id === activeTabId ? { ...t, snapshot, savedLayerData: layerData } : t),
      { id: newId, title: `Untitled-${n + 1}`, filePath: null, snapshot: newSnapshot, savedLayerData: null }
    ]
    setTabs(updated)
    setActiveTabId(newId)
    setPendingLayerData(null)
    dispatch({ type: 'NEW_CANVAS', payload: { width, height, backgroundFill } })
    setShowNewImageDialog(false)
  }, [tabs, activeTabId, untitledCounter, captureActiveSnapshot, captureActiveLayerData, dispatch])

  // ── Open ──────────────────────────────────────────────────────────
  const handleOpen = useCallback(async (): Promise<void> => {
    const path = await window.api.openPxshopDialog()
    if (!path) return

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
    const newId = makeTabId()
    const updated: TabRecord[] = [
      ...tabs.map(t => t.id === activeTabId ? { ...t, snapshot, savedLayerData: currentLayerData } : t),
      { id: newId, title, filePath: path, snapshot: newSnapshot, savedLayerData: null }
    ]
    setTabs(updated)
    setActiveTabId(newId)
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
    // Apply mask: zero out unselected pixels
    if (selectionStore.mask) {
      for (let i = 0; i < selectionStore.mask.length; i++) {
        if (!selectionStore.mask[i]) pixels[i * 4 + 3] = 0
      }
    }
    clipboardStore.current = { data: pixels, width, height }
  }, [state.activeLayerId, state.canvas])

  const handleCut = useCallback((): void => {
    const activeId = state.activeLayerId
    if (!activeId) return
    handleCopy()
    const totalPixels = state.canvas.width * state.canvas.height
    const mask = selectionStore.mask ?? new Uint8Array(totalPixels).fill(1)
    canvasHandleRef.current?.clearLayerPixels(activeId, mask)
    captureHistory('Cut')
  }, [state.activeLayerId, state.canvas, handleCopy, captureHistory])

  const handlePaste = useCallback((): void => {
    const clip = clipboardStore.current
    if (!clip) return
    const newId = makeTabId()
    canvasHandleRef.current?.prepareNewLayer(newId, 'Paste', clip.data)
    pendingLayerLabelRef.current = 'Paste'
    dispatch({
      type: 'ADD_LAYER',
      payload: { id: newId, name: 'Paste', visible: true, opacity: 1, locked: false, blendMode: 'normal' }
    })
  }, [dispatch])

  const handleUndo = useCallback((): void => { historyStore.undo() }, [])
  const handleRedo = useCallback((): void => { historyStore.redo() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'z') { e.preventDefault(); handleUndo() }
      else if (e.key === 'y') { e.preventDefault(); handleRedo() }
      else if (e.key === 'c') { e.preventDefault(); handleCopy() }
      else if (e.key === 'x') { e.preventDefault(); handleCut() }
      else if (e.key === 'v') { e.preventDefault(); handlePaste() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleUndo, handleRedo, handleCopy, handleCut, handlePaste])

  // ── Export ────────────────────────────────────────────────────────
  const handleExportConfirm = useCallback(async (settings: ExportSettings): Promise<void> => {
    setShowExportDialog(false)
    const flat = canvasHandleRef.current?.exportFlatPixels()
    if (!flat) return
    const { data, width, height } = flat

    let dataUrl: string
    if (settings.format === 'png') {
      dataUrl = exportPng(data, width, height)
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
            onReady={() => captureHistory('Initial State')}
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

