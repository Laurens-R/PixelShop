import type { HistoryEntry } from '@/store/historyStore'
import type { LayerState, BackgroundFill } from '@/types'

// ─── Tab snapshot ─────────────────────────────────────────────────────────────

export interface TabSnapshot {
  canvasWidth: number
  canvasHeight: number
  backgroundFill: BackgroundFill
  layers: LayerState[]
  activeLayerId: string | null
  zoom: number
}

// ─── Tab record ───────────────────────────────────────────────────────────────

export interface TabRecord {
  id: string
  title: string
  filePath: string | null
  snapshot: TabSnapshot
  /** Pixel data for each layer — null while tab is active (data lives in WebGL) */
  savedLayerData: Map<string, string> | null
  /** History stack — null while tab is active (historyStore holds the live data) */
  savedHistory: { entries: HistoryEntry[]; currentIndex: number } | null
  /** Incremented to force this tab's Canvas to remount (resize / crop). */
  canvasKey: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function makeTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function fileTitle(p: string): string {
  return p.split(/[\\/]/).pop() ?? 'Untitled'
}

export const INITIAL_SNAPSHOT: TabSnapshot = {
  canvasWidth: 512,
  canvasHeight: 512,
  backgroundFill: 'white',
  layers: [{ id: 'layer-0', name: 'Background', visible: true, opacity: 1, locked: false, blendMode: 'normal' }],
  activeLayerId: 'layer-0',
  zoom: 1,
}
