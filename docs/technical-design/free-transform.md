# Technical Design: Free Transform

## Overview

Free Transform is a modal editing operation that lets users scale, rotate, shear, and apply perspective to the pixels of the active raster layer (or a floating selection lifted from it). It is entered from **Edit → Free Transform** (Cmd+T), replaces the tool options bar with a dedicated toolbar for the duration of the session, and commits destructively to the layer on Apply. The feature is designed as a **pseudo-tool** (`'transform'`) in the tool registry so that the existing `ToolOptionsBar` rendering, tool handler, and canvas overlay machinery all apply without modification. A module-level `transformStore` (following the existing `cropStore` pattern) carries the floating pixel buffer and live transform parameters without polluting `AppContext`.

---

## Affected Areas

| File | Status | Change |
|---|---|---|
| `src/types/index.ts` | Modify | Add `'transform'` to `Tool` union; add `TransformState`, `TransformInterpolation`, `TransformHandleMode` types |
| `src/store/transformStore.ts` | **Create** | Module-level singleton carrying floating buffer, live params, and Apply/Cancel callbacks |
| `src/tools/transform.tsx` | **Create** | Transform tool handler factory + thin `TransformOptions` wrapper component |
| `src/tools/index.ts` | Modify | Register `transformTool` in `TOOL_REGISTRY` |
| `src/hooks/useTransform.ts` | **Create** | Hook: enter mode, apply, cancel, history integration |
| `src/hooks/useKeyboardShortcuts.ts` | Modify | Add Cmd+T shortcut; add Enter/Escape dispatch when transform is active |
| `src/components/window/TransformToolbar/TransformToolbar.tsx` | **Create** | Window component: the full transform options bar |
| `src/components/window/TransformToolbar/TransformToolbar.module.scss` | **Create** | Styles matching the UX design |
| `src/components/index.ts` | Modify | Export `TransformToolbar` |
| `src/components/window/Canvas/Canvas.tsx` | Modify | Add `transformStore` subscription to drive initial and continuous overlay redraws |
| `src/App.tsx` | Modify | Compose `useTransform`; thread `onFreeTransform` and `isFreeTransformEnabled` into `TopBar` |
| `src/components/window/TopBar/TopBar.tsx` | Modify | Add `onFreeTransform` and `isFreeTransformEnabled` props; insert menu item in Edit menu |
| `wasm/src/transform.h` + `wasm/src/transform.cpp` | **Create** | C++17 affine and perspective transform implementations with NN/bilinear/bicubic interpolation |
| `wasm/src/pixelops.cpp` | Modify | Add `EMSCRIPTEN_KEEPALIVE` wrappers for `_pixelops_affine_transform` and `_pixelops_perspective_transform` |
| `wasm/CMakeLists.txt` | Modify | Append new symbols to `-sEXPORTED_FUNCTIONS` |
| `src/wasm/types.ts` | Modify | Add `_pixelops_affine_transform` and `_pixelops_perspective_transform` signatures to `PixelOpsModule` |
| `src/wasm/index.ts` | Modify | Add `applyAffineTransform` and `applyPerspectiveTransform` wrappers |

---

## State Changes

### New types in `src/types/index.ts`

```typescript
// ─── Free Transform ───────────────────────────────────────────────────────────

export type TransformInterpolation = 'nearest' | 'bilinear' | 'bicubic'
export type TransformHandleMode   = 'scale' | 'perspective' | 'shear'

/**
 * Decomposed transform parameters stored in transformStore.
 * x/y = canvas-space position of the un-rotated bounding box top-left corner.
 * pivotX/pivotY = canvas-space rotation/scale pivot (default = centre of box).
 */
export interface TransformParams {
  x: number
  y: number
  w: number
  h: number
  rotation: number     // degrees, clockwise positive
  pivotX: number
  pivotY: number
  shearX: number       // degrees; only used in Shear mode
  shearY: number
  /** Four corners [TL, TR, BR, BL] in canvas-space; non-null only in Perspective mode. */
  perspectiveCorners: [Point, Point, Point, Point] | null
}
```

### No new `AppState` field

The transform's live state lives entirely in `transformStore`. The only footprint in `AppContext` is that `activeTool` becomes `'transform'` while the mode is active, which is already how `ToolOptionsBar` decides what options component to render. Restoring the previous tool when exiting cleanly pops the mode with no residual state in `AppContext`.

The `'transform'` value is added to the `Tool` union:

```typescript
export type Tool =
  | 'move' | 'select' | 'lasso' | 'magic-wand' | 'crop' | 'frame'
  | 'eyedropper' | 'pencil' | 'brush' | 'eraser' | 'fill' | 'gradient'
  | 'dodge' | 'burn' | 'text' | 'shape' | 'hand' | 'zoom'
  | 'transform'   // ← new
```

No new `AppAction` types are required.

---

## New Components / Hooks / Tools

### `src/store/transformStore.ts` — Module-level singleton

**Category:** Store (following the `cropStore` / `selectionStore` pattern)  
**Responsibility:** Carries all mutable transform state that is too large or too volatile for `AppContext`. Provides pub/sub so `Canvas.tsx` and `TransformToolbar` can react to changes without React re-renders on every pointer move.

**Shape:**

```typescript
class TransformStore {
  // ── Activation metadata ──────────────────────────────────────────
  isActive:          boolean = false
  layerId:           string  = ''
  previousTool:      Tool    = 'pencil'
  isSelectionMode:   boolean = false

  // ── Original content dimensions ──────────────────────────────────
  originalW:    number = 0
  originalH:    number = 0
  /** Canvas-space bounding rect of the content at the moment transform was entered. */
  originalRect: { x: number; y: number; w: number; h: number } = { x:0, y:0, w:0, h:0 }

  // ── Floating buffer ───────────────────────────────────────────────
  /**
   * RGBA pixels of the content being transformed.
   * Size = originalW × originalH × 4.
   * Populated once on enter; never mutated during drag.
   */
  floatBuffer: Uint8Array | null = null
  /**
   * OffscreenCanvas backed by floatBuffer — used by the overlay draw path
   * for fast 2D canvas transform-based preview rendering.
   */
  floatCanvas:  OffscreenCanvas | null = null

  /**
   * Snapshot of the full layer pixels at enter time (canvas-size RGBA).
   * Stored only in whole-layer mode so Cancel can cheaply restore.
   * In selection mode the layer is modified on enter (selected area cleared),
   * so savedLayerPixels + savedSelectionMask are used for Cancel.
   */
  savedLayerPixels:   Uint8Array | null = null
  savedSelectionMask: Uint8Array | null = null

  // ── Live transform parameters ─────────────────────────────────────
  params:       TransformParams = { ... }
  aspectLocked: boolean         = false
  handleMode:   TransformHandleMode = 'scale'
  interpolation: TransformInterpolation = 'bilinear'

  // ── Apply / Cancel callbacks (set by useTransform) ────────────────
  onApply:  (() => void) | null = null
  onCancel: (() => void) | null = null

  // ── Pub/Sub ───────────────────────────────────────────────────────
  subscribe(fn: Listener): void   { ... }
  unsubscribe(fn: Listener): void { ... }

  // ── Lifecycle ─────────────────────────────────────────────────────
  enter(data: TransformEnterData): void   { ... ; this.notify() }
  updateParams(partial: Partial<TransformParams>): void { ... ; this.notify() }
  clear(): void                            { ... ; this.notify() }
  triggerApply():  void { this.onApply?.() }
  triggerCancel(): void { this.onCancel?.() }
}

export const transformStore = new TransformStore()
```

---

### `src/hooks/useTransform.ts` — Business logic hook

**Category:** Hook  
**Single responsibility:** Enter / apply / cancel transform mode. Owns all pixel I/O (reading from `CanvasHandle`, writing back via WASM, committing history).

**Inputs:**
```typescript
interface UseTransformOptions {
  canvasHandleRef: { readonly current: CanvasHandle | null }
  stateRef:        MutableRefObject<AppState>
  dispatch:        Dispatch<AppAction>
  captureHistory:  (label: string) => void
}
```

**Outputs:**
```typescript
interface UseTransformReturn {
  handleEnterTransform: () => void
  isFreeTransformEnabled: boolean   // memoised: active layer is a raster layer and no transform is in progress
}
```

**Key behaviours:**

1. **`handleEnterTransform()`**
   - Guard: must have an active raster layer (`PixelLayerState`), no transform already active.
   - Zero-size selection guard: if `selectionStore.mask` is non-null and the selection has zero area, degrade to whole-layer mode.
   - Read `floatBuffer`:
     - **Whole-layer mode:** `canvasHandle.getLayerPixels(layerId)` → canvas-size RGBA. Save a copy as `savedLayerPixels`. Compute the tight non-transparent bounding rect (scan all pixels; fall back to full canvas if all transparent). Crop to that rect to form `floatBuffer` of size `(origW × origH × 4)`.
     - **Selection mode:** copy pixels within `selectionStore.mask` bounds into a tight `floatBuffer`. Save a copy of the full layer pixels as `savedLayerPixels` and the mask as `savedSelectionMask`. Call `canvasHandle.clearLayerPixels(layerId, selectionStore.mask)` to erase the lifted area.
   - Build `OffscreenCanvas(origW, origH)`, draw `floatBuffer` as `ImageData` into it → `transformStore.floatCanvas`.
   - Initialise `transformStore.params` with `x = rect.x`, `y = rect.y`, `w = rect.w`, `h = rect.h`, `rotation = 0`, `pivotX = rect.x + rect.w/2`, `pivotY = rect.y + rect.h/2`, `shearX/Y = 0`, `perspectiveCorners = null`.
   - Call `transformStore.enter(data)`.
   - Set `transformStore.onApply = handleApply`, `transformStore.onCancel = handleCancel`.
   - `dispatch({ type: 'SET_TOOL', payload: 'transform' })`.

2. **`handleApply()`** (called via `transformStore.onApply`)
   - Read current `transformStore.params` and `transformStore.handleMode`.
   - Compute the 3×3 inverse matrix (see Transform Matrix section).
   - Call WASM:
     - Affine mode (scale / rotate / shear): `applyAffineTransform(floatBuffer, origW, origH, canvasW, canvasH, inverseMatrix6, interpolation)` → `Uint8Array(canvasW × canvasH × 4)`
     - Perspective mode: `applyPerspectiveTransform(floatBuffer, origW, origH, canvasW, canvasH, inverseHomography9, interpolation)` → `Uint8Array`
   - `canvasHandle.writeLayerPixels(layerId, result)` — writes resampled pixels into the layer, flushes GPU, and re-renders.
   - `captureHistory('Free Transform')`.
   - `dispatch({ type: 'SET_TOOL', payload: transformStore.previousTool })`.
   - `transformStore.clear()`.

3. **`handleCancel()`** (called via `transformStore.onCancel`)
   - If `savedLayerPixels` is non-null: `canvasHandle.writeLayerPixels(layerId, savedLayerPixels)` to restore the layer completely (works for both modes; in selection mode this restores the cleared area).
   - If `savedSelectionMask` is non-null: `selectionStore.mask = savedSelectionMask; selectionStore.notify()`.
   - `dispatch({ type: 'SET_TOOL', payload: transformStore.previousTool })`.
   - `transformStore.clear()`.

4. **Keyboard listeners** — `useTransform` sets up its own `keydown` listener (separate from `useKeyboardShortcuts`) that is only active while `transformStore.isActive`:
   - `Enter` → `handleApply()`
   - `Escape` → `handleCancel()`
   This listener is added/removed via a `useEffect` that depends on `transformStore.isActive`. It uses `e.preventDefault()` to suppress the global Escape handler in `useKeyboardShortcuts` that would otherwise clear the selection.

---

### `src/tools/transform.tsx` — Tool handler + options wrapper

**Category:** Tool  
**Single responsibility:** Bounding-box pointer-event handling and the `Options` component entry-point.

#### Handler factory: `createTransformHandler()`

The handler is a plain object (no React). It interacts entirely with `transformStore`.

**Internal state** (closure variables):
- `activeHandle: number | null` — which handle (0-8 scale/rotate, 9 pivot, 10-13 perspective corners) is being dragged
- `dragStartPos: { x, y }` — pointer canvas position at drag start
- `paramsAtDragStart: TransformParams` — snapshot of params when drag began

**`onPointerDown`:**
- If `!transformStore.isActive` return immediately.
- Hit-test at canvas pos against the 9 bounding-box handles + pivot + perspective corners (if applicable). Compute handle world positions from `transformStore.params` using the same `getHandleWorldPositions`-style helpers used in `shape.tsx`.
- If a handle is hit: store `activeHandle`, `dragStartPos`, `paramsAtDragStart`.
- If no handle is hit and pointer is inside the bounding box: start a translate drag (treat as a special case — `activeHandle = HANDLE_TRANSLATE`).

**`onPointerMove`:**
- If `!transformStore.isActive` or `activeHandle === null` return.
- Compute the delta from `dragStartPos` to current pos.
- Dispatch to a handle-specific update function (see Handle Math section below).
- Call `transformStore.updateParams(newParams)` — triggers pub/sub → overlay redraw via Canvas.tsx's subscription.

**`onPointerUp`:**
- Clear `activeHandle`.

**`onHover`:**
- Update cursor style based on the handle under the pointer (resize arrows at handles, rotate cursor near rotation handle, move cursor in interior). Cursor is driven via CSS `cursor` property on `overlayCanvas.style.cursor`.

#### Options component: `TransformOptions`

```tsx
function TransformOptions(_props: { styles: ToolOptionsStyles }): React.JSX.Element {
  return <TransformToolbar />
}
```

The actual UI lives in the `TransformToolbar` window component (below). The `styles` prop is intentionally ignored — `TransformToolbar` manages its own layout.

---

### `src/components/window/TransformToolbar/TransformToolbar.tsx` — Window component

**Category:** Window  
**Single responsibility:** Render the transform options bar; dispatch param changes and Apply/Cancel through `transformStore`.

**Data source:** Subscribes to `transformStore` using the same `subscribe`/`unsubscribe` pattern as `CropOptions`. Does **not** access `AppContext`.

**Layout (left to right, matching the UX design):**

```
[ X ] [ Y ] | [ W ] 🔗 [ H ] | [ ° Rotation ] | Interp ▾ | [Scale][Perspective][Shear] | [Cancel] [Apply]
```

- **X / Y inputs:** `<input type="number">` bound to `transformStore.params.x` / `.y`. On `blur` or `Enter` key: call `transformStore.updateParams({ x: value })`. Values are clamped to `[-10 × canvasW, 10 × canvasW]` on input.
- **W / H inputs:** Same pattern. When the lock icon is active, editing W recalculates H proportionally (and vice versa) using `originalW / originalH` ratio before calling `updateParams`.
- **Lock icon:** Toggles `transformStore.aspectLocked`. Visual state: unlocked = grey chain icon, locked = blue chain icon.
- **Rotation input:** Bound to `params.rotation`. Range `[-180, 180]`; normalised on change.
- **Interpolation dropdown:** `<select>` bound to `transformStore.interpolation`. Options: Nearest Neighbour / Bilinear / Bicubic.
- **Mode toggles (Scale / Perspective / Shear):** Mutually exclusive `<button>` group. On click: `transformStore.handleMode = mode; transformStore.notify()`. When switching to Perspective, `params.perspectiveCorners` is initialised from the current four corner positions. When switching away, `perspectiveCorners` is set to null.
- **Cancel:** `transformStore.triggerCancel()`.
- **Apply:** `transformStore.triggerApply()`.

Tab focus order follows left-to-right visual order; Tab commits the current field's value before moving focus.

---

## Transform Matrix

### Representation

Transform state is stored **decomposed** (not as a raw matrix) so the toolbar can display and edit individual dimensions, rotation, and shear directly. The 2×3 affine forward matrix and 3×3 perspective homography are both **computed on demand** from the decomposed params.

#### Affine forward matrix (scale / rotate / shear)

Given `TransformParams`, the forward transform mapping a content pixel at `(u, v)` (in `[0, origW) × [0, origH)`) to a canvas pixel at `(x, y)` is composed as:

1. **Translate** content so pivot is at origin: `T₁ = translate(-origW/2, -origH/2)` (pivot is the content centre by default)
2. **Shear**: `Sh(shearX, shearY)` where `shearX = tan(shearXDeg × π/180)`
3. **Scale**: `S(params.w / origW, params.h / origH)`
4. **Rotate**: `R(params.rotation × π/180)` about origin
5. **Translate** to final canvas pivot: `T₂ = translate(params.pivotX, params.pivotY)`

Combined 2×3 matrix `M = T₂ · R · S · Sh · T₁`.

For the WASM commit, the **inverse** `M⁻¹` is precomputed in JavaScript (straightforward for an affine matrix) and passed to the WASM function. The WASM function back-maps each output canvas pixel `(x, y)` through `M⁻¹` to source coordinates `(u, v)`, then samples `floatBuffer` with the chosen interpolation.

#### Perspective homography

In Perspective mode, `params.perspectiveCorners` holds the four destination canvas-space corners `[dst_TL, dst_TR, dst_BR, dst_BL]`. The source quad is the original content rectangle `[0, 0], [origW, 0], [origW, origH], [0, origH]`. The 3×3 homography `H` is computed via Direct Linear Transform (DLT) from these four point correspondences. The inverse `H⁻¹` is passed to WASM for back-mapping.

### Live preview

The live preview uses a 2D canvas `setTransform(a, b, c, d, e, f)` call with the **forward** affine matrix for scale/rotate/shear modes:

```typescript
function drawTransformOverlay(
  overlayCanvas: HTMLCanvasElement,
  store: TransformStore,
  zoom: number,
): void {
  const ctx = overlayCanvas.getContext('2d')!
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)

  // 1. Draw transformed content preview (affine modes)
  if (store.floatCanvas && store.params.perspectiveCorners === null) {
    const M = computeForwardMatrix(store.params, store.originalW, store.originalH)
    ctx.save()
    ctx.imageSmoothingEnabled = false   // nearest for perf
    ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f)
    ctx.drawImage(store.floatCanvas, 0, 0)
    ctx.restore()
  }
  // Perspective preview: see Open Questions

  // 2. Draw dashed bounding box
  drawBoundingBox(ctx, store.params, zoom)

  // 3. Draw handles
  drawHandles(ctx, store.params, store.handleMode, zoom)
}
```

`drawTransformOverlay` is called from Canvas.tsx's `transformStore` subscription effect (see Canvas Modifications section).

For **perspective mode** live preview, see Open Questions §1.

---

## Implementation Steps

### Phase 1 — Types and store

1. **`src/types/index.ts`:** Add `'transform'` to `Tool`; add `TransformInterpolation`, `TransformHandleMode`, `TransformParams` types.

2. **`src/store/transformStore.ts`:** Implement the full `TransformStore` class and export `transformStore` singleton. Include `enter(data)`, `updateParams(partial)`, `clear()`, `triggerApply()`, `triggerCancel()`, pub/sub, and all state fields described above.

### Phase 2 — WASM pixel operations

3. **`wasm/src/transform.h` + `wasm/src/transform.cpp`:** Implement:
   - `pixelops_affine_transform(src, srcW, srcH, dst, dstW, dstH, invMatrix[6], interp)` — back-maps each `(dstX, dstY)` through the 2×3 inverse matrix to `(srcU, srcV)`, samples with NN/bilinear/bicubic.
   - `pixelops_perspective_transform(src, srcW, srcH, dst, dstW, dstH, invH[9], interp)` — same but uses the 3×3 inverse homography with perspective divide.
   - Pixels outside `[0, srcW) × [0, srcH)` after back-mapping write transparent (0,0,0,0) to output.

4. **`wasm/src/pixelops.cpp`:** Add `extern "C" EMSCRIPTEN_KEEPALIVE` wrappers for both functions.

5. **`wasm/CMakeLists.txt`:** Append `_pixelops_affine_transform` and `_pixelops_perspective_transform` to `-sEXPORTED_FUNCTIONS`.

6. **`src/wasm/types.ts`:** Add both function signatures to `PixelOpsModule`.

7. **`src/wasm/index.ts`:** Add:
   - `applyAffineTransform(src, srcW, srcH, dstW, dstH, invMatrix, interp)` — allocates a `dstW × dstH × 4` output buffer, calls `_pixelops_affine_transform`, returns `Uint8Array`.
   - `applyPerspectiveTransform(src, srcW, srcH, dstW, dstH, invH, interp)` — same shape.

8. **Run `npm run build:wasm`** to verify the C++ compiles.

### Phase 3 — Tool handler and options component

9. **`src/components/window/TransformToolbar/TransformToolbar.module.scss`:** Styles for the toolbar: flex row, compact number inputs (52 px wide), lock button, mode toggle group, Apply/Cancel buttons. Match the visual design in `docs/designs/free-transform.html`.

10. **`src/components/window/TransformToolbar/TransformToolbar.tsx`:** Implement the window component as described above. Subscribe to `transformStore` for reactive updates.

11. **`src/components/index.ts`:** Add `export { TransformToolbar } from './window/TransformToolbar/TransformToolbar'`.

12. **`src/tools/transform.tsx`:** Implement `createTransformHandler()` and the `TransformOptions` wrapper. Export `transformTool: ToolDefinition`.

13. **`src/tools/index.ts`:** Import `transformTool`; add `transform: transformTool` to `TOOL_REGISTRY`.

### Phase 4 — Canvas overlay integration

14. **`src/components/window/Canvas/Canvas.tsx`:** Add a `useEffect` that:
    - Activates when `state.activeTool === 'transform'`.
    - Subscribes to `transformStore` and calls `drawTransformOverlay(toolOverlayRef.current, transformStore, zoomRef.current)` on each store change.
    - Calls `drawTransformOverlay` immediately on subscription (initial draw).
    - Unsubscribes and clears the overlay when `activeTool` changes away from `'transform'`.

### Phase 5 — Hook and App wiring

15. **`src/hooks/useTransform.ts`:** Implement `useTransform` as described above. Include `handleEnterTransform`, `handleApply`, `handleCancel`, `isFreeTransformEnabled`, and the keyboard listener for Enter/Escape while active.

16. **`src/hooks/useKeyboardShortcuts.ts`:** Add `handleFreeTransform?: () => void` to `UseKeyboardShortcutsOptions` and fire it on `Ctrl+T` / `Cmd+T` (key `'t'` with `ctrlKey` or `metaKey`).

17. **`src/App.tsx`:**
    - Compose `useTransform({ canvasHandleRef, stateRef, dispatch, captureHistory })`.
    - Pass `handleFreeTransform: handleEnterTransform` to `useKeyboardShortcuts`.
    - Pass `onFreeTransform={handleEnterTransform}` and `isFreeTransformEnabled={isFreeTransformEnabled}` to `TopBar`.

18. **`src/components/window/TopBar/TopBar.tsx`:** Add `onFreeTransform` and `isFreeTransformEnabled` props. In the Edit menu, insert after the `'Resize Image Canvas…'` item:
    ```
    { separator: true, label: '' },
    { label: 'Free Transform', shortcut: 'Ctrl+T', disabled: !isFreeTransformEnabled, action: onFreeTransform },
    ```

### Phase 6 — Handle math helpers

19. Inside `src/tools/transform.tsx` (or a co-located `transformGeometry.ts`), implement:
    - `getTransformHandlePositions(params, origW, origH, zoom)` — returns the 9 screen-space handle positions (8 resize/rotate + 1 pivot). Mirrors `getHandleWorldPositions` from `shape.tsx`.
    - `hitTestTransformHandle(params, x, y, zoom)` — returns the hit handle index or null. Same hit-radius logic as in `shape.tsx`.
    - `applyScaleDrag(params, origW, origH, handleIdx, canvasPos, startPos, startParams, shiftKey)` — computes new `x/y/w/h` from a corner or edge drag.
    - `applyRotateDrag(params, canvasPos, startAngle, startParams, shiftKey)` — updates `rotation`, snapping to 15° increments if `shiftKey`.
    - `applyPerspectiveDrag(params, cornerIdx, canvasPos, startPos, startParams, shiftKey)` — updates one corner of `perspectiveCorners`.
    - `applyShearDrag(params, edgeIdx, canvasPos, startPos, startParams)` — updates `shearX` or `shearY`.

---

## Architectural Constraints

- **No business logic in `App.tsx`:** All enter/apply/cancel logic lives in `useTransform`. `App.tsx` only composes the hook and threads callbacks into `TopBar`.
- **Module-level store for non-React state:** The floating pixel buffer (`Uint8Array`) and live preview `OffscreenCanvas` are too large and too frequently mutated to live in React state or `AppContext`. They live in `transformStore` following the established `cropStore` and `selectionStore` patterns.
- **Single undo entry:** `captureHistory('Free Transform')` is called exactly once in `handleApply`, after `writeLayerPixels` has updated the GPU texture. `handleCancel` must not call `captureHistory`.
- **No separate compositing path:** The resampled pixels are written back into the existing layer via `canvasHandle.writeLayerPixels`, which is the same code path used by other pixel-writing operations. The rasterization pipeline is not bypassed.
- **Tool options bar untouched:** `ToolOptionsBar.tsx` does not need modification. When `activeTool === 'transform'`, the registry's `Options` component for `transformTool` renders `TransformToolbar`, which replaces the normal options bar content automatically.
- **Pointer events through `ToolContext`:** The transform handler receives pointer events through the standard `ToolHandler` interface. No raw DOM listeners are attached in the tool.
- **CSS modules:** `TransformToolbar.module.scss` (not `.scss`).
- **WASM access:** Only through `src/wasm/index.ts`. Do not import from `src/wasm/generated/` directly.

---

## Open Questions

1. **Perspective live preview:** Canvas 2D `setTransform` is affine-only and cannot render perspective distortion. Three options, each with trade-offs:
   - **(a) WebGPU fragment shader:** Add a `previewPerspective(floatCanvas, corners)` method to `WebGPURenderer` that blits the floating buffer with a perspective-corrected full-screen quad (reuses the existing blit pipeline with a custom vertex shader for the 4-point warp). Fast, correct. Requires a new shader.
   - **(b) 2D canvas mesh subdivision:** Subdivide the source quad into an N×N grid of triangles, draw each with `drawImage` + clip — slow for N > 8, produces seams.
   - **(c) Deferred preview:** Show only the handle outline during drag; render the full perspective preview on `pointerUp`. Acceptable UX for an uncommon mode.
   Option (a) is recommended but needs a decision on scope before implementation.

2. **Shear axis conventions:** The spec defines shear as edge mid-point drag, but does not specify whether shear is defined as an angle (degrees), a pixel offset, or a ratio. Recommend degrees (consistent with Rotation field units), displayed as a read-only value in the toolbar in Shear mode. Confirm before implementing the toolbar.

3. **Pivot position in toolbar:** The spec does not include X/Y fields for the pivot point in the toolbar layout. Pivot repositioning is gesture-only (drag the cross-hair). If a numeric pivot input is desired later, the `transformStore.params` already carries `pivotX/pivotY` and the toolbar can be extended.

4. **Very large canvas performance:** For canvases larger than ~4000×4000 px, the WASM transform commit may block the main thread visibly. If this becomes an issue, the commit can be moved to a Web Worker that receives a `SharedArrayBuffer` copy of the float buffer. This is not required for the initial implementation.

5. **Coalesced events during handle drag:** The spec's tablet input rules say to replay coalesced events for pen/touch, but not for high-polling mice. For transform handle drags, replaying coalesced events at ~1000 Hz would re-run the full matrix computation and overlay redraw per event. The handler should **not** use `onPointerMoveBatch` for transform; a single update per frame is sufficient for bounding-box manipulation.

6. **Commit pixel buffer size vs. layer offset:** `canvasHandle.writeLayerPixels` expects a canvas-size RGBA buffer. The WASM transform functions output a canvas-size buffer (out-of-canvas content is transparent), which matches directly. No layer offset adjustment is needed on the write path.
