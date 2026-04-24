# Technical Design: Polygonal Selection Tool

## Overview

The Polygonal Selection Tool (Polygonal Lasso) lets users build a straight-edged, multi-vertex selection by clicking to place anchor points one at a time. It shares the existing `selectionStore` mask infrastructure with the Marquee and Lasso tools, and commits the polygon via the already-present `setPolygon()` scanline fill method. The feature requires two new files (`src/tools/polygonalSelection.tsx` and `src/store/polygonalSelectionStore.ts`), one new `SelectionMode` value (`'intersect'`) added to `selectionStore.ts`, a new `Tool` literal in `src/types/index.ts`, and targeted changes in `Canvas.tsx` and `Toolbar.tsx` to wire up the overlay and keyboard handling.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'polygonal-selection'` to the `Tool` union |
| `src/store/selectionStore.ts` | Add `'intersect'` to `SelectionMode`; add intersect branch in `applyMask` |
| `src/store/polygonalSelectionStore.ts` | **New file** — module-level singleton managing in-progress polygon state |
| `src/tools/polygonalSelection.tsx` | **New file** — `createPolygonalSelectionHandler` + `PolygonalSelectionOptions` UI |
| `src/tools/index.ts` | Import and register `polygonalSelectionTool` in `TOOL_REGISTRY` |
| `src/components/window/Canvas/Canvas.tsx` | Subscribe to `polygonalSelectionStore` for overlay drawing and keyboard interception |
| `src/components/window/Toolbar/Toolbar.tsx` | Add polygonal lasso icon and `TOOL_GRID` entry |

---

## State Changes

### `src/types/index.ts` — Tool union

Add `'polygonal-selection'` to the `Tool` type:

```ts
export type Tool =
  | 'move'
  | 'select'
  | 'lasso'
  | 'polygonal-selection'   // ← new
  | 'magic-wand'
  // … rest unchanged
```

No `AppState` fields are added. The in-progress polygon lives in the module-level `polygonalSelectionStore`, not in React state, consistent with the singleton pattern used by `transformStore`, `cloneStampStore`, etc.

### `src/store/selectionStore.ts` — SelectionMode

Extend `SelectionMode`:

```ts
export type SelectionMode = 'set' | 'add' | 'subtract' | 'intersect'
```

Add an intersect branch in `applyMask` immediately after the `add` branch:

```ts
} else if (mode === 'intersect') {
  // Intersection: retain only pixels selected in both masks.
  // When there is no existing mask, intersect with "everything selected" → keep the new mask as-is.
  if (this.mask) {
    for (let i = 0; i < newMask.length; i++) {
      this.mask[i] = Math.min(this.mask[i], newMask[i])
    }
    // If the result is entirely zero, treat as no selection.
    let any = false
    for (let i = 0; i < this.mask.length; i++) if (this.mask[i]) { any = true; break }
    if (!any) { this.mask = null; this.borderSegments = null; return }
  } else {
    this.mask = newMask
  }
```

The existing `setPolygon`, `setRect`, and `floodFillSelect` methods already pass `mode` through to `applyMask` — no signature changes needed.

---

## New Files

### `src/store/polygonalSelectionStore.ts`

A module-level singleton. Both the tool handler and the Canvas.tsx overlay effect import it directly (no React state or context).

**Responsibilities:**
- Owns the canonical in-progress polygon state: `vertices`, `cursor`, `nearClose`
- Provides imperative methods for the tool handler (`addVertex`, `setCursor`, `reset`)
- Provides imperative cancel/undo methods for the Canvas.tsx keyboard handler
- Notifies subscribers (the overlay `useEffect`) on every state change

**Full type / shape:**

```ts
import type { Point } from '@/types'
import { selectionStore } from './selectionStore'
import type { SelectionMode } from './selectionStore'

type Listener = () => void

class PolygonalSelectionStore {
  vertices: Point[] = []
  cursor: Point = { x: 0, y: 0 }
  nearClose = false
  /** Mode locked at the first click. Only meaningful while vertices.length > 0. */
  lockedMode: SelectionMode = 'set'

  private listeners = new Set<Listener>()

  get isActive(): boolean { return this.vertices.length > 0 }

  subscribe(fn: Listener): void   { this.listeners.add(fn) }
  unsubscribe(fn: Listener): void { this.listeners.delete(fn) }
  notify(): void                  { for (const fn of this.listeners) fn() }

  /** Called by tool handler on first click. Locks mode and places origin vertex. */
  start(origin: Point, mode: SelectionMode): void {
    this.vertices = [origin]
    this.lockedMode = mode
    this.nearClose = false
    this.notify()
  }

  /** Called by tool handler on each subsequent click. */
  addVertex(p: Point): void {
    this.vertices = [...this.vertices, p]
    this.notify()
  }

  /** Called by tool handler and onHover to track cursor for rubber-band. */
  setCursor(p: Point, nearClose: boolean): void {
    this.cursor = p
    this.nearClose = nearClose
    this.notify()
  }

  /**
   * Called by tool handler on snap-close or double-click, and by Canvas.tsx
   * keyboard handler on Enter (if ever wired). Commits polygon to selectionStore
   * and resets. Silently discards if fewer than 3 vertices.
   */
  commit(): void {
    if (this.vertices.length >= 3) {
      selectionStore.setPolygon(this.vertices, this.lockedMode)
    }
    this.reset()
  }

  /**
   * Called by Canvas.tsx keyboard handler (Escape) and by the tool handler
   * when the polygon cannot be committed. Does NOT clear the existing committed
   * selection — only discards the in-progress polygon.
   */
  cancel(): void {
    this.reset()
    selectionStore.setPending(null)
  }

  /**
   * Called by Canvas.tsx keyboard handler (Backspace / Delete).
   * Removes the most recently placed vertex. If only the origin remains,
   * cancels entirely.
   */
  removeLastVertex(): void {
    if (this.vertices.length <= 1) { this.cancel(); return }
    this.vertices = this.vertices.slice(0, -1)
    this.notify()
  }

  private reset(): void {
    this.vertices = []
    this.nearClose = false
    this.notify()
  }
}

export const polygonalSelectionStore = new PolygonalSelectionStore()
```

**Why a dedicated store?** The keyboard handler in Canvas.tsx must be able to call `cancel()` and `removeLastVertex()` without having access to the tool handler closure. Delegating state ownership to the store solves this. It also mirrors the existing `transformStore` and `cloneStampStore` pattern.

---

### `src/tools/polygonalSelection.tsx`

Exports `polygonalSelectionTool: ToolDefinition`.

#### Module-level options object

```ts
export const polygonalSelectionOptions = {
  mode: 'set' as SelectionMode,
}
```

This is the persisted default when no modifier key is held. Follows the same pattern as `brushOptions`, `selectOptions`, etc.

#### Handler factory

`createPolygonalSelectionHandler()` is a thin event translator — all state lives in `polygonalSelectionStore`.

```ts
const SNAP_RADIUS_PX = 12   // screen-space pixels

function isNearOrigin(x: number, y: number, zoom: number): boolean {
  const store = polygonalSelectionStore
  if (store.vertices.length < 3) return false   // need ≥3 points before snap is meaningful
  const { x: ox, y: oy } = store.vertices[0]
  const dx = (x - ox) * zoom / window.devicePixelRatio
  const dy = (y - oy) * zoom / window.devicePixelRatio
  return (dx * dx + dy * dy) < SNAP_RADIUS_PX * SNAP_RADIUS_PX
}

function createPolygonalSelectionHandler(): ToolHandler {
  let lastClickTime = 0   // for double-click detection; closure-local, not in store

  return {
    onPointerDown({ x, y, shiftKey, altKey, timeStamp }, ctx) {
      const now = timeStamp
      const store = polygonalSelectionStore

      if (!store.isActive) {
        // First click: lock mode and place origin
        const mode: SelectionMode =
          (shiftKey && altKey) ? 'intersect'
          : altKey             ? 'subtract'
          : shiftKey           ? 'add'
          :                      polygonalSelectionOptions.mode
        store.start({ x, y }, mode)
        lastClickTime = now
        return
      }

      // Double-click detection: close without adding this position as a vertex
      const isDoubleClick = (now - lastClickTime) < 300
      lastClickTime = now
      if (isDoubleClick) { store.commit(); return }

      // Snap-close
      if (isNearOrigin(x, y, ctx.zoom)) { store.commit(); return }

      // Regular vertex
      store.addVertex({ x, y })
    },

    onPointerMove({ x, y }, ctx) {
      if (!polygonalSelectionStore.isActive) return
      polygonalSelectionStore.setCursor({ x, y }, isNearOrigin(x, y, ctx.zoom))
    },

    onHover({ x, y }, ctx) {
      if (!polygonalSelectionStore.isActive) return
      polygonalSelectionStore.setCursor({ x, y }, isNearOrigin(x, y, ctx.zoom))
    },

    onLeave() {
      // Do not cancel — polygon persists across hover leave.
      // The rubber-band simply won't move until the pointer re-enters.
    },

    onPointerUp() { /* click-based tool; nothing to finalize per-up */ },
  }
}
```

**State that lives in the closure vs. the store:**
- `lastClickTime` — closure-local. The keyboard handler does not need it.
- All polygon geometry — owned by `polygonalSelectionStore`. Accessible from anywhere.

**Coordinate space note:** `useCanvas.ts` passes `Math.floor((clientX - rect.left) * scaleX)` — canvas-pixel integers. No conversion is needed before writing into `store.vertices`.

#### Options UI

```tsx
function PolygonalSelectionOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [mode, setMode] = useState(polygonalSelectionOptions.mode)

  const setM = (m: SelectionMode) => {
    polygonalSelectionOptions.mode = m
    setMode(m)
  }

  return (
    <>
      <label className={styles.optLabel}>Mode:</label>
      {/* Four icon-buttons: New (set), Add, Subtract, Intersect */}
      {(['set', 'add', 'subtract', 'intersect'] as const).map(m => (
        <button
          key={m}
          className={`${styles.optModeBtn} ${mode === m ? styles.optModeBtnActive : ''}`}
          title={modeLabel(m)}
          onClick={() => setM(m)}
        >
          {modeIcon(m)}
        </button>
      ))}
    </>
  )
}
```

`modeLabel` and `modeIcon` are small helpers defined in the same file. The four icons match the Photoshop convention (new rectangle, union rectangles, subtract rectangle, intersect rectangles) rendered as inline SVGs. The CSS class `optModeBtn` and `optModeBtnActive` must be added to `ToolOptionsBar.module.scss`.

#### Export

```ts
export const polygonalSelectionTool: ToolDefinition = {
  createHandler: createPolygonalSelectionHandler,
  Options: PolygonalSelectionOptions,
}
```

`modifiesPixels` is **not** set — the tool writes only to the selection mask, not to pixel layer data.

---

## Rubber-Band Overlay

### Chosen approach: `toolOverlayRef` canvas in Canvas.tsx

The `toolOverlayRef` is a `<canvas>` element stacked absolutely over the WebGPU canvas (z-index above the selection overlay `overlayRef`). It is already used by the transform and clone-stamp tools via dedicated `useEffect` subscriptions.

**Why not `selectionStore.pending`?**
The existing `pending` → `useMarchingAnts` path renders only a simple connected path with no control over individual segment styles, no close-indicator circle, and no near-close animation. Extending `PendingSelection` with a new `polygonal` discriminant and updating `useMarchingAnts` would couple selection rendering concerns across two files. The `toolOverlayRef` / `useEffect` pattern is cleaner and more powerful.

**Why not an SVG overlay?**
No SVG overlay exists in the current DOM. The `toolOverlayRef` canvas is already present and correctly positioned; adding an SVG element for one tool is unnecessary.

### Canvas.tsx overlay effect

Add a `useEffect` block following the existing `clone-stamp` effect:

```ts
useEffect(() => {
  if (!isActive || state.activeTool !== 'polygonal-selection') return

  const redraw = (): void => {
    const oc = toolOverlayRef.current
    if (!oc) return
    const ctx2d = oc.getContext('2d')
    if (!ctx2d) return
    ctx2d.clearRect(0, 0, oc.width, oc.height)

    const { vertices, cursor, nearClose } = polygonalSelectionStore
    if (vertices.length === 0) return

    // ── Committed edges + rubber-band ─────────────────────────────────
    ctx2d.strokeStyle = '#00aaff'
    ctx2d.lineWidth   = 1
    ctx2d.setLineDash([4, 2])
    ctx2d.lineDashOffset = 0
    ctx2d.beginPath()
    ctx2d.moveTo(vertices[0].x, vertices[0].y)
    for (let i = 1; i < vertices.length; i++) ctx2d.lineTo(vertices[i].x, vertices[i].y)
    ctx2d.lineTo(cursor.x, cursor.y)   // rubber-band to cursor
    ctx2d.stroke()

    // ── Origin close-indicator ────────────────────────────────────────
    ctx2d.setLineDash([])
    const radius = nearClose ? 5 : 3
    ctx2d.lineWidth   = nearClose ? 2 : 1
    ctx2d.strokeStyle = nearClose ? '#ffffff' : '#00aaff'
    ctx2d.beginPath()
    ctx2d.arc(vertices[0].x, vertices[0].y, radius, 0, Math.PI * 2)
    ctx2d.stroke()
  }

  redraw()
  polygonalSelectionStore.subscribe(redraw)

  // ── Keyboard interception (capture phase) ────────────────────────────
  // Must fire before useKeyboardShortcuts' bubble-phase listener to prevent
  // Escape from clearing the committed selection and Backspace from deleting
  // layer contents while a polygon is in progress.
  const onKey = (e: KeyboardEvent): void => {
    if (!polygonalSelectionStore.isActive) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      polygonalSelectionStore.cancel()
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.stopPropagation()
      e.preventDefault()
      polygonalSelectionStore.removeLastVertex()
    }
  }
  document.addEventListener('keydown', onKey, true)   // capture phase

  return () => {
    polygonalSelectionStore.unsubscribe(redraw)
    document.removeEventListener('keydown', onKey, true)
    const oc = toolOverlayRef.current
    oc?.getContext('2d')?.clearRect(0, 0, oc.width, oc.height)
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [isActive, state.activeTool])
```

The `redraw` function reads directly from `polygonalSelectionStore` (not from a `useRef` snapshot), so it always sees current state. Since `polygonalSelectionStore.notify()` is called synchronously by each store mutation, the overlay is updated on every pointer event without involving React's render cycle.

**Tool-switch cleanup:** When `state.activeTool` changes away from `'polygonal-selection'`, the effect cleanup runs — it unsubscribes, removes the keyboard listener, clears the overlay canvas, and (because `polygonalSelectionStore.cancel()` clears `vertices`) any in-progress polygon is discarded. The `cancel()` call should also be placed in the existing tool-switch effect in Canvas.tsx (the one that calls `TOOL_REGISTRY[state.activeTool].createHandler()`), so the store is cleared even if the `useEffect` cleanup fires before the store is notified:

```ts
// In the existing activeTool useEffect:
if (prev !== 'polygonal-selection' && state.activeTool !== 'polygonal-selection') {
  // nothing extra needed
} else if (prev === 'polygonal-selection') {
  polygonalSelectionStore.cancel()
}
```

Actually the simpler correct approach: just call `polygonalSelectionStore.cancel()` unconditionally in the tool-switch effect — it is a no-op when `vertices` is already empty.

---

## Polygon Rasterization

`selectionStore.setPolygon()` already implements a complete scanline fill algorithm in JavaScript. No WASM involvement is required.

### Existing algorithm (for reference)

```ts
// In SelectionStore.setPolygon():
for (let y = minY; y <= maxY; y++) {
  const xs: number[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    // Even-odd scanline intersections
    if ((ay <= y && by > y) || (by <= y && ay > y)) {
      xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax))
    }
  }
  xs.sort((a, b) => a - b)
  for (let k = 0; k + 1 < xs.length; k += 2) {
    // Fill between each pair of intersections, clamped to canvas bounds
    m.fill(255, y * w + lx2, y * w + rx2 + 1)
  }
}
```

This is the standard even-odd rule scanline fill. The result is a `Uint8Array` of size `width × height` (one byte per pixel, 0 = not selected, 255 = selected). The method already handles clipping to canvas bounds, the degenerate case of fewer than 3 vertices, and mode composition (set / add / subtract). After the intersect branch is added to `applyMask`, it handles intersect too.

### Edge cases handled by `setPolygon`

- **< 3 vertices** — early return; if mode is `'set'`, existing selection is cleared. The tool handler guards against calling `commit()` with fewer than 3 vertices, but `setPolygon` is also safe if called directly.
- **Entirely outside canvas** — scanline fills nothing; mask is all-zero; marching ants do not appear.
- **Partially outside canvas** — `lx2 = Math.max(0, ...)` and `rx2 = Math.min(w - 1, ...)` clip each span.
- **Two-point degenerate polygon** — produces zero or one scanline span → effectively zero area. No error; selection is silently empty (or unchanged in add/intersect mode).

No new rasterization code is needed.

---

## Keyboard Handling

### Conflict with `useKeyboardShortcuts`

`useKeyboardShortcuts` registers a **bubble-phase** `document.addEventListener('keydown', ...)` that does:
- `Escape` → `selectionStore.clear()` (clears the committed selection)
- `Backspace` / `Delete` → `handleDelete()` (deletes selected layer contents)

Both of these would corrupt the UX if they fired while a polygon is in progress.

### Solution: capture-phase listener in Canvas.tsx

The Canvas.tsx `useEffect` for the polygonal selection tool registers a capture-phase listener (`useCapture = true`). Capture-phase listeners fire before bubble-phase listeners on the same element. When `polygonalSelectionStore.isActive` is true:
- `Escape` → `stopPropagation()` + `polygonalSelectionStore.cancel()` — the bubble-phase Escape never fires.
- `Backspace` / `Delete` → `stopPropagation()` + `preventDefault()` + `polygonalSelectionStore.removeLastVertex()` — the bubble-phase Backspace never fires.

When `!polygonalSelectionStore.isActive` (idle state), the capture listener does nothing and both keys flow through to their existing global handlers unchanged.

This is exactly the pattern used by `useTransform.ts` for Enter/Escape during free transform.

### Input element guard

`useKeyboardShortcuts` already guards: `if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return`. The polygonal selection capture handler does **not** need this guard — if the user is typing in a text input, clicking that input defocuses the canvas area; `polygonalSelectionStore.isActive` is the correct gate.

---

## Cursor

### Idle state

When `state.activeTool === 'polygonal-selection'` and no polygon is in progress, show `cursor: crosshair` on the canvas element. The existing Canvas.tsx cursor assignment logic already handles this via `canvas.style.cursor` — add `'polygonal-selection'` to the same condition that assigns `'crosshair'` for `'lasso'`, `'select'`, and `'magic-wand'`:

In Canvas.tsx, the `<canvas>` JSX:
```tsx
cursor: (state.activeTool === 'brush' || state.activeTool === 'eraser') ? 'none'
      : (state.activeTool === 'polygonal-selection') ? 'crosshair'
      : undefined
```

### Near-close state

The close-indicator circle rendered on `toolOverlayRef` (a larger, white-stroked circle on the origin point) provides the visual near-close affordance without requiring a custom CSS cursor. This is sufficient per the spec.

No new `cursorStore` usage is needed. The brush-cursor `<div>` is only for circle-cursor tools (brush, eraser, clone-stamp) and must not be activated for this tool.

---

## Tool Registration

### `src/tools/index.ts`

```ts
import { polygonalSelectionTool } from './polygonalSelection'

export const TOOL_REGISTRY: Record<Tool, ToolDefinition> = {
  // … existing entries …
  'polygonal-selection': polygonalSelectionTool,
}
```

### `src/components/window/Toolbar/Toolbar.tsx`

Add a polygonal lasso SVG icon to the `Icon` map:

```tsx
polygonalLasso: (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3,13 3,5 7,2 13,4 13,10 8,13" strokeDasharray="2.5 1.5" />
    <circle cx="3" cy="13" r="1.2" fill="currentColor" />
  </svg>
),
```

Add a row to `TOOL_GRID` in the selection group, directly after the existing `lasso` entry:

```ts
// group 2 – selection
[
  { id: 'select',               label: 'Marquee',          shortcut: 'M', icon: Icon.select },
  { id: 'lasso',                label: 'Lasso',            shortcut: 'L', icon: Icon.lasso }
],
[
  { id: 'polygonal-selection',  label: 'Polygonal Lasso',  shortcut: 'L', icon: Icon.polygonalLasso },
  { id: 'magic-wand',           label: 'Magic Wand',       shortcut: 'W', icon: Icon.magicWand }
],
```

This gives the tool its own toolbar slot. The keyboard shortcut **L** activates the polygonal lasso directly from the keyboard. The keyboard-shortcut dispatching logic in `App.tsx` (wherever tool shortcuts like `M`, `W`, `B` are mapped) must be extended to map `'l'` to `'polygonal-selection'` (or cycle between `'lasso'` and `'polygonal-selection'` — see Open Questions).

---

## Selection Mode

The mode is determined by modifier keys held **at the first click** — locking for the entire polygon session. The precedence:

| Modifiers at first click | Locked mode |
|---|---|
| None | `polygonalSelectionOptions.mode` (options bar default) |
| Shift | `'add'` |
| Alt | `'subtract'` |
| Shift + Alt | `'intersect'` |

The modifier check happens in `onPointerDown` when `!store.isActive`. Subsequent clicks within the same polygon session do not re-evaluate modifiers.

The options bar provides four mode buttons (New/Add/Subtract/Intersect) that set `polygonalSelectionOptions.mode`. This persistent default is used only when no modifier is held at the first click.

### Intersect mode — added in this PR

`'intersect'` is added to `SelectionMode` and implemented in `applyMask`. This is required by the spec and the implementation is small (≈8 lines). The marquee and lasso tools will not expose intersect from their options bars in this PR, but the new `SelectionMode` value is ready for them to adopt when needed. Modifier keys (Shift+Alt) already work with the marquee and lasso tools' `mode` derivation expressions, which need to be updated to include the `shiftKey && altKey` case — this is a 1-line change per tool to avoid a `'subtract'` misfire when both are held simultaneously.

---

## Implementation Steps

1. **`src/types/index.ts`** — Add `'polygonal-selection'` to the `Tool` union (single-line edit).

2. **`src/store/selectionStore.ts`** — Add `'intersect'` to `SelectionMode`. Add the intersect branch in `applyMask` (≈8 lines, placed between the `add` and `subtract` branches). Also update `lasso.tsx` and `select.tsx` to add the `shiftKey && altKey` → `'intersect'` guard so holding both modifiers does not produce a subtraction with those tools.

3. **`src/store/polygonalSelectionStore.ts`** — Create the new singleton class as specified above. Export the singleton instance as `polygonalSelectionStore`.

4. **`src/tools/polygonalSelection.tsx`** — Implement `polygonalSelectionOptions`, `createPolygonalSelectionHandler`, and `PolygonalSelectionOptions`. Export `polygonalSelectionTool`. The mode icon helpers (`modeLabel`, `modeIcon`) can be simple inline functions.

5. **`src/tools/index.ts`** — Import `polygonalSelectionTool` from `'./polygonalSelection'` and add `'polygonal-selection': polygonalSelectionTool` to `TOOL_REGISTRY`.

6. **`src/components/window/Canvas/Canvas.tsx`** — Add the `polygonalSelectionStore` overlay `useEffect` as specified. Add `polygonalSelectionStore.cancel()` to the existing tool-switch effect. Update the canvas cursor expression to include `'polygonal-selection'` → `'crosshair'`. Add the `polygonalSelection` import at the top.

7. **`src/components/window/Toolbar/Toolbar.tsx`** — Add the `polygonalLasso` icon to `Icon`. Add the `'polygonal-selection'` entry to `TOOL_GRID`.

8. **Keyboard shortcut in `App.tsx`** — Locate wherever single-letter tool shortcuts (`'m'`, `'l'`, `'w'`, etc.) are dispatched (likely in `useKeyboardShortcuts` or inline in `App.tsx`) and add `'l'` → dispatch `SET_ACTIVE_TOOL: 'polygonal-selection'` (or implement cycling — see Open Questions).

9. **`ToolOptionsBar.module.scss`** — Add `.optModeBtn` and `.optModeBtnActive` CSS classes for the four selection-mode buttons. Use the same styling conventions as other option controls in the bar.

---

## Architectural Constraints

**Module-level options object:** `polygonalSelectionOptions` is module-level (not React state) so the tool handler can read it synchronously without capturing stale state in a closure. This is mandatory per `AGENTS.md`.

**`toolOverlayRef` canvas, not React state:** The overlay is driven imperatively via the `polygonalSelectionStore` subscription. Updating overlay appearance via React state would cause re-renders on every pointer-move event — expressly forbidden for cursor and overlay effects per `AGENTS.md`.

**No raw DOM listeners in the tool handler:** The keyboard handler goes in Canvas.tsx, not in the tool file. Tool handlers only respond to the pointer event interface delivered through `useCanvas` → Canvas.tsx → `ToolHandler`. Per `AGENTS.md`: "Never attach raw DOM mouse/touch listeners in tools."

**No `rendererRef.current` in effect dependencies:** The overlay `useEffect` does not reference `rendererRef.current` and therefore does not risk triggering re-initialization.

**No pixel canvas modification:** The rubber-band and in-progress segments are drawn only to `toolOverlayRef`. They are never composited into the WebGPU texture stack. `polygonalSelectionTool.modifiesPixels` is left unset (false), so Canvas.tsx will not attempt to block the tool on locked layers or capture a history entry on pointer-up.

**Rasterization via `selectionStore.setPolygon` only:** The polygon mask must be committed via `selectionStore.setPolygon()` and not via any ad-hoc canvas 2D fill. This keeps flatten/export/merge pipelines unaffected (they read from `selectionStore.mask` for selection-masked operations).

---

## Open Questions

1. **L key cycling:** The spec says "L cycles through lasso-family tools." Currently 'lasso' holds L. Options:
   - Replace L → `'polygonal-selection'` only, leaving the freehand lasso toolbar-only.
   - Implement a simple toggle: each press of L cycles `lasso → polygonal-selection → lasso → …`.
   - The cycle approach matches the Photoshop convention and is cleaner UX, but requires a small state machine or tracking `activeTool` in the shortcut handler. **Recommendation:** implement the cycle for this PR (2–4 lines in the App.tsx shortcut block).

2. **`optModeBtn` CSS classes:** The options bar already has `optLabel`, `optText`, `optCheckLabel`, etc. The mode buttons need `optModeBtn` / `optModeBtnActive`. Decide whether these are general enough to share with future selection tools (marquee, lasso), or whether they are scoped to the polygonal selection options component.

3. **`selectionStore.setPending` during drawing:** The existing marquee and lasso tools call `setPending` so the marching-ants RAF shows a live drag preview. The polygonal selection tool draws its preview on `toolOverlayRef` instead and does **not** call `setPending`. This means `useMarchingAnts` draws nothing during the polygon session — which is correct. However, if a previous selection's marching ants are visible while drawing, they will continue animating, which is intentional (the existing selection is preserved until the polygon commits).

4. **Intersect modifier for existing tools:** The `shiftKey && altKey` → `'intersect'` guard should be added to `select.tsx` and `lasso.tsx` to avoid accidentally subtracting when both modifiers are held. This is a small change with broad UX impact; decide whether it belongs in this PR or a follow-up.

5. **`polygonalSelectionOptions.mode` persistence:** The tool options bar sets the default mode but this value is module-level and therefore lost on page reload. Per-document persistence of tool options is out of scope for this implementation; note for future work.
