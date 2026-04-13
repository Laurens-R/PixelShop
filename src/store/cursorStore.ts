// ─── Cursor store ─────────────────────────────────────────────────────────────
// Module-level singleton. Canvas publishes pointer position here; StatusBar
// subscribes to display it. Kept outside React state to avoid re-render storms
// on every pointer-move event.

type Listener = () => void

class CursorStore {
  x: number = 0
  y: number = 0
  visible: boolean = false

  private listeners = new Set<Listener>()

  subscribe(fn: Listener): void   { this.listeners.add(fn) }
  unsubscribe(fn: Listener): void { this.listeners.delete(fn) }
  private notify(): void          { for (const fn of this.listeners) fn() }

  setPosition(x: number, y: number): void {
    this.x = x
    this.y = y
    this.visible = true
    this.notify()
  }

  hide(): void {
    if (!this.visible) return
    this.visible = false
    this.notify()
  }
}

export const cursorStore = new CursorStore()
