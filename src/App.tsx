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
import { AdjustmentPanel } from '@/components/panels/AdjustmentPanel/AdjustmentPanel'
import { NewImageDialog } from '@/components/dialogs/NewImageDialog/NewImageDialog'
import { ExportDialog } from '@/components/dialogs/ExportDialog/ExportDialog'
import { ResizeImageDialog } from '@/components/dialogs/ResizeImageDialog/ResizeImageDialog'
import { ResizeCanvasDialog } from '@/components/dialogs/ResizeCanvasDialog/ResizeCanvasDialog'
import { AboutDialog } from '@/components/dialogs/AboutDialog/AboutDialog'
import { KeyboardShortcutsDialog } from '@/components/dialogs/KeyboardShortcutsDialog/KeyboardShortcutsDialog'
import { GaussianBlurDialog } from '@/components/dialogs/GaussianBlurDialog/GaussianBlurDialog'
import { BoxBlurDialog } from '@/components/dialogs/BoxBlurDialog/BoxBlurDialog'
import { useTabs } from '@/hooks/useTabs'
import { useHistory } from '@/hooks/useHistory'
import { useFileOps } from '@/hooks/useFileOps'
import { useExportOps } from '@/hooks/useExportOps'
import { useClipboard } from '@/hooks/useClipboard'
import { useLayers } from '@/hooks/useLayers'
import { useCanvasTransforms } from '@/hooks/useCanvasTransforms'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAdjustments } from '@/hooks/useAdjustments'
import { useFilters } from '@/hooks/useFilters'
import { ADJUSTMENT_REGISTRY } from '@/adjustments/registry'
import { FILTER_REGISTRY } from '@/filters/registry'
import type { FilterKey } from '@/types'
import { selectionStore } from '@/store/selectionStore'
import styles from './App.module.scss'

// ─── Statics ──────────────────────────────────────────────────────────────────

const ADJUSTMENT_MENU_ITEMS = ADJUSTMENT_REGISTRY.map(e => ({ type: e.adjustmentType, label: e.label }))
const FILTER_MENU_ITEMS = FILTER_REGISTRY.map(e => ({ key: e.key, label: e.label }))

// ─── AppContent ───────────────────────────────────────────────────────────────

function AppContent(): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const stateRef = useRef(state)
  stateRef.current = state

  const [showNewImageDialog,    setShowNewImageDialog]    = useState(false)
  const [showExportDialog,      setShowExportDialog]      = useState(false)
  const [showResizeDialog,       setShowResizeDialog]       = useState(false)
  const [showResizeCanvasDialog,  setShowResizeCanvasDialog]  = useState(false)
  const [showAboutDialog,         setShowAboutDialog]         = useState(false)
  const [showShortcutsDialog,     setShowShortcutsDialog]     = useState(false)
  const [showGaussianBlurDialog,  setShowGaussianBlurDialog]  = useState(false)
  const [showBoxBlurDialog,        setShowBoxBlurDialog]        = useState(false)

  // ── Tab management ────────────────────────────────────────────────
  const {
    tabs, setTabs, activeTabId, setActiveTabId,
    activeTabIdRef, setTabsRef,
    canvasHandleRef,
    pendingLayerData, setPendingLayerData,
    tabCanvasRef, captureActiveSnapshot, serializeActiveTabPixels,
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
    captureActiveSnapshot, serializeActiveTabPixels, handleSwitchTab, dispatch,
  })

  // ── Export operations ────────────────────────────────────────────
  const { handleExportConfirm } = useExportOps({ canvasHandleRef, stateRef })

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

  // ── Adjustments ───────────────────────────────────────────────────
  const getSelectionPixels = useCallback((): Uint8Array | null => {
    return selectionStore.mask ? selectionStore.mask.slice() : null
  }, [])

  const registerAdjMask = useCallback((layerId: string, pixels: Uint8Array): void => {
    canvasHandleRef.current?.registerAdjustmentSelectionMask(layerId, pixels)
  }, [canvasHandleRef])

  const adjustments = useAdjustments({
    stateRef,
    captureHistory,
    dispatch,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    getSelectionPixels,
    registerAdjMask,
  })

  // ── Filters ───────────────────────────────────────────────────────
  const handleOpenFilterDialog = useCallback((key: FilterKey): void => {
    if (key === 'gaussian-blur') setShowGaussianBlurDialog(true)
    if (key === 'box-blur')      setShowBoxBlurDialog(true)
  }, [])

  const filters = useFilters({
    layers:             state.layers,
    activeLayerId:      state.activeLayerId,
    onOpenFilterDialog: handleOpenFilterDialog,
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
    handleKeyboardShortcuts: useCallback(() => setShowShortcutsDialog(true), []),
  })

  // ── Export ────────────────────────────────────────────────────────
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
        onAbout={() => setShowAboutDialog(true)}
        onKeyboardShortcuts={() => setShowShortcutsDialog(true)}
        onCreateAdjustmentLayer={adjustments.handleCreateAdjustmentLayer}
        isAdjustmentMenuEnabled={adjustments.isAdjustmentMenuEnabled}
        adjustmentMenuItems={ADJUSTMENT_MENU_ITEMS}
        onOpenFilterDialog={handleOpenFilterDialog}
        isFiltersMenuEnabled={filters.isFiltersMenuEnabled}
        filterMenuItems={FILTER_MENU_ITEMS}
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
            if (tab.id !== activeTabId) return null
            return (
              <Canvas
                key={`${tab.id}-${tab.canvasKey}`}
                ref={tabCanvasRef(tab.id)}
                width={tab.snapshot.canvasWidth}
                height={tab.snapshot.canvasHeight}
                initialLayerData={pendingLayerData ?? tab.savedLayerData ?? undefined}
                isActive={true}
                onStrokeEnd={captureHistory}
                onReady={() => {
                  setPendingLayerData(null)
                  captureHistory(pendingLayerLabelRef.current ?? 'Initial State')
                  pendingLayerLabelRef.current = null
                }}
              />
            )
          })}
        </main>
        <RightPanel
          onMergeSelected={handleMergeSelected}
          onMergeVisible={handleMergeVisible}
          onMergeDown={handleMergeDown}
          onFlattenImage={handleFlattenImage}
          onOpenAdjustmentPanel={adjustments.handleOpenAdjustmentPanel}
        />
      </div>

      <StatusBar />

      {state.openAdjustmentLayerId !== null && (
        <AdjustmentPanel
          onClose={adjustments.handleCloseAdjustmentPanel}
          canvasHandleRef={canvasHandleRef}
        />
      )}

      <NewImageDialog
        open={showNewImageDialog}
        onCancel={() => setShowNewImageDialog(false)}
        onConfirm={(s) => { handleNewConfirm(s); setShowNewImageDialog(false) }}
      />
      <ExportDialog
        open={showExportDialog}
        onCancel={() => setShowExportDialog(false)}
        onConfirm={async (settings) => {
          setShowExportDialog(false)
          await handleExportConfirm(settings)
        }}
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
      <AboutDialog
        open={showAboutDialog}
        onClose={() => setShowAboutDialog(false)}
      />
      <KeyboardShortcutsDialog
        open={showShortcutsDialog}
        onClose={() => setShowShortcutsDialog(false)}
      />
      {showGaussianBlurDialog && (
        <GaussianBlurDialog
          isOpen={showGaussianBlurDialog}
          onClose={() => setShowGaussianBlurDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showBoxBlurDialog && (
        <BoxBlurDialog
          isOpen={showBoxBlurDialog}
          onClose={() => setShowBoxBlurDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
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

