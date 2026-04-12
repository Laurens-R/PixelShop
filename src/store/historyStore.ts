import type { LayerState } from '@/types'

// ─── History entry ────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string
  label: string
  timestamp: number
  /** Raw RGBA pixel data snapshot per layer, keyed by layer ID. */
  layerPixels: Map<string, Uint8Array>
  /** Per-layer dimensions and canvas-space offset at the time of the snapshot. */
  layerGeometry: Map<string, { layerWidth: number; layerHeight: number; offsetX: number; offsetY: number }>
  layerState: LayerState[]
  activeLayerId: string | null
  canvasWidth: number
  canvasHeight: number
}

// ─── Store ────────────────────────────────────────────────────────────────────

class HistoryStore {
  entries: HistoryEntry[] = []
  currentIndex = -1
  selectedIndex = -1
  private listeners = new Set<() => void>()

  /**
   * Registered by App.tsx. Called when the user clicks Restore.
   * Must perform the actual canvas pixel + app state restoration.
   */
  onJumpTo: ((index: number) => void) | null = null

  /**
   * Registered by App.tsx. Called on every click to preview a history entry
   * on the canvas without committing state.
   */
  onPreview: ((index: number) => void) | null = null

  push(entry: HistoryEntry): void {
    // Discard the redo chain (entries after currentIndex) before pushing
    this.entries = this.entries.slice(0, this.currentIndex + 1)
    this.entries.push(entry)
    this.currentIndex = this.entries.length - 1
    this.selectedIndex = this.currentIndex
    this.notify()
  }

  /** Select an entry visually and preview it on the canvas. */
  select(index: number): void {
    if (index < 0 || index >= this.entries.length) return
    this.selectedIndex = index
    this.notify()
    this.onPreview?.(index)
  }

  /** Apply the selected entry, truncating all future entries. */
  jumpTo(index: number): void {
    if (index < 0 || index >= this.entries.length) return
    if (index === this.currentIndex) return
    this.onJumpTo?.(index)
  }

  undo(): void {
    if (this.currentIndex <= 0) return
    this.onJumpTo?.(this.currentIndex - 1)
  }

  redo(): void {
    if (this.currentIndex >= this.entries.length - 1) return
    this.onJumpTo?.(this.currentIndex + 1)
  }

  canUndo(): boolean { return this.currentIndex > 0 }
  canRedo(): boolean { return this.currentIndex < this.entries.length - 1 }

  /** Called by App.tsx after applying an entry — updates cursor, does NOT truncate. */
  setCurrent(index: number): void {
    this.currentIndex = index
    this.selectedIndex = index
    this.notify()
  }

  clear(): void {
    this.entries = []
    this.currentIndex = -1
    this.selectedIndex = -1
    this.notify()
  }

  /**
   * Bulk-restore a previously snapshotted history state (e.g. when switching tabs).
   * Does NOT invoke onJumpTo/onPreview — the caller is responsible for
   * restoring canvas pixels separately.
   */
  restore(entries: HistoryEntry[], currentIndex: number): void {
    this.entries = entries
    this.currentIndex = currentIndex
    this.selectedIndex = currentIndex
    this.notify()
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb())
  }
}

export const historyStore = new HistoryStore()
