import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AppProvider, useAppContext } from '@/store/AppContext'
import { CanvasProvider } from '@/store/CanvasContext'
import { historyStore } from '@/store/historyStore'
import { TopBar } from '@/components/ui/TopBar/TopBar'
import { ToolOptionsBar } from '@/components/ui/ToolOptionsBar/ToolOptionsBar'
import { TabBar } from '@/components/ui/TabBar/TabBar'
import type { TabInfo } from '@/components/ui/TabBar/TabBar'
import { Toolbar } from '@/components/ui/Toolbar/Toolbar'
import { Canvas } from '@/components/ui/Canvas/Canvas'
import { RightPanel } from '@/components/ui/RightPanel/RightPanel'
import { StatusBar } from '@/components/ui/StatusBar/StatusBar'
import { AdjustmentPanel } from '@/components/dialogs/AdjustmentPanel/AdjustmentPanel'
import { NewImageDialog } from '@/components/modals/NewImageDialog/NewImageDialog'
import { ExportDialog } from '@/components/modals/ExportDialog/ExportDialog'
import { ResizeImageDialog } from '@/components/modals/ResizeImageDialog/ResizeImageDialog'
import { ResizeCanvasDialog } from '@/components/modals/ResizeCanvasDialog/ResizeCanvasDialog'
import { AboutDialog } from '@/components/modals/AboutDialog/AboutDialog'
import { KeyboardShortcutsDialog } from '@/components/modals/KeyboardShortcutsDialog/KeyboardShortcutsDialog'
import { GaussianBlurDialog } from '@/components/dialogs/filters/GaussianBlurDialog/GaussianBlurDialog'
import { BoxBlurDialog } from '@/components/dialogs/filters/BoxBlurDialog/BoxBlurDialog'
import { RadialBlurDialog } from '@/components/dialogs/filters/RadialBlurDialog/RadialBlurDialog'
import { MotionBlurDialog } from '@/components/dialogs/filters/MotionBlurDialog/MotionBlurDialog'
import { RemoveMotionBlurDialog } from '@/components/dialogs/filters/RemoveMotionBlurDialog/RemoveMotionBlurDialog'
import { UnsharpMaskDialog } from '@/components/dialogs/filters/UnsharpMaskDialog/UnsharpMaskDialog'
import { SmartSharpenDialog } from '@/components/dialogs/filters/SmartSharpenDialog/SmartSharpenDialog'
import { AddNoiseDialog } from '@/components/dialogs/filters/AddNoiseDialog/AddNoiseDialog'
import { FilmGrainDialog } from '@/components/dialogs/filters/FilmGrainDialog/FilmGrainDialog'
import { LensBlurDialog } from '@/components/dialogs/filters/LensBlurDialog/LensBlurDialog'
import { CloudsDialog } from '@/components/dialogs/filters/CloudsDialog/CloudsDialog'
import { MedianFilterDialog } from '@/components/dialogs/filters/MedianFilterDialog/MedianFilterDialog'
import { BilateralFilterDialog } from '@/components/dialogs/filters/BilateralFilterDialog/BilateralFilterDialog'
import { ReduceNoiseDialog } from '@/components/dialogs/filters/ReduceNoiseDialog/ReduceNoiseDialog'
import { LensFlareDialog } from '@/components/dialogs/filters/LensFlareDialog/LensFlareDialog'
import { PixelateDialog } from '@/components/dialogs/filters/PixelateDialog/PixelateDialog'
import { GeneratePaletteDialog } from '@/components/modals/GeneratePaletteDialog/GeneratePaletteDialog'
import { ContentAwareFillProgress } from '@/components'
import { ContentAwareFillOptionsDialog } from '@/components/modals/ContentAwareFillOptionsDialog/ContentAwareFillOptionsDialog'
import { useTabs } from '@/hooks/useTabs'
import { useHistory } from '@/hooks/useHistory'
import { useFileOps } from '@/hooks/useFileOps'
import { useExportOps } from '@/hooks/useExportOps'
import { useClipboard } from '@/hooks/useClipboard'
import { useLayers } from '@/hooks/useLayers'
import { useLayerGroups } from '@/hooks/useLayerGroups'
import { useCanvasTransforms } from '@/hooks/useCanvasTransforms'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAdjustments } from '@/hooks/useAdjustments'
import { useFilters } from '@/hooks/useFilters'
import { useTransform } from '@/hooks/useTransform'
import { usePolygonalSelection } from '@/hooks/usePolygonalSelection'
import { useObjectSelection } from '@/hooks/useObjectSelection'
import { useContentAwareFill } from '@/hooks/useContentAwareFill'
import { transformStore } from '@/store/transformStore'
import { cloneStampStore } from '@/store/cloneStampStore'
import { ModalDialog } from '@/components/modals/ModalDialog/ModalDialog'
import { DialogButton } from '@/components/widgets/DialogButton/DialogButton'
import type { Tool, LayerState, AdjustmentType } from '@/types'
import { ADJUSTMENT_REGISTRY } from '@/adjustments/registry'
import type { AdjustmentRegistrationEntry } from '@/adjustments/registry'
import { FILTER_REGISTRY } from '@/filters/registry'
import type { FilterKey } from '@/types'
import { selectionStore } from '@/store/selectionStore'
import styles from './App.module.scss'

// ─── Statics ──────────────────────────────────────────────────────────────────

const ADJUSTMENT_MENU_ITEMS = (ADJUSTMENT_REGISTRY as readonly AdjustmentRegistrationEntry[])
  .filter(e => e.group !== 'real-time-effects')
  .map(e => ({ type: e.adjustmentType, label: e.label, group: e.group }))
const EFFECTS_MENU_ITEMS = (ADJUSTMENT_REGISTRY as readonly AdjustmentRegistrationEntry[])
  .filter(e => e.group === 'real-time-effects')
  .map(e => ({ type: e.adjustmentType, label: e.label, group: e.group }))
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
  const [showContentAwareFillOptionsDialog, setShowContentAwareFillOptionsDialog] = useState(false)
  const [contentAwareFillOptionsMode,  setContentAwareFillOptionsMode]  = useState<'fill' | 'delete'>('fill')
  const [cloneStampNotification,       setCloneStampNotification]       = useState<string | null>(null)
  const [isContentAwareFilling,        setIsContentAwareFilling]        = useState(false)
  const [contentAwareFillError,        setContentAwareFillError]        = useState<string | null>(null)
  const [contentAwareFillLabel,        setContentAwareFillLabel]        = useState('Filling…')
  const [hasSelection,                 setHasSelection]                 = useState(false)
  const [recentFiles,                  setRecentFiles]                  = useState<string[]>([])
  const [findLayersCounter,            setFindLayersCounter]            = useState(0)

  // ── Clone stamp source deletion notification ─────────────────────
  const cloneStampNotifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentAwareFillErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    cloneStampStore.onSourceDeleted = () => {
      setCloneStampNotification('⚠ Source layer was deleted — Alt+click to set a new source')
      if (cloneStampNotifTimerRef.current !== null) clearTimeout(cloneStampNotifTimerRef.current)
      cloneStampNotifTimerRef.current = setTimeout(() => setCloneStampNotification(null), 4000)
    }
    return () => {
      cloneStampStore.onSourceDeleted = null
      if (cloneStampNotifTimerRef.current !== null) clearTimeout(cloneStampNotifTimerRef.current)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (contentAwareFillErrorTimerRef.current !== null) clearTimeout(contentAwareFillErrorTimerRef.current)
    }
  }, [])

  // ── Selection state for menu enabled sync ────────────────────────
  useEffect(() => {
    const update = (): void => setHasSelection(selectionStore.hasSelection())
    selectionStore.subscribe(update)
    return () => selectionStore.unsubscribe(update)
  }, [])

  // ── Recent files ──────────────────────────────────────────────────
  useEffect(() => {
    window.api.getRecentFiles().then(setRecentFiles)
  }, [])

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
  const { handleNewConfirm, handleOpen, handleOpenPath, handleSave, handleSaveACopy } = useFileOps({
    canvasHandleRef, state, tabs, activeTabId,
    setTabs, setActiveTabId, setPendingLayerData,
    captureActiveSnapshot, serializeActiveTabPixels, handleSwitchTab, dispatch,
    onRecentFilesUpdated: setRecentFiles,
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

  // ── Layer groups ──────────────────────────────────────────────────
  const {
    handleMergeGroup, handleGroupLayers, handleUngroupLayers,
  } = useLayerGroups({ canvasHandleRef, stateRef, captureHistory, dispatch })

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

  // ── Content-Aware Fill / Delete ────────────────────────────────────
  const { runContentAwareFill, runContentAwareDelete } = useContentAwareFill({
    canvasHandleRef, stateRef, captureHistory, dispatch,
    pendingLayerLabelRef, setIsContentAwareFilling,
    setFillLabel: setContentAwareFillLabel,
    onError: (msg) => {
      setContentAwareFillError(msg)
      if (contentAwareFillErrorTimerRef.current !== null) clearTimeout(contentAwareFillErrorTimerRef.current)
      contentAwareFillErrorTimerRef.current = setTimeout(() => setContentAwareFillError(null), 4000)
    },
  })

  const handleOpenCafDialog = useCallback((mode: 'fill' | 'delete'): void => {
    setContentAwareFillOptionsMode(mode)
    setShowContentAwareFillOptionsDialog(true)
  }, [])

  const handleCafConfirm = useCallback((samplingRadius: number): void => {
    setShowContentAwareFillOptionsDialog(false)
    if (contentAwareFillOptionsMode === 'fill') {
      void runContentAwareFill(samplingRadius)
    } else {
      void runContentAwareDelete(samplingRadius)
    }
  }, [contentAwareFillOptionsMode, runContentAwareFill, runContentAwareDelete])

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
  const handleFindLayers   = useCallback(() => { setFindLayersCounter(c => c + 1) }, [])

  const handleSelectAll = useCallback((): void => {
    const { width, height } = stateRef.current.canvas
    if (width === 0 || height === 0) return
    selectionStore.setRect(0, 0, width - 1, height - 1, 'set')
  }, [])

  const handleDeselect = useCallback((): void => {
    selectionStore.clear()
  }, [])

  const handleSelectAllLayers = useCallback((): void => {
    const allIds = stateRef.current.layers.map(l => l.id)
    dispatch({ type: 'SET_SELECTED_LAYERS', payload: allIds })
  }, [dispatch])

  const handleDeselectLayers = useCallback((): void => {
    dispatch({ type: 'SET_SELECTED_LAYERS', payload: [] })
  }, [dispatch])

  // ── Polygonal selection keyboard handling ───────────────────────
  usePolygonalSelection()

  // ── Object Selection (SAM) ────────────────────────────────────────
  useObjectSelection({
    canvasHandleRef,
    stateRef,
    captureHistory,
    activeTabId,
    layers: state.layers,
  })

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

  const handleClose = useCallback((): void => {
    guardedCloseTab(activeTabId)
  }, [guardedCloseTab, activeTabId])

  const handleCloseAll = useCallback((): void => {
    const ids = tabs.filter(t => t.id !== activeTabId).map(t => t.id)
    for (const id of ids) handleCloseTab(id)
  }, [tabs, activeTabId, handleCloseTab])

  const handleClearRecentFiles = useCallback(async (): Promise<void> => {
    await window.api.clearRecentFiles()
    setRecentFiles([])
  }, [])

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
    handleInvertSelection: useCallback(() => selectionStore.invert(), []),
    handleSelectAll,
    handleDeselect,
    handleSelectAllLayers,
    handleCloneStamp: useCallback(() => handleToolChange('clone-stamp'), [handleToolChange]),
    handleContentAwareDelete: useCallback(() => handleOpenCafDialog('delete'), [handleOpenCafDialog]),
    handleFindLayers,
    handleCycleLasso: useCallback(() => {
      const current = stateRef.current.activeTool
      const next = current === 'polygonal-selection' ? 'lasso' : 'polygonal-selection'
      handleToolChange(next)
    }, [handleToolChange]),
    handleCycleWand: useCallback(() => {
      const current = stateRef.current.activeTool
      const next = current === 'magic-wand' ? 'object-selection' : 'magic-wand'
      handleToolChange(next)
    }, [handleToolChange]),
  })

  // ── Export ────────────────────────────────────────────────────────
  // ── Render ────────────────────────────────────────────────────────
  const hasActiveDocument = tabs.length > 0
  const tabInfos: TabInfo[] = tabs.map(t => ({ id: t.id, title: t.title }))

  const activeLayer = state.layers.find(l => l.id === state.activeLayerId) ?? null
  const isRasterizeLayerEnabled = activeLayer !== null && !('type' in activeLayer && (activeLayer.type === 'mask' || activeLayer.type === 'adjustment'))
  const effectiveSelectedIds = new Set(state.selectedLayerIds)
  if (state.activeLayerId) effectiveSelectedIds.add(state.activeLayerId)
  const isPixelRootLayer = (l: LayerState): boolean => !('type' in l) || l.type === 'text' || l.type === 'shape'
  const isMergeSelectedEnabled = [...effectiveSelectedIds].filter(id => {
    const l = state.layers.find(x => x.id === id)
    return l !== undefined && isPixelRootLayer(l)
  }).length >= 2

  // ── macOS native application menu ────────────────────────────────
  const isMac = window.api.platform === 'darwin'

  // A ref that holds the latest action dispatcher (avoids stale closures in the IPC listener).
  const macMenuHandlerRef = useRef<(actionId: string) => void>(() => { /* noop until mounted */ })
  macMenuHandlerRef.current = useCallback((actionId: string): void => {
    // Dynamic: adjustment / effects layers
    if (actionId.startsWith('adj:')) {
      const type = actionId.slice(4) as AdjustmentType
      requireTransformDecision(() => adjustments.handleCreateAdjustmentLayer(type))
      return
    }
    // Dynamic: filters
    if (actionId.startsWith('filter:')) {
      const key = actionId.slice(7) as FilterKey
      const fi = FILTER_MENU_ITEMS.find(f => f.key === key)
      if (fi?.instant) {
        requireTransformDecision(() => filters.handleInstantFilter(key))
      } else {
        handleOpenFilterDialog(key)
      }
      return
    }
    // Dynamic: recent files
    if (actionId.startsWith('recentFile:')) {
      const idx = parseInt(actionId.slice(11), 10)
      const path = recentFiles[idx]
      if (path) void handleOpenPath(path)
      return
    }
    // Static actions
    switch (actionId) {
      case 'new':             setShowNewImageDialog(true); break
      case 'open':            void handleOpen(); break
      case 'close':           handleClose(); break
      case 'closeAll':        handleCloseAll(); break
      case 'save':            void handleSave(false); break
      case 'saveAs':          void handleSave(true); break
      case 'saveACopy':       void handleSaveACopy(); break
      case 'export':          setShowExportDialog(true); break
      case 'clearRecentFiles': void handleClearRecentFiles(); break
      case 'undo':            handleUndo(); break
      case 'redo':            handleRedo(); break
      case 'cut':             handleCut(); break
      case 'copy':            handleCopy(); break
      case 'paste':           handlePaste(); break
      case 'delete':          handleDelete(); break
      case 'contentAwareFill':   handleOpenCafDialog('fill');   break
      case 'contentAwareDelete': handleOpenCafDialog('delete'); break
      case 'resizeImage':     setShowResizeDialog(true); break
      case 'resizeCanvas':    setShowResizeCanvasDialog(true); break
      case 'freeTransform':   requireTransformDecision(handleEnterTransform); break
      case 'invertSelection': selectionStore.invert(); break
      case 'selectAll':        handleSelectAll(); break
      case 'deselect':         handleDeselect(); break
      case 'selectAllLayers':  handleSelectAllLayers(); break
      case 'deselectLayers':   handleDeselectLayers(); break
      case 'findLayers':       handleFindLayers(); break
      case 'newLayer':        handleNewLayer(); break
      case 'duplicateLayer':  handleDuplicateLayer(); break
      case 'deleteLayer':     handleDeleteActiveLayer(); break
      case 'rasterizeLayer':  state.activeLayerId && handleRasterizeLayer(state.activeLayerId); break
      case 'groupLayers':     handleGroupLayers(); break
      case 'ungroupLayers':   handleUngroupLayers(); break
      case 'mergeSelected':   handleMergeSelected([...effectiveSelectedIds]); break
      case 'mergeDown':       handleMergeDown(); break
      case 'mergeVisible':    handleMergeVisible(); break
      case 'flattenImage':    handleFlattenImage(); break
      case 'zoomIn':          handleZoomIn(); break
      case 'zoomOut':         handleZoomOut(); break
      case 'fitToWindow':     handleFitToWindow(); break
      case 'toggleGrid':      handleToggleGrid(); break
      case 'about':           setShowAboutDialog(true); break
      case 'keyboardShortcuts': setShowShortcutsDialog(true); break
      case 'openDevTools':    window.api.openDevTools(); break
    }
  }, [
    requireTransformDecision, adjustments, filters, handleOpenFilterDialog,
    handleOpen, handleOpenPath, handleClose, handleCloseAll, handleSave, handleSaveACopy,
    handleClearRecentFiles, recentFiles,
    handleUndo, handleRedo, handleCut, handleCopy, handlePaste,
    handleDelete, handleNewLayer, handleDuplicateLayer, handleDeleteActiveLayer,
    handleRasterizeLayer, handleGroupLayers, handleUngroupLayers, handleMergeSelected,
    handleMergeDown, handleMergeVisible, handleFlattenImage, handleZoomIn, handleZoomOut,
    handleFitToWindow, handleToggleGrid, handleEnterTransform,
    handleSelectAll, handleDeselect, handleSelectAllLayers, handleDeselectLayers,
    handleFindLayers,
    handleOpenCafDialog,
    state.activeLayerId, effectiveSelectedIds,
  ])

  // Build the native menu once on mount (sends the dynamic items list to the main process).
  useEffect(() => {
    if (!isMac) return
    window.api.buildNativeMenu({
      adjustments: ADJUSTMENT_MENU_ITEMS.map(i => ({ id: i.type, label: i.label, group: i.group })),
      effects:     EFFECTS_MENU_ITEMS.map(i => ({ id: i.type, label: i.label, group: i.group })),
      filters:     FILTER_MENU_ITEMS.map(i => ({ id: i.key, label: i.label, group: i.group })),
      recentFiles,
    })
  }, [isMac, recentFiles])

  // Register the IPC action listener once. Handler is always fresh via the ref.
  useEffect(() => {
    if (!isMac) return
    const cleanup = window.api.onMenuAction((actionId) => macMenuHandlerRef.current(actionId))
    return cleanup
  }, [isMac])

  // Sync enabled/disabled state of native menu items when app state changes.
  useEffect(() => {
    if (!isMac) return
    const enabled: Record<string, boolean> = {
      freeTransform:    isFreeTransformEnabled,
      rasterizeLayer:   isRasterizeLayerEnabled,
      mergeSelected:    isMergeSelectedEnabled,
      contentAwareFill:   hasSelection && !isContentAwareFilling,
      contentAwareDelete: hasSelection && !isContentAwareFilling,
    }
    for (const ai of ADJUSTMENT_MENU_ITEMS) enabled[`adj:${ai.type}`]   = adjustments.isAdjustmentMenuEnabled
    for (const ei of EFFECTS_MENU_ITEMS)    enabled[`adj:${ei.type}`]   = adjustments.isAdjustmentMenuEnabled
    for (const fi of FILTER_MENU_ITEMS)     enabled[`filter:${fi.key}`] = filters.isFiltersMenuEnabled
    window.api.setMenuItemEnabled(enabled)
  }, [isMac, isFreeTransformEnabled, isRasterizeLayerEnabled, isMergeSelectedEnabled,
      hasSelection, isContentAwareFilling, adjustments.isAdjustmentMenuEnabled, filters.isFiltersMenuEnabled])

  // Sync Show Grid checkbox state.
  useEffect(() => {
    if (!isMac) return
    window.api.setMenuItemChecked({ toggleGrid: state.canvas.showGrid })
  }, [isMac, state.canvas.showGrid])

  return (
    <div className={styles.app}>
      <TopBar
        isMac={isMac}
        onDebug={() => window.api.openDevTools()}
        onNew={() => setShowNewImageDialog(true)}
        onOpen={handleOpen}
        onSave={() => void handleSave(false)}
        onSaveAs={() => void handleSave(true)}
        onSaveACopy={handleSaveACopy}
        onExport={() => setShowExportDialog(true)}
        onClose={handleClose}
        onCloseAll={handleCloseAll}
        recentFiles={recentFiles}
        onOpenRecent={handleOpenPath}
        onClearRecentFiles={handleClearRecentFiles}
        onExit={() => void window.api.exitApp()}
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
        onRasterizeLayer={state.activeLayerId ? () => handleRasterizeLayer(state.activeLayerId!) : undefined}
        isRasterizeEnabled={isRasterizeLayerEnabled}
        onMergeSelected={() => {
          const ids = [...effectiveSelectedIds]
          handleMergeSelected(ids)
        }}
        isMergeSelectedEnabled={isMergeSelectedEnabled}
        onAbout={() => setShowAboutDialog(true)}
        onKeyboardShortcuts={() => setShowShortcutsDialog(true)}
        onCreateAdjustmentLayer={(type) => requireTransformDecision(() => adjustments.handleCreateAdjustmentLayer(type))}
        isAdjustmentMenuEnabled={adjustments.isAdjustmentMenuEnabled}
        adjustmentMenuItems={ADJUSTMENT_MENU_ITEMS}
        effectsMenuItems={EFFECTS_MENU_ITEMS}
        onOpenFilterDialog={handleOpenFilterDialog}
        onInstantFilter={(key) => requireTransformDecision(() => filters.handleInstantFilter(key))}
        isFiltersMenuEnabled={filters.isFiltersMenuEnabled}
        filterMenuItems={FILTER_MENU_ITEMS}
        onFreeTransform={handleEnterTransform}
        isFreeTransformEnabled={isFreeTransformEnabled}
        onInvertSelection={() => selectionStore.invert()}
        onSelectAll={handleSelectAll}
        onDeselect={handleDeselect}
        onSelectAllLayers={handleSelectAllLayers}
        onDeselectLayers={handleDeselectLayers}
        onFindLayers={handleFindLayers}
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
          <ContentAwareFillProgress visible={isContentAwareFilling} label={contentAwareFillLabel} sublabel="Analyzing image…" />
        </main>
        <RightPanel
          activeTabId={activeTabId}
          onMergeSelected={handleMergeSelected}
          onMergeVisible={handleMergeVisible}
          onMergeDown={handleMergeDown}
          onFlattenImage={handleFlattenImage}
          onRasterizeLayer={handleRasterizeLayer}
          onDuplicateLayer={handleDuplicateLayer}
          onOpenAdjustmentPanel={(id) => requireTransformDecision(() => adjustments.handleOpenAdjustmentPanel(id))}
          onGeneratePalette={() => setShowGeneratePaletteDialog(true)}
          onMergeGroup={handleMergeGroup}
          onGroupSelected={handleGroupLayers}
          onUngroup={handleUngroupLayers}
          findLayersTrigger={findLayersCounter}
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

      <ContentAwareFillOptionsDialog
        open={showContentAwareFillOptionsDialog}
        mode={contentAwareFillOptionsMode}
        onConfirm={handleCafConfirm}
        onCancel={() => setShowContentAwareFillOptionsDialog(false)}
      />

      {cloneStampNotification && (
        <div className={styles.notification}>{cloneStampNotification}</div>
      )}

      {contentAwareFillError && (
        <div className={styles.notification}>{contentAwareFillError}</div>
      )}

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

