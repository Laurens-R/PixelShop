import React, { useCallback, useRef, useState } from 'react'
import { AppProvider, useAppContext } from '@/store/AppContext'
import { CanvasProvider } from '@/store/CanvasContext'
import { historyStore } from '@/store/historyStore'
import { TopBar } from '@/components/window/TopBar/TopBar'
import { ToolOptionsBar } from '@/components/window/ToolOptionsBar/ToolOptionsBar'
import { TabBar } from '@/components/window/TabBar/TabBar'
import type { TabInfo } from '@/components/window/TabBar/TabBar'
import { Toolbar } from '@/components/window/Toolbar/Toolbar'
import { Canvas } from '@/components/window/Canvas/Canvas'
import { RightPanel } from '@/components/window/RightPanel/RightPanel'
import { StatusBar } from '@/components/window/StatusBar/StatusBar'
import { NewImageDialog } from '@/components/dialogs/NewImageDialog/NewImageDialog'
import { ExportDialog } from '@/components/dialogs/ExportDialog/ExportDialog'
import type { ExportSettings } from '@/components/dialogs/ExportDialog/ExportDialog'
import { ResizeImageDialog } from '@/components/dialogs/ResizeImageDialog/ResizeImageDialog'
import { ResizeCanvasDialog } from '@/components/dialogs/ResizeCanvasDialog/ResizeCanvasDialog'
import { exportPng } from '@/export/exportPng'
import { exportJpeg } from '@/export/exportJpeg'
import { exportWebp } from '@/export/exportWebp'
import { useTabs } from '@/hooks/useTabs'
import { useHistory } from '@/hooks/useHistory'
import { useFileOps } from '@/hooks/useFileOps'
import { useClipboard } from '@/hooks/useClipboard'
import { useLayers } from '@/hooks/useLayers'
import { useCanvasTransforms } from '@/hooks/useCanvasTransforms'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import styles from './App.module.scss'

// ─── AppContent ───────────────────────────────────────────────────────────────

function AppContent(): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const stateRef = useRef(state)
  stateRef.current = state

  const [showNewImageDialog,    setShowNewImageDialog]    = useState(false)
  const [showExportDialog,      setShowExportDialog]      = useState(false)
  const [showResizeDialog,      setShowResizeDialog]      = useState(false)
  const [showResizeCanvasDialog, setShowResizeCanvasDialog] = useState(false)

  // ── Tab management ────────────────────────────────────────────────
  const {
    tabs, setTabs, activeTabId, setActiveTabId,
    activeTabIdRef, setTabsRef,
    canvasHandleRef,
    pendingLayerData, setPendingLayerData,
    tabCanvasRef, captureActiveSnapshot,
    handleSwitchTab, handleCloseTab,
  } = useTabs(state, dispatch)

  // ── History ───────────────────────────────────────────────────────
  const { captureHistory, pendingLayerLabelRef } = useHistory({
    canvasHandleRef, stateRef, dispatch,
    activeTabIdRef, setTabsRef, setPendingLayerData,
    layers: state.layers,
  })

  // ── File operations ───────────────────────────────────────────────
  const { handleNewConfirm, handleOpen, handleSave } = useFileOps({
    canvasHandleRef, state, tabs, activeTabId,
    setTabs, setActiveTabId, setPendingLayerData,
    captureActiveSnapshot, handleSwitchTab, dispatch,
  })

  // ── Clipboard ─────────────────────────────────────────────────────
  const { handleCopy, handleCut, handlePaste, handleDelete } = useClipboard({
    canvasHandleRef, state, dispatch, captureHistory, pendingLayerLabelRef,
  })

  // ── Layer operations ──────────────────────────────────────────────
  const {
    handleMergeSelected, handleMergeDown, handleMergeVisible,
    handleNewLayer, handleDuplicateLayer, handleDeleteActiveLayer, handleFlattenImage,
  } = useLayers({ canvasHandleRef, stateRef, captureHistory, dispatch, pendingLayerLabelRef })

  // ── Canvas transforms ─────────────────────────────────────────────
  const { handleResizeImage, handleResizeCanvas } = useCanvasTransforms({
    canvasHandleRef, stateRef, captureHistory, dispatch,
    activeTabId, setTabs, setPendingLayerData, pendingLayerLabelRef,
    canvasWidth: state.canvas.width, canvasHeight: state.canvas.height,
  })

  // ── View actions ──────────────────────────────────────────────────
  const handleUndo         = useCallback(() => { historyStore.undo() }, [])
  const handleRedo         = useCallback(() => { historyStore.redo() }, [])
  const handleZoomIn       = useCallback(() => {
    dispatch({ type: 'SET_ZOOM', payload: parseFloat(Math.min(32, stateRef.current.canvas.zoom * 1.25).toFixed(4)) })
  }, [dispatch])
  const handleZoomOut      = useCallback(() => {
    dispatch({ type: 'SET_ZOOM', payload: parseFloat(Math.max(0.05, stateRef.current.canvas.zoom * 0.8).toFixed(4)) })
  }, [dispatch])
  const handleFitToWindow  = useCallback(() => { canvasHandleRef.current?.fitToWindow() }, [canvasHandleRef])
  const handleToggleGrid   = useCallback(() => { dispatch({ type: 'TOGGLE_GRID' }) }, [dispatch])

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useKeyboardShortcuts({
    handleUndo, handleRedo, handleCopy, handleCut, handlePaste,
    handleDelete, handleZoomIn, handleZoomOut, handleFitToWindow, handleToggleGrid,
  })

  // ── Export ────────────────────────────────────────────────────────
  const handleExportConfirm = useCallback(async (settings: ExportSettings): Promise<void> => {
    setShowExportDialog(false)
    const flat = canvasHandleRef.current?.exportFlatPixels()
    if (!flat) return
    const { data, width, height } = flat
    let dataUrl: string
    if      (settings.format === 'png')  dataUrl = exportPng(data, width, height)
    else if (settings.format === 'webp') dataUrl = exportWebp(data, width, height, { quality: settings.webpQuality })
    else                                 dataUrl = exportJpeg(data, width, height, { quality: settings.jpegQuality, background: settings.jpegBackground })
    await window.api.exportImage(settings.filePath, dataUrl.replace(/^data:[^;]+;base64,/, ''))
  }, [canvasHandleRef])

  // ── Render ────────────────────────────────────────────────────────
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
        <RightPanel
          onMergeSelected={handleMergeSelected}
          onMergeVisible={handleMergeVisible}
          onMergeDown={handleMergeDown}
          onFlattenImage={handleFlattenImage}
        />
      </div>

      <StatusBar />

      <NewImageDialog
        open={showNewImageDialog}
        onCancel={() => setShowNewImageDialog(false)}
        onConfirm={(s) => { handleNewConfirm(s); setShowNewImageDialog(false) }}
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
        onConfirm={(s) => { void handleResizeImage(s); setShowResizeDialog(false) }}
      />
      <ResizeCanvasDialog
        open={showResizeCanvasDialog}
        currentWidth={state.canvas.width}
        currentHeight={state.canvas.height}
        onCancel={() => setShowResizeCanvasDialog(false)}
        onConfirm={(s) => { handleResizeCanvas(s); setShowResizeCanvasDialog(false) }}
      />
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

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

