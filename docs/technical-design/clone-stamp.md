# Technical Design: Clone Stamp Tool

## Overview

The Clone Stamp tool lets users paint pixels sampled from a locked source point onto a destination layer, acting as a brush that reads colors from one region and writes them to another. It integrates directly with the existing brush-rendering pipeline (`bresenham.ts`), the module-level options/singleton pattern established by the brush and eraser tools, and the overlay infrastructure used by the transform tool. A new module-level store (`cloneStampStore`) holds source-point state that must survive tool switches and handler re-creation. The source marker is rendered onto the existing `toolOverlayRef` Canvas 2D layer, following the same subscribe/redraw pattern as the transform overlay. Undo uses the automatic `onStrokeEnd` capture already wired into Canvas.tsx — no custom history integration is needed.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'clone-stamp'` to the `Tool` union |
| `src/store/cloneStampStore.ts` | **New** — module-level singleton holding source point and aligned offset |
| `src/tools/cloneStamp.tsx` | **New** — options object, handler factory, options UI component |
| `src/tools/algorithm/bresenham.ts` | Export `blendPixelOver`; add new `stampCloneSegment` |
| `src/tools/index.ts` | Import and register `cloneStampTool` in `TOOL_REGISTRY` |
| `src/components/window/Canvas/cloneStampOverlay.ts` | **New** — overlay draw helper for source marker and offset line |
| `src/components/window/Canvas/Canvas.tsx` | Wire cursor, overlay subscribe/redraw, source-deletion guard, cursor style |
| `src/components/window/Canvas/Canvas.module.scss` | Add `.brushCursorCrossHair` modifier for center mark |
| `src/components/window/Toolbar/Toolbar.tsx` | Add icon, `TOOL_GRID` entry, `PIXEL_ONLY_TOOLS` entry |
| `src/hooks/useKeyboardShortcuts.ts` | Add bare-key `S` handler for tool activation |
| `src/App.tsx` | Wire `S` shortcut, register `cloneStampStore.onSourceDeleted`, show notification toast |
| `src/components/dialogs/KeyboardShortcutsDialog/KeyboardShortcutsDialog.tsx` | Add `S: Clone Stamp` to the Tools group |

---

## State Changes

### New: `src/store/cloneStampStore.ts`

No changes to `AppState` are needed. All clone-stamp source state lives in a module-level singleton — the same pattern as `historyStore`, `selectionStore`, `cropStore`, etc.

```ts
// src/store/cloneStampStore.ts

export interface CloneStampSource {
  x: number       // canvas-space
  y: number       // canvas-space
  layerId: string // ID of the locked source layer at time of Alt-click
}

class CloneStampStore {
  source: CloneStampSource | null = null

  /**
   * Persisted offset for Aligned mode: delta from destination to source.
   *   sourceX = destX + alignedOffset.dx
   *   sourceY = destY + alignedOffset.dy
   * Set on the first pointerdown after a source is established.
   * Cleared when a new source is set via Alt-click.
   */
  alignedOffset: { dx: number; dy: number } | null = null

  /**
   * Registered by App.tsx. Called when the source layer is deleted while
   * the clone stamp tool is active, so App can display a notification toast.
   */
  onSourceDeleted: (() => void) | null = null

  private listeners = new Set<() => void>()

  subscribe(fn: () => void): void   { this.listeners.add(fn) }
  unsubscribe(fn: () => void): void { this.listeners.delete(fn) }
  notify(): void                    { for (const fn of this.listeners) fn() }

  setSource(x: number, y: number, layerId: string): void {
    this.source = { x, y, layerId }
    this.alignedOffset = null  // reset so next stroke recomputes the offset
    this.notify()
  }

  clearSource(): void {
    this.source = null
    this.alignedOffset = null
    this.onSourceDeleted?.()
    this.notify()
  }
}

export const cloneStampStore = new CloneStampStore()
```

**Why a singleton instead of `AppState`?**  
The handler runs in synchronous pointer-event callbacks; it cannot read React state safely. Storing source state in `AppState` would cause unnecessary renders on every Alt-click. The pattern matches `selectionStore`, `cropStore`, `transformStore`, and `cursorStore`.

---

## New Components / Hooks / Tools

### `src/tools/cloneStamp.tsx`

**Category**: tool (handler factory + options UI)  
**Single responsibility**: handle clone-stamp pointer events and render the options bar  
**Inputs**: `ToolContext` on every pointer event; reads `cloneStampStore` and `cloneStampOptions`  
**Outputs**: modifies `ctx.layer` pixel data via `stampCloneSegment`; dispatches overlay redraws via `cloneStampStore.notify()`

#### Options object (module-level)

```ts
export const cloneStampOptions = {
  size:            20,    // brush diameter in px
  hardness:        100,   // 0-100; 100 = hard circle, 0 = fully feathered
  opacity:         100,   // 1-100
  aligned:         true,  // true = maintain offset across strokes
  sampleAllLayers: false, // true = sample from flattened composite
}
```

#### Handler factory

```ts
function createCloneStampHandler(): ToolHandler
```

**Closure state**:

| Variable | Type | Purpose |
|---|---|---|
| `lastPos` | `{ x, y } \| null` | Previous pointer position for segment drawing |
| `touched` | `Map<number, number> \| null` | Per-stroke coverage map; prevents opacity accumulation |
| `sourceBuffer` | `Uint8Array \| null` | Snapshot of source pixels taken at stroke start |
| `sourceBounds` | `{ offsetX, offsetY, layerWidth, layerHeight } \| null` | Layer geometry when `sampleAllLayers=false`; `null` when canvas-sized |
| `strokeOffsetDX` | `number` | Locked source-to-dest offset for the current stroke (X) |
| `strokeOffsetDY` | `number` | Locked source-to-dest offset for the current stroke (Y) |
| `isStrokeReady` | `boolean` | False while awaiting async `readFlattenedPixels`; gating `onPointerMove` |

##### `onPointerDown(pos, ctx)`

```
if pos.altKey:
  1. Determine source layer: iterate ctx.layers in reverse (topmost first);
     find the first visible layer whose pixel buffer has non-zero alpha at (pos.x, pos.y).
     Fall back to ctx.layer (active layer) if no hit.
  2. cloneStampStore.setSource(pos.x, pos.y, hitLayerId)
  3. Redraw overlay via cloneStampStore.notify()
  4. return  // do not paint

if cloneStampStore.source is null: return  // no-op

source = cloneStampStore.source

if cloneStampOptions.aligned:
  if cloneStampStore.alignedOffset is null:
    cloneStampStore.alignedOffset = { dx: source.x - pos.x, dy: source.y - pos.y }
  strokeOffsetDX = cloneStampStore.alignedOffset.dx
  strokeOffsetDY = cloneStampStore.alignedOffset.dy
else:
  // Non-aligned: always start from the original alt-clicked point
  strokeOffsetDX = source.x - pos.x
  strokeOffsetDY = source.y - pos.y

touched = new Map()
lastPos = { x: pos.x, y: pos.y }
isStrokeReady = false
sourceBuffer = null

if cloneStampOptions.sampleAllLayers:
  isStrokeReady = false
  ctx.renderer.readFlattenedPixels(ctx.layers).then(buf => {
    sourceBuffer = buf
    sourceBounds = null  // canvas-sized
    isStrokeReady = true
    // Paint the initial dab at the original down position
    paintSegment(pos.x, pos.y, pos.x, pos.y, ctx)
  })
else:
  const sourceLayer = ctx.layers.find(l => l.id === source.layerId)
  if !sourceLayer: return
  sourceBuffer = ctx.renderer.readLayerPixels(sourceLayer)  // synchronous snapshot
  sourceBounds = { offsetX: sourceLayer.offsetX, offsetY: sourceLayer.offsetY,
                   layerWidth: sourceLayer.layerWidth, layerHeight: sourceLayer.layerHeight }
  isStrokeReady = true
  paintSegment(pos.x, pos.y, pos.x, pos.y, ctx)  // initial dab
```

**Gotcha — `readLayerPixels` returns a frozen copy**: `renderer.readLayerPixels(layer)` returns `layer.data.slice()`. The snapshot is taken once per stroke. Pixels painted onto the source layer within the same stroke will not be re-sampled (no feedback loop), matching Photoshop's behavior.

**Gotcha — async `sampleAllLayers` and fast first stroke**: If the user moves the mouse before `readFlattenedPixels` resolves (typically < 30 ms), those `onPointerMove` events are silently skipped (`isStrokeReady === false`). For the common case this is imperceptible. A queued-position approach can be added later if jank is observed on very large canvases.

##### `onPointerMove(pos, ctx)`

```
if !isStrokeReady || !lastPos || !sourceBuffer: return
paintSegment(lastPos.x, lastPos.y, pos.x, pos.y, ctx)
lastPos = { x: pos.x, y: pos.y }
// In aligned mode, update the store's moving source position for the overlay:
if cloneStampOptions.aligned && cloneStampStore.alignedOffset:
  cloneStampStore.notify()  // overlay subscriber redraws at new brush position
```

##### `onPointerUp(pos, ctx)`

```
if isStrokeReady && lastPos && sourceBuffer:
  // Flush any remaining tail
  paintSegment(lastPos.x, lastPos.y, pos.x, pos.y, ctx)

lastPos = null
touched = null
sourceBuffer = null
sourceBounds = null
isStrokeReady = false
// History is captured automatically by Canvas.tsx (modifiesPixels=true, no skipAutoHistory)
```

##### `onHover(pos, ctx)`

```
// Drive brush cursor circle + crosshair (same as brush/eraser, handled in Canvas.tsx)
// Notify overlay to redraw with updated brush position for the dashed offset line
if cloneStampStore.source !== null:
  cloneStampStore.notify()
```

##### `onLeave(ctx)`

```
// Canvas.tsx handles clearing toolOverlayRef when activeTool changes;
// nothing extra needed here beyond calling cloneStampStore.notify() to
// signal the overlay subscriber (which will be unsubscribed on tool change).
```

##### `paintSegment(x0, y0, x1, y1, ctx)` (internal helper)

```ts
function paintSegment(
  x0: number, y0: number,
  x1: number, y1: number,
  ctx: ToolContext,
): void {
  const { renderer, layer, layers, selectionMask, render, growLayerToFit } = ctx
  const pad = Math.ceil(cloneStampOptions.size / 2) + 2
  growLayerToFit(x0, y0, pad)
  growLayerToFit(x1, y1, pad)

  const sel = selectionMask
    ? { mask: selectionMask, width: renderer.pixelWidth }
    : undefined

  stampCloneSegment(
    renderer, layer,
    x0, y0, x1, y1,
    cloneStampOptions.size,
    cloneStampOptions.hardness,
    strokeOffsetDX, strokeOffsetDY,
    sourceBuffer!,
    sourceBounds === null,   // sourceIsCanvas
    sourceBounds,
    renderer.pixelWidth, renderer.pixelHeight,
    cloneStampOptions.opacity,
    touched ?? undefined,
    sel,
  )

  // Update dirtyRect for efficient texture upload
  expandDirtyRect(layer, x0, y0, x1, y1, pad)

  renderer.flushLayer(layer)
  render(layers)
}
```

#### `ToolDefinition` export

```ts
export const cloneStampTool: ToolDefinition = {
  createHandler: createCloneStampHandler,
  Options: CloneStampOptions,
  modifiesPixels: true,
  paintsOntoPixelLayer: true,
}
```

`paintsOntoPixelLayer: true` ensures Canvas auto-creates a pixel layer when the active layer is a text or shape layer, consistent with brush/pencil behavior.

---

### `src/tools/algorithm/bresenham.ts`

Two changes:

**1. Export `blendPixelOver`**

Change `function blendPixelOver(...)` to `export function blendPixelOver(...)`. No other changes to the existing function. This is the only exported change to the existing file.

**2. Add `stampCloneSegment`**

```ts
/**
 * Paints a clone-stamp capsule segment from (x0,y0) to (x1,y1).
 * For each pixel in the capsule area, the source color is sampled from
 * `sourceBuffer` at (canvasX + offsetDX, canvasY + offsetDY).
 *
 * @param offsetDX   source = dest + offset (X); pre-computed at stroke start
 * @param offsetDY   source = dest + offset (Y)
 * @param sourceIsCanvas  when true, sourceBuffer is canvas-sized (canvasW × canvasH × 4);
 *                        when false, sourceBounds must be provided and the buffer is layer-local.
 * @param sourceBounds   geometry of the source layer; ignored when sourceIsCanvas=true
 * @param hardness   0-100; 100 = hard circular edge, lower = SDF feather
 */
export function stampCloneSegment(
  renderer: WebGPURenderer,
  destLayer: GpuLayer,
  x0: number, y0: number,
  x1: number, y1: number,
  size: number,
  hardness: number,
  offsetDX: number, offsetDY: number,
  sourceBuffer: Uint8Array,
  sourceIsCanvas: boolean,
  sourceBounds: { offsetX: number; offsetY: number; layerWidth: number; layerHeight: number } | null,
  canvasW: number, canvasH: number,
  opacity: number,
  touched?: Map<number, number>,
  sel?: SelMask,
): void {
  const radius = size / 2
  const pad = Math.ceil(radius) + 1
  const sdx = x1 - x0, sdy = y1 - y0
  const lenSq = sdx * sdx + sdy * sdy

  // Feather ramp: at hardness=100 the hard-edge circle path is used;
  // below 100, the falloff band is `featherBand` pixels wide.
  const featherBand = Math.max(0.5, radius * (1 - hardness / 100))
  const innerRadius = Math.max(0, radius - featherBand)

  const minX = Math.floor(Math.min(x0, x1)) - pad
  const maxX = Math.ceil(Math.max(x0, x1)) + pad
  const minY = Math.floor(Math.min(y0, y1)) - pad
  const maxY = Math.ceil(Math.max(y0, y1)) + pad

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      // Distance from pixel center to the capsule spine
      let dist: number
      if (lenSq === 0) {
        dist = Math.sqrt((px - x0) ** 2 + (py - y0) ** 2)
      } else {
        const t = Math.max(0, Math.min(1, ((px - x0) * sdx + (py - y0) * sdy) / lenSq))
        const nearX = x0 + t * sdx, nearY = y0 + t * sdy
        dist = Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2)
      }
      if (dist > radius) continue

      const coverage = dist <= innerRadius
        ? 1
        : Math.max(0, (radius - dist) / featherBand)
      if (coverage <= 0) continue

      // Sample source pixel
      const srcX = px + offsetDX
      const srcY = py + offsetDY

      let sr = 0, sg = 0, sb = 0, sa = 0
      if (sourceIsCanvas) {
        if (srcX >= 0 && srcY >= 0 && srcX < canvasW && srcY < canvasH) {
          const i = (Math.round(srcY) * canvasW + Math.round(srcX)) * 4
          sr = sourceBuffer[i]; sg = sourceBuffer[i+1]
          sb = sourceBuffer[i+2]; sa = sourceBuffer[i+3]
        }
        // else: out-of-bounds → transparent (sr/sg/sb/sa remain 0)
      } else if (sourceBounds) {
        const lx = Math.round(srcX) - sourceBounds.offsetX
        const ly = Math.round(srcY) - sourceBounds.offsetY
        if (lx >= 0 && ly >= 0 && lx < sourceBounds.layerWidth && ly < sourceBounds.layerHeight) {
          const i = (ly * sourceBounds.layerWidth + lx) * 4
          sr = sourceBuffer[i]; sg = sourceBuffer[i+1]
          sb = sourceBuffer[i+2]; sa = sourceBuffer[i+3]
        }
      }
      if (sa === 0) continue  // fully transparent source pixel — skip

      blendPixelOver(
        renderer, destLayer, px, py,
        sr, sg, sb, sa,
        opacity * coverage,
        touched, sel,
      )
    }
  }
}
```

**Gotcha — integer source coordinates**: Source coordinates are `px + offsetDX / offsetDY`. These are canvas-space floats. Round to nearest integer before indexing into the source buffer. Bilinear interpolation is not required for the initial implementation.

---

### `src/components/window/Canvas/cloneStampOverlay.ts`

**Category**: utility (overlay draw helper)  
**Single responsibility**: draw the source marker and dashed offset line onto a Canvas 2D context

```ts
/**
 * Draws the clone stamp source marker and (optionally) a dashed line from the
 * source position to the current brush position.
 *
 * Call from:
 *  - the cloneStampStore subscriber in Canvas.tsx (on source change)
 *  - the onHover callback in Canvas.tsx (on every pointer move)
 *
 * @param oc            The tool overlay canvas (toolOverlayRef)
 * @param sourceX/Y     Canvas-space source point position
 * @param brushX/Y      Canvas-space current brush position (pointer pos)
 * @param zoom          Current canvas zoom level
 * @param dpr           window.devicePixelRatio
 * @param showLine      Draw the dashed offset line (only when actively stroking)
 */
export function drawCloneStampOverlay(
  oc: HTMLCanvasElement,
  sourceX: number, sourceY: number,
  brushX: number, brushY: number,
  zoom: number,
  dpr: number,
  showLine: boolean,
): void
```

**Coordinate transform**: Source/brush positions are in canvas-space (integer pixel coordinates). The overlay canvas is the same pixel dimensions as the WebGPU canvas, but rendered at `zoom/dpr` CSS scaling. The overlay canvas's 2D context uses canvas-space coordinates directly (same as the WebGPU canvas dimensions), so no additional transform is needed.

**Source marker appearance** (matches UX design):
- 24×24 px bounding box centered on `(sourceX, sourceY)` in canvas-space
- Inner circle: `r=8`, white stroke 1.5 px with `0 0 0 1px rgba(0,0,0,0.5)` shadow
- Crosshair arms: full-width/height 1.5 px white lines with `0 0 0 0.5px` dark shadow; arms interrupted by an 8 px gap around the center (so the inner circle is visible)

**Dashed offset line** (shown when `showLine=true`):
- Drawn from `(sourceX, sourceY)` to `(brushX, brushY)` in canvas-space
- Style: white 1 px, `dash=[4, 3]`, with `0 0 0 1px` dark shadow
- Only drawn when there is a visible source and the brush position differs from the source

**Clear on hide**: call `ctx.clearRect(0, 0, oc.width, oc.height)` before drawing. Called with an empty/no-source state to clear.

---

### `CloneStampOptions` component (inside `src/tools/cloneStamp.tsx`)

**Category**: options bar component (rendered by `ToolOptionsBar`)  
**Single responsibility**: mirror `cloneStampOptions` fields as controlled inputs; display source status

```tsx
function CloneStampOptions({ styles }: { styles: ToolOptionsStyles }): React.JSX.Element {
  const [size,            setSize]            = useState(cloneStampOptions.size)
  const [hardness,        setHardness]        = useState(cloneStampOptions.hardness)
  const [opacity,         setOpacity]         = useState(cloneStampOptions.opacity)
  const [aligned,         setAligned]         = useState(cloneStampOptions.aligned)
  const [sampleAllLayers, setSampleAllLayers] = useState(cloneStampOptions.sampleAllLayers)
  const [source,          setSource]          = useState(cloneStampStore.source)

  // Subscribe to store so the source status pill updates reactively
  useEffect(() => {
    const update = (): void => setSource(cloneStampStore.source)
    cloneStampStore.subscribe(update)
    return () => cloneStampStore.unsubscribe(update)
  }, [])

  // ... onChange handlers: update module-level options then local state ...

  return (
    <>
      {/* Size | sep | Hardness | sep | Opacity | sep | Aligned | sep | Sample All Layers | sep | Source status pill */}
    </>
  )
}
```

**Source status pill**: renders either `"Alt-click to set source"` (muted, no background) or `"Source set"` (accent-colored pill with dot) depending on whether `source` is non-null. Matches the `.source-status` styles from the UX design.

---

## Implementation Steps

### Step 1 — Add `'clone-stamp'` to the `Tool` type

**File**: `src/types/index.ts`

Add `| 'clone-stamp'` to the `Tool` union. Position it after `'eraser'` (retouching tools group).

### Step 2 — Create `cloneStampStore`

**File**: `src/store/cloneStampStore.ts` (new)

Implement the store exactly as shown in the **State Changes** section above.

### Step 3 — Export `blendPixelOver` from `bresenham.ts`

**File**: `src/tools/algorithm/bresenham.ts`

Change the declaration from:
```ts
function blendPixelOver(...)
```
to:
```ts
export function blendPixelOver(...)
```

No other changes to the function.

### Step 4 — Add `stampCloneSegment` to `bresenham.ts`

**File**: `src/tools/algorithm/bresenham.ts`

Append `stampCloneSegment` as shown in the **New Components** section above.

### Step 5 — Create `cloneStamp.tsx`

**File**: `src/tools/cloneStamp.tsx` (new)

Implement in order:
1. `cloneStampOptions` export
2. `createCloneStampHandler()` factory
3. `CloneStampOptions` React component
4. `cloneStampTool` export

### Step 6 — Register the tool

**File**: `src/tools/index.ts`

1. Add import: `import { cloneStampTool } from './cloneStamp'`
2. Add to `TOOL_REGISTRY`: `'clone-stamp': cloneStampTool`

### Step 7 — Create `cloneStampOverlay.ts`

**File**: `src/components/window/Canvas/cloneStampOverlay.ts` (new)

Implement `drawCloneStampOverlay` as described above.

### Step 8 — Wire into Canvas.tsx

**File**: `src/components/window/Canvas/Canvas.tsx`

**8a. Cursor style on the `<canvas>` element**

Extend the inline `cursor` style from:
```ts
cursor: (state.activeTool === 'brush' || state.activeTool === 'eraser') ? 'none' : undefined,
```
to:
```ts
cursor: (state.activeTool === 'brush' || state.activeTool === 'eraser' || state.activeTool === 'clone-stamp')
  ? 'none'
  : undefined,
```

When no source is set on the clone stamp, the brush circle is hidden and the cursor style should fall back to `'crosshair'` instead. Logic:
```ts
const hideCursor =
  state.activeTool === 'brush' ||
  state.activeTool === 'eraser' ||
  (state.activeTool === 'clone-stamp' && cloneStampStore.source !== null)
```

**8b. Brush cursor update in `onHover`**

Extend the block that updates `brushCursorRef` to include `clone-stamp`:
```ts
if ((tool === 'brush' || tool === 'eraser' || tool === 'clone-stamp') && brushCursorRef.current) {
  const size =
    tool === 'brush' ? brushOptions.size :
    tool === 'eraser' ? eraserOptions.size :
    cloneStampOptions.size
  const r = Math.max(1, size / 2 * zoom / dpr)
  const cx = (pos.x + 0.5) * zoom / dpr
  const cy = (pos.y + 0.5) * zoom / dpr
  const el = brushCursorRef.current
  el.style.left   = `${cx - r}px`
  el.style.top    = `${cy - r}px`
  el.style.width  = `${r * 2}px`
  el.style.height = `${r * 2}px`
  // Show circle cursor only when source is set; crosshair-only otherwise
  if (tool === 'clone-stamp') {
    el.style.display = cloneStampStore.source ? 'block' : 'none'
    el.className = `${styles.brushCursor} ${styles.brushCursorCrossHair}`
  } else {
    el.style.display = 'block'
    el.className = styles.brushCursor
  }
}
```

**8c. Tool overlay: subscribe/unsubscribe for clone stamp**

Add a `useEffect` alongside the existing transform overlay effect:
```ts
useEffect(() => {
  if (!isActive || state.activeTool !== 'clone-stamp') return

  const redraw = (): void => {
    const oc = toolOverlayRef.current
    if (!oc || !cloneStampStore.source) {
      toolOverlayRef.current
        ?.getContext('2d')
        ?.clearRect(0, 0, oc?.width ?? 0, oc?.height ?? 0)
      return
    }
    drawCloneStampOverlay(
      oc,
      cloneStampStore.source.x,
      cloneStampStore.source.y,
      cursorStore.x, cursorStore.y,
      zoomRef.current, window.devicePixelRatio,
      false,  // showLine only during active stroke — see note
    )
  }

  redraw()
  cloneStampStore.subscribe(redraw)
  return () => {
    cloneStampStore.unsubscribe(redraw)
    const oc = toolOverlayRef.current
    oc?.getContext('2d')?.clearRect(0, 0, oc.width, oc.height)
  }
}, [isActive, state.activeTool])
```

**8d. Source-layer deletion guard**

In the existing `useEffect([state.layers, isActive, editingLayerId])`, after the stale GL-layer cleanup loop, add:
```ts
// Clone stamp: clear source if its locked layer was deleted
if (state.activeTool === 'clone-stamp' && cloneStampStore.source) {
  if (!stateIds.has(cloneStampStore.source.layerId)) {
    cloneStampStore.clearSource()
    // onSourceDeleted callback notifies App.tsx (toast)
  }
}
```

**8e. Import additions**

Add to Canvas.tsx imports:
```ts
import { cloneStampOptions } from '@/tools/cloneStamp'
import { cloneStampStore } from '@/store/cloneStampStore'
import { drawCloneStampOverlay } from './cloneStampOverlay'
```

**Gotcha — `cursorStore` in overlay redraw**: The overlay subscriber needs the current brush position (`cursorStore.x/y`) which may be stale when the store notifies after an Alt-click. The `drawCloneStampOverlay` should be able to handle `brushX === undefined`; in that case, don't draw the dashed line.

### Step 9 — Add CSS for brush cursor center crosshair

**File**: `src/components/window/Canvas/Canvas.module.scss`

```scss
.brushCursorCrossHair {
  // Inherits the circle styles from .brushCursor
  // Adds a center crosshair via pseudo-elements
  overflow: visible;  // allow ::before/::after to extend beyond the div

  &::before,
  &::after {
    content: '';
    position: absolute;
    background: rgba(255, 255, 255, 0.85);
    box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.7);
    pointer-events: none;
  }

  // Horizontal bar
  &::before {
    top: 50%;
    left: 50%;
    width: 8px;
    height: 1px;
    transform: translate(-50%, -50%);
  }

  // Vertical bar
  &::after {
    top: 50%;
    left: 50%;
    width: 1px;
    height: 8px;
    transform: translate(-50%, -50%);
  }
}
```

### Step 10 — Add tool to Toolbar

**File**: `src/components/window/Toolbar/Toolbar.tsx`

**10a. Add icon** (inside the `Icon` object):
```tsx
cloneStamp: (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    {/* Stamp body */}
    <rect x="5" y="7" width="6" height="5" rx="0.5" />
    <line x1="8" y1="2" x2="8" y2="7" />
    {/* Crosshair on handle tip */}
    <line x1="5.5" y1="2" x2="10.5" y2="2" />
    <line x1="8" y1="0.5" x2="8" y2="3.5" />
  </svg>
),
```

**10b. Add to `TOOL_GRID`** — insert into the painting group (after the eraser row):
```ts
[
  { id: 'clone-stamp', label: 'Clone Stamp', shortcut: 'S', icon: Icon.cloneStamp },
  null
],
```

**10c. Add to `PIXEL_ONLY_TOOLS`**:
```ts
const PIXEL_ONLY_TOOLS = new Set<Tool>([
  'brush', 'pencil', 'eraser', 'fill', 'gradient', 'dodge', 'burn', 'clone-stamp'
])
```

### Step 11 — Keyboard shortcut (`S` key)

**File**: `src/hooks/useKeyboardShortcuts.ts`

Add `handleCloneStamp?: () => void` to the options interface and the destructured parameters. In the `onKey` handler, add a bare-key check **before** the `if (!e.ctrlKey && !e.metaKey) return` guard:

```ts
// Tool shortcuts (bare keys, no modifier)
if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
  if (e.key === 's' || e.key === 'S') { e.preventDefault(); handleCloneStamp?.(); return }
  // (Other future tool shortcuts follow the same pattern here)
  return
}
```

**File**: `src/App.tsx`

Pass the new option to `useKeyboardShortcuts`:
```ts
handleCloneStamp: useCallback(() => handleToolChange('clone-stamp'), [handleToolChange]),
```

**Gotcha — `Ctrl+S` collision**: `Ctrl+S` is handled in the `ctrlKey` branch which runs after the bare-key block. The guard `!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey` ensures that `Ctrl+S` (Save) is never intercepted by the clone-stamp shortcut.

### Step 12 — Update Keyboard Shortcuts dialog

**File**: `src/components/dialogs/KeyboardShortcutsDialog/KeyboardShortcutsDialog.tsx`

Add `{ keys: 'S', action: 'Clone Stamp' }` to the `Tools` group rows, after the `'E': Eraser` entry.

### Step 13 — Notification toast (source layer deleted)

**File**: `src/App.tsx`

1. Add local state: `const [cloneStampNotification, setCloneStampNotification] = useState<string | null>(null)`
2. Register callback after the component mounts (in a `useEffect`):
   ```ts
   useEffect(() => {
     cloneStampStore.onSourceDeleted = () => {
       setCloneStampNotification('Clone stamp source layer was deleted. Alt-click to set a new source.')
       setTimeout(() => setCloneStampNotification(null), 4000)
     }
     return () => { cloneStampStore.onSourceDeleted = null }
   }, [])
   ```
3. Render the toast near the canvas area (absolutely positioned, bottom-center of the canvas viewport). Use a simple `<div>` styled inline or with a new `.cloneStampToast` rule. No new component is needed for a single dismissing string.

---

## Architectural Constraints

**Module-level options object** (`cloneStampOptions`): The handler factory must read from this module-level object on every pointer event, exactly like `brushOptions` and `eraserOptions`. Never read options from React state inside a handler. The options are also exported so Canvas.tsx can read `cloneStampOptions.size` to size the brush cursor without coupling to React state.

**Handler is stateless across tool switches**: `createCloneStampHandler()` is called fresh every time `state.activeTool` changes (Canvas.tsx effect). All source-point state that must persist across switches lives in `cloneStampStore`, not in the handler closure.

**No raw DOM listeners**: All pointer events flow through `useCanvas` → Canvas.tsx `handlePointerDown/Move/Up` → `toolHandlerRef.current.onPointerDown/Move/Up(pos, ctx)`. The clone stamp handler must not attach its own `document.addEventListener` calls.

**Canvas overlay pattern**: The source marker overlay follows the exact same subscribe/redraw/unsubscribe pattern as the transform overlay (`drawTransformOverlay`). Subscribe in a `useEffect([isActive, state.activeTool])`, draw in the subscriber, clear on cleanup.

**Undo**: Do not call `ctx.commitStroke` manually. The automatic `onStrokeEnd('Clone-stamp')` triggered by Canvas.tsx on `pointerUp` (because `modifiesPixels: true` and no `skipAutoHistory`) is correct for both the synchronous single-layer path and the async `sampleAllLayers` path. By the time `pointerUp` fires, all painting is complete.

**`sampleAllLayers` and async**: The `readFlattenedPixels` call is async. The handler stores the resolved buffer in a closure variable and gates `onPointerMove` painting behind `isStrokeReady`. This is the same async-then-sync pattern used by `createFillHandler`. No `skipAutoHistory` is needed because the history capture at `pointerUp` happens long after the buffer resolves.

**`blendPixelOver` export**: This is the only change to `bresenham.ts`'s existing API. The function's signature and behavior are unchanged; only the export visibility changes. All existing callers are in the same file (they currently call it without import) so this is a non-breaking change.

**CSS modules**: `Canvas.module.scss` additions must use `.module.scss` (already the case). `cloneStamp.tsx` does not need its own stylesheet unless the options bar requires special layout — use the `styles.*` props from `ToolOptionsStyles` as all other tools do.

---

## Open Questions

1. **Alt-click source layer detection**: The spec says the source is "locked to the layer that was under the cursor at the time of the Alt-click." Should we implement a hit-test (iterate `ctx.layers` in reverse to find the topmost visible layer with non-transparent pixel at the alt-click position), or default to the currently active layer (`ctx.layer`)? The hit-test is more correct but requires a small CPU scan. For v1, defaulting to the active layer matches the behavior of many retouching tools and avoids confusion; the hit-test can be added later.

2. **`sampleAllLayers=true` and dropped first-stroke pixels**: If `readFlattenedPixels` takes > 30 ms (very large canvas) the first few `onPointerMove` events fire before `isStrokeReady=true` and are silently skipped. Should those positions be queued (up to N samples) and replayed once the buffer resolves? Recommend: queue up to 32 positions; replay them on resolution. Leave for a follow-up if latency is not observed in practice on typical canvas sizes.

3. **Bare-key tool shortcuts**: The `S` shortcut requires adding a bare-key handling block to `useKeyboardShortcuts.ts`. This same block could implement the other listed tool shortcuts (B, E, V, etc.) that are currently display-only in tooltips. Should all tool shortcuts be wired at once, or just `S`? Recommend: wire all at once since the pattern is identical and the risk of conflict is low (they are all single unmodified letters, no existing handler fires before the new guard).

4. **Dashed offset line**: The UX design shows a dashed line from the source marker to the brush cursor during a stroke (indicating the clone offset). The spec does not explicitly require it. Should it be included in v1? It requires tracking whether a stroke is active in Canvas.tsx to pass `showLine=true`. Recommend: include it; the overlay infrastructure is already in place and it meaningfully helps users understand the current alignment.

5. **Notification toast rendering**: The deletion notification is driven by `cloneStampStore.onSourceDeleted`. Rendering it as local state in `App.tsx` is the simplest approach (no new store, no new component). If a general notification system is planned for other tools or operations, this could be promoted to a shared `notificationStore`. Recommend: App.tsx local state for now.

6. **Non-aligned mode and rapid re-clicks**: In non-aligned mode, each `pointerDown` recomputes the offset from the original `source.x/y`. If the user holds Alt and re-clicks mid-stroke (intent: reset source), the store's source is overwritten. No special protection is needed — the handler ignores `pointerDown` with `altKey` beyond setting the source point.
