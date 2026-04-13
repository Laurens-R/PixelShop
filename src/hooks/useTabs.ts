import { useCallback, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { historyStore } from '@/store/historyStore'
import type { AppState } from '@/types'
import type { AppAction } from '@/store/AppContext'
import type { CanvasHandle } from '@/components/window/Canvas/Canvas'
import { makeTabId, INITIAL_SNAPSHOT } from '@/store/tabTypes'
import type { TabRecord, TabSnapshot } from '@/store/tabTypes'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseTabsReturn {
  tabs: TabRecord[]
  setTabs: Dispatch<SetStateAction<TabRecord[]>>
  activeTabId: string
  setActiveTabId: Dispatch<SetStateAction<string>>
  activeTabIdRef: React.MutableRefObject<string>
  setTabsRef: React.MutableRefObject<Dispatch<SetStateAction<TabRecord[]>>>
  canvasHandleRef: { readonly current: CanvasHandle | null }
  pendingLayerData: Map<string, string> | null
  setPendingLayerData: Dispatch<SetStateAction<Map<string, string> | null>>
  tabCanvasRef: (tabId: string) => (h: CanvasHandle | null) => void
  captureActiveSnapshot: () => TabSnapshot
  switchToTab: (toId: string, tabs_: TabRecord[]) => void
  handleSwitchTab: (toId: string) => void
  handleCloseTab: (tabId: string) => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTabs(state: AppState, dispatch: Dispatch<AppAction>): UseTabsReturn {
  // Per-tab canvas handle map — avoids ref-null races on tab close/switch
  const canvasHandlesRef        = useRef(new Map<string, CanvasHandle>())
  const canvasRefCallbacksRef   = useRef(new Map<string, (h: CanvasHandle | null) => void>())
  const activeTabIdRef          = useRef('')
  const setTabsRef              = useRef<Dispatch<SetStateAction<TabRecord[]>>>(() => {})

  // Stable proxy — always returns the ACTIVE tab's canvas handle
  const canvasHandleRef = useMemo(() => ({
    get current(): CanvasHandle | null {
      return canvasHandlesRef.current.get(activeTabIdRef.current) ?? null
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

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
  const [activeTabId, setActiveTabId]         = useState(initialTabId)
  const [pendingLayerData, setPendingLayerData] = useState<Map<string, string> | null>(null)

  // Keep refs in sync each render so async closures always see fresh values
  activeTabIdRef.current = activeTabId
  setTabsRef.current     = setTabs

  /** Returns a stable callback ref for a given tab id. */
  const tabCanvasRef = useCallback((tabId: string): (h: CanvasHandle | null) => void => {
    if (!canvasRefCallbacksRef.current.has(tabId)) {
      canvasRefCallbacksRef.current.set(tabId, (h) => {
        if (h) canvasHandlesRef.current.set(tabId, h)
        else   canvasHandlesRef.current.delete(tabId)
      })
    }
    return canvasRefCallbacksRef.current.get(tabId)!
  }, [])

  const captureActiveSnapshot = useCallback((): TabSnapshot => ({
    canvasWidth:    state.canvas.width,
    canvasHeight:   state.canvas.height,
    backgroundFill: state.canvas.backgroundFill,
    layers:         state.layers,
    activeLayerId:  state.activeLayerId,
    zoom:           state.canvas.zoom,
  }), [state])

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
        width:          toTab.snapshot.canvasWidth,
        height:         toTab.snapshot.canvasHeight,
        backgroundFill: toTab.snapshot.backgroundFill,
        layers:         toTab.snapshot.layers,
        activeLayerId:  toTab.snapshot.activeLayerId,
        zoom:           toTab.snapshot.zoom,
      },
    })
  }, [dispatch])

  const handleSwitchTab = useCallback((toId: string): void => {
    if (toId === activeTabId) return
    const snapshot    = captureActiveSnapshot()
    const savedHistory = { entries: historyStore.entries.slice(), currentIndex: historyStore.currentIndex }
    const updated     = tabs.map(t => t.id === activeTabId ? { ...t, snapshot, savedHistory } : t)
    setTabs(updated)
    switchToTab(toId, updated)
  }, [activeTabId, tabs, captureActiveSnapshot, switchToTab])

  const handleCloseTab = useCallback((tabId: string): void => {
    if (tabs.length === 1) return
    const idx  = tabs.findIndex(t => t.id === tabId)
    const next = tabs.filter(t => t.id !== tabId)
    setTabs(next)
    if (tabId === activeTabId) {
      const fallback = next[Math.min(idx, next.length - 1)]
      switchToTab(fallback.id, next)
    }
  }, [tabs, activeTabId, switchToTab])

  return {
    tabs, setTabs,
    activeTabId, setActiveTabId,
    activeTabIdRef, setTabsRef,
    canvasHandleRef,
    pendingLayerData, setPendingLayerData,
    tabCanvasRef,
    captureActiveSnapshot,
    switchToTab,
    handleSwitchTab, handleCloseTab,
  }
}
