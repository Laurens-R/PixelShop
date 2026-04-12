import React, { useRef, useState } from 'react'
import { AppProvider } from '@/store/AppContext'
import { CanvasProvider } from '@/store/CanvasContext'
import { TopBar } from '@/components/TopBar/TopBar'
import { ToolOptionsBar } from '@/components/ToolOptionsBar/ToolOptionsBar'
import { TabBar } from '@/components/TabBar/TabBar'
import { Toolbar } from '@/components/Toolbar/Toolbar'
import { Canvas } from '@/components/Canvas/Canvas'
import type { CanvasHandle } from '@/components/Canvas/Canvas'
import { RightPanel } from '@/components/RightPanel/RightPanel'
import { StatusBar } from '@/components/StatusBar/StatusBar'
import { NewImageDialog } from '@/components/NewImageDialog/NewImageDialog'
import { useAppContext } from '@/store/AppContext'
import type { LayerState } from '@/types'
import styles from './App.module.scss'

function AppContent(): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const [showNewImageDialog, setShowNewImageDialog] = useState(false)
  const canvasHandleRef = useRef<CanvasHandle>(null)
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [pendingLayerData, setPendingLayerData] = useState<Map<string, string> | null>(null)

  // ── Save ──────────────────────────────────────────────────────────
  const handleSave = async (saveAs = false): Promise<void> => {
    let path = saveAs ? null : currentFilePath
    if (!path) {
      path = await window.api.savePxshopDialog(currentFilePath ?? undefined)
      if (!path) return
    }

    const layerPngs: Record<string, string> = {}
    for (const layer of state.layers) {
      const png = canvasHandleRef.current?.exportLayerPng(layer.id)
      if (png) layerPngs[layer.id] = png
    }

    const doc = {
      version: 1,
      canvas: { width: state.canvas.width, height: state.canvas.height },
      activeLayerId: state.activeLayerId,
      layers: state.layers.map((l) => ({ ...l, pngData: layerPngs[l.id] ?? null }))
    }

    await window.api.savePxshopFile(path, JSON.stringify(doc))
    setCurrentFilePath(path)
  }

  // ── Open ──────────────────────────────────────────────────────────
  const handleOpen = async (): Promise<void> => {
    const path = await window.api.openPxshopDialog()
    if (!path) return

    const json = await window.api.openPxshopFile(path)
    const doc = JSON.parse(json) as {
      version: number
      canvas: { width: number; height: number }
      activeLayerId: string | null
      layers: Array<LayerState & { pngData?: string | null }>
    }

    const layerData = new Map<string, string>()
    const layers: LayerState[] = doc.layers.map(({ pngData, ...meta }) => {
      if (pngData) layerData.set(meta.id, pngData)
      return meta
    })

    setPendingLayerData(layerData)
    dispatch({
      type: 'OPEN_FILE',
      payload: {
        width: doc.canvas.width,
        height: doc.canvas.height,
        layers,
        activeLayerId: doc.activeLayerId ?? layers[0]?.id ?? null
      }
    })
    setCurrentFilePath(path)
  }

  return (
    <div className={styles.app}>
      {/* ── Chrome rows ───────────────────────────────────────────────── */}
      <TopBar
        onNew={() => setShowNewImageDialog(true)}
        onOpen={handleOpen}
        onSave={() => handleSave(false)}
        onSaveAs={() => handleSave(true)}
      />
      <ToolOptionsBar />
      <TabBar />

      {/* ── Main workspace ────────────────────────────────────────────── */}
      <div className={styles.workspace}>
        {/* Left: tools */}
        <Toolbar
          activeTool={state.activeTool}
          onToolChange={(tool) => dispatch({ type: 'SET_TOOL', payload: tool })}
        />

        {/* Center: canvas */}
        <main className={styles.canvasArea}>
          <Canvas
            key={state.canvas.key}
            ref={canvasHandleRef}
            width={state.canvas.width}
            height={state.canvas.height}
            initialLayerData={pendingLayerData ?? undefined}
          />
        </main>

        {/* Right: color + layers */}
        <RightPanel />
      </div>

      {/* ── Status bar ────────────────────────────────────────────────── */}
      <StatusBar />

      {/* ── Dialogs ─────────────────────────────────────────────────── */}
      <NewImageDialog
        open={showNewImageDialog}
        onCancel={() => setShowNewImageDialog(false)}
        onConfirm={({ width, height, backgroundFill }) => {
          setPendingLayerData(null)
          dispatch({ type: 'NEW_CANVAS', payload: { width, height, backgroundFill } })
          setShowNewImageDialog(false)
        }}
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

