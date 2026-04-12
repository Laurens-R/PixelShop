import React, { useState } from 'react'
import { AppProvider } from '@/store/AppContext'
import { CanvasProvider } from '@/store/CanvasContext'
import { TopBar } from '@/components/TopBar/TopBar'
import { ToolOptionsBar } from '@/components/ToolOptionsBar/ToolOptionsBar'
import { TabBar } from '@/components/TabBar/TabBar'
import { Toolbar } from '@/components/Toolbar/Toolbar'
import { Canvas } from '@/components/Canvas/Canvas'
import { RightPanel } from '@/components/RightPanel/RightPanel'
import { StatusBar } from '@/components/StatusBar/StatusBar'
import { NewImageDialog } from '@/components/NewImageDialog/NewImageDialog'
import { useAppContext } from '@/store/AppContext'
import styles from './App.module.scss'

function AppContent(): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const [showNewImageDialog, setShowNewImageDialog] = useState(false)

  return (
    <div className={styles.app}>
      {/* ── Chrome rows ───────────────────────────────────────────────── */}
      <TopBar onNew={() => setShowNewImageDialog(true)} />
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
            width={state.canvas.width}
            height={state.canvas.height}
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

