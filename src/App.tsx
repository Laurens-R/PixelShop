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
import { RadialBlurDialog } from '@/components/dialogs/RadialBlurDialog/RadialBlurDialog'
import { MotionBlurDialog } from '@/components/dialogs/MotionBlurDialog/MotionBlurDialog'
import { RemoveMotionBlurDialog } from '@/components/dialogs/RemoveMotionBlurDialog/RemoveMotionBlurDialog'
import { UnsharpMaskDialog } from '@/components/dialogs/UnsharpMaskDialog/UnsharpMaskDialog'
import { SmartSharpenDialog } from '@/components/dialogs/SmartSharpenDialog/SmartSharpenDialog'
import { AddNoiseDialog } from '@/components/dialogs/AddNoiseDialog/AddNoiseDialog'
import { FilmGrainDialog } from '@/components/dialogs/FilmGrainDialog/FilmGrainDialog'
import { LensBlurDialog } from '@/components/dialogs/LensBlurDialog/LensBlurDialog'
import { CloudsDialog } from '@/components/dialogs/CloudsDialog/CloudsDialog'
import { MedianFilterDialog } from '@/components/dialogs/MedianFilterDialog/MedianFilterDialog'
import { BilateralFilterDialog } from '@/components/dialogs/BilateralFilterDialog/BilateralFilterDialog'
import { ReduceNoiseDialog } from '@/components/dialogs/ReduceNoiseDialog/ReduceNoiseDialog'
import { LensFlareDialog } from '@/components/dialogs/LensFlareDialog/LensFlareDialog'
import { PixelateDialog } from '@/components/dialogs/PixelateDialog/PixelateDialog'
import { GeneratePaletteDialog } from '@/components/dialogs/GeneratePaletteDialog/GeneratePaletteDialog'
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
import { useTransform } from '@/hooks/useTransform'
import { transformStore } from '@/store/transformStore'
import { ModalDialog } from '@/components/dialogs/ModalDialog/ModalDialog'
import { DialogButton } from '@/components/widgets/DialogButton/DialogButton'
import type { Tool } from '@/types'
import { ADJUSTMENT_REGISTRY } from '@/adjustments/registry'
import type { AdjustmentRegistrationEntry } from '@/adjustments/registry'
import { FILTER_REGISTRY } from '@/filters/registry'
import type { FilterKey } from '@/types'
import { selectionStore } from '@/store/selectionStore'
import styles from './App.module.scss'

// ─── Statics ──────────────────────────────────────────────────────────────────

const ADJUSTMENT_MENU_ITEMS = (ADJUSTMENT_REGISTRY as readonly AdjustmentRegistrationEntry[]).map(e => ({ type: e.adjustmentType, label: e.label, group: e.group }))
const FILTER_MENU_ITEMS = FILTER_REGISTRY.map(e => ({ key: e.key, label: e.label, instant: e.instant, group: e.group }))

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
  const [showRadialBlurDialog,     setShowRadialBlurDialog]     = useState(false)
  const [showMotionBlurDialog,     setShowMotionBlurDialog]     = useState(false)
  const [showRemoveMotionBlurDialog, setShowRemoveMotionBlurDialog] = useState(false)
  const [showUnsharpMaskDialog,    setShowUnsharpMaskDialog]    = useState(false)
  const [showSmartSharpenDialog,   setShowSmartSharpenDialog]   = useState(false)
  const [showAddNoiseDialog,       setShowAddNoiseDialog]       = useState(false)
  const [showFilmGrainDialog,      setShowFilmGrainDialog]      = useState(false)
  const [showLensBlurDialog,       setShowLensBlurDialog]       = useState(false)
  const [showCloudsDialog,         setShowCloudsDialog]         = useState(false)
  const [showMedianFilterDialog,   setShowMedianFilterDialog]   = useState(false)
  const [showBilateralFilterDialog, setShowBilateralFilterDialog] = useState(false)
  const [showReduceNoiseDialog,     setShowReduceNoiseDialog]     = useState(false)
  const [showLensFlareDialog,       setShowLensFlareDialog]       = useState(false)
  const [showPixelateDialog,         setShowPixelateDialog]         = useState(false)
  const [showGeneratePaletteDialog,   setShowGeneratePaletteDialog]   = useState(false)

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
    handleNewLayer, handleDuplicateLayer, handleDeleteActiveLayer,
    handleFlattenImage, handleRasterizeLayer,
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

  // ── Transform guard ───────────────────────────────────────────────
  // Declared early so any hook/callback below can use requireTransformDecision.
  // requireTransformDecision only depends on transformStore (module-level) and
  // the state setter — no dependency on useTransform output.
  const [pendingGuardedAction, setPendingGuardedAction] = useState<(() => void) | null>(null)

  const requireTransformDecision = useCallback((action: () => void): void => {
    if (transformStore.isActive) {
      setPendingGuardedAction(() => action)
      return
    }
    action()
  }, [])

  // ── Filters ───────────────────────────────────────────────────────
  const handleOpenFilterDialog = useCallback((key: FilterKey): void => {
    requireTransformDecision(() => {
      if (key === 'gaussian-blur') setShowGaussianBlurDialog(true)
      if (key === 'box-blur')      setShowBoxBlurDialog(true)
      if (key === 'radial-blur')   setShowRadialBlurDialog(true)
      if (key === 'motion-blur')   setShowMotionBlurDialog(true)
      if (key === 'remove-motion-blur') setShowRemoveMotionBlurDialog(true)
      if (key === 'unsharp-mask')  setShowUnsharpMaskDialog(true)
      if (key === 'smart-sharpen') setShowSmartSharpenDialog(true)
      if (key === 'add-noise')     setShowAddNoiseDialog(true)
      if (key === 'film-grain')    setShowFilmGrainDialog(true)
      if (key === 'lens-blur')     setShowLensBlurDialog(true)
      if (key === 'clouds')        setShowCloudsDialog(true)
      if (key === 'median-filter') setShowMedianFilterDialog(true)
      if (key === 'bilateral-filter') setShowBilateralFilterDialog(true)
      if (key === 'reduce-noise') setShowReduceNoiseDialog(true)
      if (key === 'render-lens-flare') setShowLensFlareDialog(true)
      if (key === 'pixelate') setShowPixelateDialog(true)
    })
  }, [requireTransformDecision])

  const filters = useFilters({
    layers:             state.layers,
    activeLayerId:      state.activeLayerId,
    onOpenFilterDialog: handleOpenFilterDialog,
    canvasHandleRef,
    canvasWidth:        state.canvas.width,
    canvasHeight:       state.canvas.height,
    captureHistory,
    dispatch,
    stateRef,
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

  // ── Transform ─────────────────────────────────────────────────────
  const { handleEnterTransform, handleApply: handleTransformApply, handleCancel: handleTransformCancel, isFreeTransformEnabled } = useTransform({
    canvasHandleRef, stateRef, dispatch, captureHistory,
  })

  const handleToolChange = useCallback((tool: Tool): void => {
    requireTransformDecision(() => dispatch({ type: 'SET_TOOL', payload: tool }))
  }, [requireTransformDecision, dispatch])

  const guardedSwitchTab = useCallback((toId: string): void => {
    requireTransformDecision(() => handleSwitchTab(toId))
  }, [requireTransformDecision, handleSwitchTab])

  const guardedCloseTab = useCallback((toId: string): void => {
    requireTransformDecision(() => handleCloseTab(toId))
  }, [requireTransformDecision, handleCloseTab])

  const handleTransformGuardApply = useCallback((): void => {
    const pending = pendingGuardedAction
    setPendingGuardedAction(null)
    if (!pending) return
    // Subscribe to the store so we run the pending action after the async WASM apply finishes.
    const onComplete = (): void => {
      if (!transformStore.isActive) {
        transformStore.unsubscribe(onComplete)
        pending()
      }
    }
    transformStore.subscribe(onComplete)
    handleTransformApply()
  }, [pendingGuardedAction, handleTransformApply])

  const handleTransformGuardDiscard = useCallback((): void => {
    const pending = pendingGuardedAction
    setPendingGuardedAction(null)
    if (!pending) return
    handleTransformCancel()
    pending()
  }, [pendingGuardedAction, handleTransformCancel])

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useKeyboardShortcuts({
    handleUndo, handleRedo, handleCopy, handleCut, handlePaste,
    handleDelete, handleZoomIn, handleZoomOut, handleFitToWindow, handleToggleGrid,
    handleKeyboardShortcuts: useCallback(() => setShowShortcutsDialog(true), []),
    handleFreeTransform: handleEnterTransform,
  })

  // ── Export ────────────────────────────────────────────────────────
  // ── Render ────────────────────────────────────────────────────────
  const hasActiveDocument = tabs.length > 0
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
        onCreateAdjustmentLayer={(type) => requireTransformDecision(() => adjustments.handleCreateAdjustmentLayer(type))}
        isAdjustmentMenuEnabled={adjustments.isAdjustmentMenuEnabled}
        adjustmentMenuItems={ADJUSTMENT_MENU_ITEMS}
        onOpenFilterDialog={handleOpenFilterDialog}
        onInstantFilter={(key) => requireTransformDecision(() => filters.handleInstantFilter(key))}
        isFiltersMenuEnabled={filters.isFiltersMenuEnabled}
        filterMenuItems={FILTER_MENU_ITEMS}
        onFreeTransform={handleEnterTransform}
        isFreeTransformEnabled={isFreeTransformEnabled}
      />
      <ToolOptionsBar />
      <TabBar
        tabs={tabInfos}
        activeTabId={activeTabId}
        activeZoom={state.canvas.zoom}
        onSwitch={guardedSwitchTab}
        onClose={guardedCloseTab}
      />

      <div className={styles.workspace}>
        <Toolbar
          activeTool={state.activeTool}
          onToolChange={handleToolChange}
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
          activeTabId={activeTabId}
          onMergeSelected={handleMergeSelected}
          onMergeVisible={handleMergeVisible}
          onMergeDown={handleMergeDown}
          onFlattenImage={handleFlattenImage}
          onRasterizeLayer={handleRasterizeLayer}
          onOpenAdjustmentPanel={(id) => requireTransformDecision(() => adjustments.handleOpenAdjustmentPanel(id))}
          onGeneratePalette={() => setShowGeneratePaletteDialog(true)}
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
      {showRadialBlurDialog && (
        <RadialBlurDialog
          isOpen={showRadialBlurDialog}
          onClose={() => setShowRadialBlurDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showMotionBlurDialog && (
        <MotionBlurDialog
          isOpen={showMotionBlurDialog}
          onClose={() => setShowMotionBlurDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showRemoveMotionBlurDialog && (
        <RemoveMotionBlurDialog
          isOpen={showRemoveMotionBlurDialog}
          onClose={() => setShowRemoveMotionBlurDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showUnsharpMaskDialog && (
        <UnsharpMaskDialog
          isOpen={showUnsharpMaskDialog}
          onClose={() => setShowUnsharpMaskDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showSmartSharpenDialog && (
        <SmartSharpenDialog
          isOpen={showSmartSharpenDialog}
          onClose={() => setShowSmartSharpenDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showAddNoiseDialog && (
        <AddNoiseDialog
          isOpen={showAddNoiseDialog}
          onClose={() => setShowAddNoiseDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showFilmGrainDialog && (
        <FilmGrainDialog
          isOpen={showFilmGrainDialog}
          onClose={() => setShowFilmGrainDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showLensBlurDialog && (
        <LensBlurDialog
          isOpen={showLensBlurDialog}
          onClose={() => setShowLensBlurDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showCloudsDialog && (
        <CloudsDialog
          isOpen={showCloudsDialog}
          onClose={() => setShowCloudsDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
          foregroundColor={[state.primaryColor.r, state.primaryColor.g, state.primaryColor.b]}
          backgroundColor={[state.secondaryColor.r, state.secondaryColor.g, state.secondaryColor.b]}
        />
      )}
      {showMedianFilterDialog && (
        <MedianFilterDialog
          isOpen={showMedianFilterDialog}
          onClose={() => setShowMedianFilterDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showBilateralFilterDialog && (
        <BilateralFilterDialog
          isOpen={showBilateralFilterDialog}
          onClose={() => setShowBilateralFilterDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showReduceNoiseDialog && (
        <ReduceNoiseDialog
          isOpen={showReduceNoiseDialog}
          onClose={() => setShowReduceNoiseDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      {showLensFlareDialog && (
        <LensFlareDialog
          isOpen={showLensFlareDialog}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          onApply={(pixels, w, h) => {
            filters.handleApplyLensFlare(pixels, w, h)
            setShowLensFlareDialog(false)
          }}
          onCancel={() => setShowLensFlareDialog(false)}
          width={state.canvas.width}
          height={state.canvas.height}
        />
      )}
      {showPixelateDialog && (
        <PixelateDialog
          isOpen={showPixelateDialog}
          onClose={() => setShowPixelateDialog(false)}
          canvasHandleRef={canvasHandleRef}
          activeLayerId={state.activeLayerId}
          captureHistory={captureHistory}
          canvasWidth={state.canvas.width}
          canvasHeight={state.canvas.height}
        />
      )}
      <GeneratePaletteDialog
        open={showGeneratePaletteDialog}
        onClose={() => setShowGeneratePaletteDialog(false)}
        canvasHandleRef={canvasHandleRef}
        swatches={state.swatches}
        hasActiveDocument={hasActiveDocument}
        onApply={(palette) => {
          captureHistory('Generate Palette', { swatches: palette })
          dispatch({ type: 'SET_SWATCHES', payload: palette })
        }}
      />

      {/* ── Transform guard — shown when switching away from an active transform ── */}
      <ModalDialog
        open={pendingGuardedAction !== null}
        title="Transform in Progress"
        width={360}
        onClose={() => setPendingGuardedAction(null)}
      >
        <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--color-text)' }}>
          You switched tools while a transform is active. Apply or discard it before continuing.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '8px 16px 16px' }}>
          <DialogButton onClick={() => setPendingGuardedAction(null)}>Go Back</DialogButton>
          <DialogButton onClick={handleTransformGuardDiscard}>Discard</DialogButton>
          <DialogButton onClick={handleTransformGuardApply} primary>Apply</DialogButton>
        </div>
      </ModalDialog>
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

