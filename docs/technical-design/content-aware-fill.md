# Technical Design: Content-Aware Fill & Content-Aware Delete

## Overview

Content-Aware Fill and Content-Aware Delete are destructive inpainting operations that synthesise replacement pixels for a user-defined selection region using the PatchMatch algorithm. The algorithm runs entirely in a C++/WASM compute layer (new `wasm/src/inpaint.cpp`), called asynchronously from a new `useContentAwareFill` hook. The output is always a new raster layer inserted above the active layer; Content-Aware Delete additionally erases the selection from the active layer. Both operations are single atomic undo steps. Both menu items appear in the **Edit** menu and are disabled when no selection is active.

---

## Affected Areas

| File | Change |
|---|---|
| `wasm/src/inpaint.h` | **New** — C++ header declaring `inpaint()` |
| `wasm/src/inpaint.cpp` | **New** — PatchMatch inpainting implementation |
| `wasm/src/pixelops.cpp` | **Modify** — add `#include "inpaint.h"` and `EMSCRIPTEN_KEEPALIVE` wrapper `pixelops_inpaint` |
| `wasm/CMakeLists.txt` | **Modify** — add `src/inpaint.cpp` to sources; add `_pixelops_inpaint` to `EXPORTED_FUNCTIONS` |
| `src/wasm/types.ts` | **Modify** — add `_pixelops_inpaint` signature to `PixelOpsModule` |
| `src/wasm/index.ts` | **Modify** — add `inpaintRegion()` public wrapper |
| `src/hooks/useContentAwareFill.ts` | **New** — hook owning all inpaint business logic |
| `src/App.tsx` | **Modify** — import hook, add `isContentAwareFilling` state, wire two menu actions, render progress overlay |
| `src/components/dialogs/ContentAwareFillProgress/ContentAwareFillProgress.tsx` | **New** — progress overlay component |
| `src/components/dialogs/ContentAwareFillProgress/ContentAwareFillProgress.module.scss` | **New** — styles for the overlay |
| `src/components/index.ts` | **Modify** — export `ContentAwareFillProgress` |
| `electron/main/menu.ts` | **Modify** — add two Edit menu items after the Delete item |

---

## State Changes

### New `App.tsx` local state

```ts
const [isContentAwareFilling, setIsContentAwareFilling] = useState(false)
```

No changes to `AppState` in `src/types/index.ts` are required. The operation produces no persistent state beyond the layer changes that already flow through `AppContext` (layer list, active layer id).

---

## New Components / Hooks / Tools

### `src/hooks/useContentAwareFill.ts`

**Category:** hook  
**Single responsibility:** orchestrate the Content-Aware Fill and Content-Aware Delete operations (composite sample → WASM inpaint → new layer + optional active-layer erase → undo snapshot).

**Options interface:**

```ts
interface UseContentAwareFillOptions {
  canvasHandleRef: { readonly current: CanvasHandle | null }
  stateRef: MutableRefObject<AppState>
  captureHistory: (label: string) => void
  dispatch: Dispatch<AppAction>
  pendingLayerLabelRef: MutableRefObject<string | null>
  setIsContentAwareFilling: (v: boolean) => void
}
```

**Return interface:**

```ts
interface UseContentAwareFillReturn {
  handleContentAwareFill:   () => Promise<void>
  handleContentAwareDelete: () => Promise<void>
}
```

### `src/components/dialogs/ContentAwareFillProgress/ContentAwareFillProgress.tsx`

**Category:** dialog  
**Single responsibility:** render a full-screen blocking overlay with a spinner and status text while the WASM inpaint computation runs.  
**Props:**

```ts
interface ContentAwareFillProgressProps {
  /** When false the component renders nothing (keeps it in the tree for instant show/hide). */
  visible: boolean
  /** Label shown below the spinner. Default: "Analyzing image…" */
  label?: string
}
```

---

## Implementation Steps

### Step 1 — C++ header `wasm/src/inpaint.h`

Create `wasm/src/inpaint.h` with a single declaration:

```cpp
#pragma once
#include <cstdint>

/**
 * PatchMatch inpainting.
 *
 * @param pixels   RGBA source image, row-major, width × height × 4 bytes.
 * @param width    Image width in pixels.
 * @param height   Image height in pixels.
 * @param mask     Single-channel mask, width × height bytes.
 *                 255 = fill region (to synthesise), 0 = source region (known).
 * @param patchSize Patch half-radius in pixels (full patch = (2*patchSize+1)²).
 *                  Recommended: 4 (→ 9×9 patches).
 * @param out      Pre-allocated RGBA output buffer, same size as pixels.
 *                 Pixels outside the mask are copied from pixels unchanged.
 *                 Pixels inside the mask are replaced with the inpainted result.
 */
void inpaint(
    const uint8_t* pixels, int width, int height,
    const uint8_t* mask, int patchSize,
    uint8_t* out
);
```

---

### Step 2 — C++ implementation `wasm/src/inpaint.cpp`

Implement `inpaint()`. The algorithm follows Barnes et al. (2009) PatchMatch, adapted for inpainting (Criminisi et al.-style onion-skin fill order).

**Data structures:**

```cpp
// Nearest-neighbour field: for each fill pixel (x,y), stores the best matching
// source patch offset (dx, dy) in the known region.
struct Offset { int dx, dy; };
```

**Algorithm outline:**

1. **Separate fill pixels from source pixels** using the mask. Build a list of all fill-region pixels (`mask[y*width+x] == 255`).

2. **Onion-skin ordering** — sort fill pixels by their distance to the nearest source pixel (BFS wavefront from source boundary, inward). Process pixels in ascending distance order (boundary first).

3. **Initialise NNF** — for each fill pixel, assign a random offset `(dx, dy)` such that the patch it points to falls entirely within the source region. Re-draw if the candidate patch overlaps the fill region.

4. **Iterative propagation and random search** — run at least 5 full passes. Alternate between forward (left→right, top→bottom) and backward (right→left, bottom→top) scan direction per pass:
   - **Propagation:** for pixel `p`, try the offset of its left neighbor and top neighbor (or right/bottom on backward pass). Accept if SSD patch distance is lower.
   - **Random search:** starting from the current best match at radius `alpha * max(width, height)` (where `alpha = 0.5`), halve the radius and try a random offset within it; repeat until radius < 1. Accept improvements.

5. **Reconstruction** — for each fill pixel, copy the RGBA values from the matched source patch center into `out`. Process in onion-skin order so earlier-filled pixels become available as source pixels for subsequent fill pixels (update the working copy).

**SSD distance function:**

```cpp
// Sum of squared differences over a (2*patchSize+1)² patch, RGB channels only.
// Clamps coordinates to image bounds. Skips fill-region pixels in the source patch
// (only counts known pixels; normalises by the count of valid pixels).
static float patchSSD(
    const uint8_t* img, int width, int height,
    const uint8_t* mask,
    int ax, int ay,   // fill-side patch centre
    int bx, int by,   // source-side patch centre
    int halfPatch
);
```

**Gotchas:**
- The working image must be updated in-place as each onion-skin ring is filled, so later rings can use already-filled pixels as source. Maintain a `working` copy of `pixels` that is updated alongside `out`.
- Initialise `out` by copying `pixels` verbatim; overwrite only fill-region pixels.
- On WASM with `ALLOW_MEMORY_GROWTH`, the stack can be arbitrarily large without issues, but the NNF array (`width * height * sizeof(Offset)`) should be heap-allocated.
- The mask passed from TypeScript is a canvas-space single-channel `Uint8Array` (values 0 or 255, one byte per pixel, `width * height` bytes total). This matches `selectionStore.mask` exactly — no reinterpretation needed.

---

### Step 3 — WASM entry point in `wasm/src/pixelops.cpp`

Add to `pixelops.cpp` (after the perspective transform entry point, before the closing `} // extern "C"`):

```cpp
#include "inpaint.h"

// ─── Content-Aware Inpainting ─────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_inpaint(
    const uint8_t* pixels, int width, int height,
    const uint8_t* mask, int patchSize,
    uint8_t* out
) {
    inpaint(pixels, width, height, mask, patchSize, out);
}
```

---

### Step 4 — `wasm/CMakeLists.txt`

Two changes:

**a) Add `src/inpaint.cpp` to the source list:**

```cmake
add_executable(pixelops
  src/pixelops.cpp
  src/fill.cpp
  src/filters.cpp
  src/quantize.cpp
  src/resize.cpp
  src/dither.cpp
  src/curves_histogram.cpp
  src/transform.cpp
  src/inpaint.cpp          # ← add this line
)
```

**b) Append `_pixelops_inpaint` to the `EXPORTED_FUNCTIONS` list:**

```cmake
"-sEXPORTED_FUNCTIONS=_malloc,_free,_pixelops_flood_fill,...,_pixelops_affine_transform,_pixelops_perspective_transform,_pixelops_inpaint"
```

(Replace `...` with the existing symbols verbatim; only append `_pixelops_inpaint` at the end.)

---

### Step 5 — `src/wasm/types.ts`

Add to the `PixelOpsModule` interface, after `_pixelops_perspective_transform`:

```ts
/**
 * Content-aware inpainting via PatchMatch.
 * pixels: RGBA source, width×height×4 bytes.
 * mask:   single-channel fill mask, width×height bytes (255 = fill, 0 = source).
 * patchSize: patch half-radius (recommended: 4 → 9×9 patches).
 * out:    pre-allocated RGBA output buffer, same size as pixels.
 */
_pixelops_inpaint(
  pixelsPtr: number,
  width: number,
  height: number,
  maskPtr: number,
  patchSize: number,
  outPtr: number
): void
```

---

### Step 6 — `src/wasm/index.ts`

Add a public wrapper after the existing `removeMotionBlur` or `perspectiveTransform` export:

```ts
/**
 * Content-aware inpainting (PatchMatch).
 *
 * @param pixels   RGBA flat canvas composite, width × height × 4 bytes.
 * @param width    Canvas width in pixels.
 * @param height   Canvas height in pixels.
 * @param mask     Single-channel fill mask from selectionStore.mask,
 *                 width × height bytes (255 = fill region, 0 = source region).
 * @returns        RGBA output buffer, same dimensions as pixels.
 *                 Pixels outside the mask are unchanged copies of the input.
 */
export async function inpaintRegion(
  pixels: Uint8Array,
  width: number,
  height: number,
  mask: Uint8Array
): Promise<Uint8Array> {
  const m = await getPixelOps()
  const PATCH_SIZE = 4 // → 9×9 patches
  const byteLen = pixels.byteLength // width * height * 4

  const pixelsPtr = m._malloc(byteLen)
  const maskPtr   = m._malloc(mask.byteLength)
  const outPtr    = m._malloc(byteLen)
  try {
    m.HEAPU8.set(pixels, pixelsPtr)
    m.HEAPU8.set(mask,   maskPtr)
    m._pixelops_inpaint(pixelsPtr, width, height, maskPtr, PATCH_SIZE, outPtr)
    // Re-read HEAPU8 in case WASM memory grew during the call
    return m.HEAPU8.slice(outPtr, outPtr + byteLen)
  } finally {
    m._free(pixelsPtr)
    m._free(maskPtr)
    m._free(outPtr)
  }
}
```

**Memory note:** Three separate buffers are allocated (`pixels`, `mask`, `out`). All are freed in `finally` regardless of success or failure. The `HEAPU8.slice()` call after the WASM call re-reads the live view, which is correct per the project convention when `ALLOW_MEMORY_GROWTH=1`.

---

### Step 7 — `src/hooks/useContentAwareFill.ts`

Create the file. Full logical flow:

```ts
import { useCallback } from 'react'
import type { Dispatch, MutableRefObject } from 'react'
import type { AppState } from '@/types'
import type { AppAction } from '@/store/AppContext'
import type { CanvasHandle } from '@/components/window/Canvas/Canvas'
import { selectionStore } from '@/store/selectionStore'
import { inpaintRegion, getPixelOps } from '@/wasm'
import { showOperationError } from '@/utils/userFeedback'

interface UseContentAwareFillOptions {
  canvasHandleRef: { readonly current: CanvasHandle | null }
  stateRef: MutableRefObject<AppState>
  captureHistory: (label: string) => void
  dispatch: Dispatch<AppAction>
  pendingLayerLabelRef: MutableRefObject<string | null>
  setIsContentAwareFilling: (v: boolean) => void
}

export interface UseContentAwareFillReturn {
  handleContentAwareFill:   () => Promise<void>
  handleContentAwareDelete: () => Promise<void>
}

export function useContentAwareFill({
  canvasHandleRef,
  stateRef,
  captureHistory,
  dispatch,
  pendingLayerLabelRef,
  setIsContentAwareFilling,
}: UseContentAwareFillOptions): UseContentAwareFillReturn {

  // ── Shared core ────────────────────────────────────────────────────────────

  const runInpaint = useCallback(async (eraseActiveLayer: boolean): Promise<void> => {
    const handle  = canvasHandleRef.current
    const { layers, activeLayerId, canvas } = stateRef.current

    // 1. Guard: selection must exist
    if (!selectionStore.hasSelection()) return
    const mask = selectionStore.mask! // non-null after hasSelection() check

    // 2. Guard: selection bounding box must be ≥ 4×4
    const { width: cw, height: ch } = canvas
    let minX = cw, minY = ch, maxX = 0, maxY = 0
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (mask[y * cw + x]) {
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX - minX < 3 || maxY - minY < 3) {
      // Selection is smaller than 4×4 — alert and return
      window.alert('Content-Aware Fill requires a selection of at least 4×4 pixels.')
      return
    }

    // 3. Guard: WASM module must be ready
    if (!handle) return
    try { await getPixelOps() } catch {
      window.alert('WASM module is not ready. Please wait and try again.')
      return
    }

    try {
      setIsContentAwareFilling(true)

      // 4. Flatten all visible layers to a canvas-sized RGBA composite
      const { data: composite, width, height } = await handle.rasterizeComposite('sample')

      // 5. Run PatchMatch inpainting
      //    mask is already canvas-space single-channel Uint8Array (255=fill, 0=source)
      const inpainted = await inpaintRegion(composite, width, height, mask)

      // 6. Capture undo snapshot BEFORE making changes
      const label = eraseActiveLayer ? 'Content-Aware Delete' : 'Content-Aware Fill'
      captureHistory(label)

      // 7. Build the fill layer pixels:
      //    Copy inpainted result but zero-out alpha for pixels outside the selection.
      //    Output layer is canvas-sized (same as the composite).
      const fillLayerData = new Uint8Array(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        if (mask[i]) {
          fillLayerData[i * 4]     = inpainted[i * 4]
          fillLayerData[i * 4 + 1] = inpainted[i * 4 + 1]
          fillLayerData[i * 4 + 2] = inpainted[i * 4 + 2]
          fillLayerData[i * 4 + 3] = inpainted[i * 4 + 3]
        }
        // else: stays 0 (transparent outside selection)
      }

      // 8. Create new fill layer above the active layer
      const newLayerId   = `layer-${Date.now()}`
      const newLayerName = eraseActiveLayer ? 'Content-Aware Delete' : 'Content-Aware Fill'
      handle.prepareNewLayer(newLayerId, newLayerName, fillLayerData)

      // Insert the new layer directly above the active layer in the layers array
      const currentLayers = stateRef.current.layers
      const activeIdx = activeLayerId
        ? currentLayers.findIndex(l => l.id === activeLayerId)
        : currentLayers.length - 1
      const insertIdx = activeIdx >= 0 ? activeIdx + 1 : currentLayers.length

      const newLayerState = {
        id:        newLayerId,
        name:      newLayerName,
        visible:   true,
        opacity:   1,
        locked:    false,
        blendMode: 'normal' as const,
      }
      const updatedLayers = [
        ...currentLayers.slice(0, insertIdx),
        newLayerState,
        ...currentLayers.slice(insertIdx),
      ]
      dispatch({ type: 'REORDER_LAYERS', payload: updatedLayers })
      dispatch({ type: 'SET_ACTIVE_LAYER', payload: newLayerId })

      // 9. Content-Aware Delete: additionally erase selection from active layer
      if (eraseActiveLayer && activeLayerId) {
        const activeGpuLayer = handle.getGpuLayer(activeLayerId)
        if (activeGpuLayer) {
          // Erase selected pixels on the active layer (set alpha to 0)
          // The active layer may have layer-local offset — project canvas coords to layer-local
          const { offsetX, offsetY, layerWidth, layerHeight, data } = activeGpuLayer
          for (let cy2 = 0; cy2 < ch; cy2++) {
            for (let cx2 = 0; cx2 < cw; cx2++) {
              if (!mask[cy2 * cw + cx2]) continue
              const lx = cx2 - offsetX
              const ly = cy2 - offsetY
              if (lx < 0 || lx >= layerWidth || ly < 0 || ly >= layerHeight) continue
              const idx = (ly * layerWidth + lx) * 4
              data[idx + 3] = 0 // erase alpha
            }
          }
          handle.flushLayer(activeLayerId)
        }
      }

    } catch (error) {
      showOperationError(
        eraseActiveLayer ? 'Content-Aware Delete failed.' : 'Content-Aware Fill failed.',
        error
      )
    } finally {
      setIsContentAwareFilling(false)
    }
  }, [canvasHandleRef, stateRef, captureHistory, dispatch, setIsContentAwareFilling])

  const handleContentAwareFill   = useCallback(() => runInpaint(false), [runInpaint])
  const handleContentAwareDelete = useCallback(() => runInpaint(true),  [runInpaint])

  return { handleContentAwareFill, handleContentAwareDelete }
}
```

**Coordinate space note:** `selectionStore.mask` is always canvas-space (`canvas.width × canvas.height`). The composite returned by `handle.rasterizeComposite('sample')` is also canvas-sized. Both are the same coordinate space; no offset adjustment is needed for the inpaint call itself. The layer-local adjustment is only required for the erase pass in Content-Aware Delete (step 9), which projects canvas coords into the active layer's local offset frame.

**`handle.getGpuLayer` / `handle.flushLayer` note:** see the "Open Questions" section — these methods need to be verified against `CanvasHandle`. If they do not exist, see the alternative approach described there.

---

### Step 8 — `src/components/dialogs/ContentAwareFillProgress/ContentAwareFillProgress.tsx`

```tsx
import React from 'react'
import styles from './ContentAwareFillProgress.module.scss'

export interface ContentAwareFillProgressProps {
  visible: boolean
  label?: string
}

export function ContentAwareFillProgress({
  visible,
  label = 'Analyzing image\u2026',
}: ContentAwareFillProgressProps): React.JSX.Element | null {
  if (!visible) return null
  return (
    <div className={styles.scrim}>
      <div className={styles.card}>
        <div className={styles.spinner} />
        <p className={styles.label}>{label}</p>
      </div>
    </div>
  )
}
```

---

### Step 9 — `src/components/dialogs/ContentAwareFillProgress/ContentAwareFillProgress.module.scss`

```scss
.scrim {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 28px 36px;
  background: #2d2d2d;
  border: 1px solid #191919;
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #555;
  border-top-color: #0699fb;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.label {
  font-size: 12px;
  color: #aaa;
  text-align: center;
}
```

---

### Step 10 — `src/components/index.ts`

Add the export alongside the other dialog exports:

```ts
export { ContentAwareFillProgress } from './dialogs/ContentAwareFillProgress/ContentAwareFillProgress'
```

---

### Step 11 — `src/App.tsx`

**a) Import:**

```ts
import { useContentAwareFill } from '@/hooks/useContentAwareFill'
import { ContentAwareFillProgress } from '@/components'
```

**b) State:**

Add after the other dialog `useState` declarations:

```ts
const [isContentAwareFilling, setIsContentAwareFilling] = useState(false)
```

**c) Hook instantiation:**

Add after the `useLayers` block (or alongside `useFilters` — any position before the menu handler is fine):

```ts
// ── Content-Aware Fill / Delete ───────────────────────────────────────────────
const { handleContentAwareFill, handleContentAwareDelete } = useContentAwareFill({
  canvasHandleRef, stateRef, captureHistory, dispatch,
  pendingLayerLabelRef, setIsContentAwareFilling,
})
```

**d) `macMenuHandlerRef.current` switch cases:**

Inside the `switch (actionId)` block in the macOS menu handler, add after the `'delete'` case:

```ts
case 'contentAwareFill':   void handleContentAwareFill();   break
case 'contentAwareDelete': void handleContentAwareDelete(); break
```

Also add both handlers to the `useCallback` dependency array.

**e) Enabled-state sync effect:**

Inside the `setMenuItemEnabled` effect (the one that already syncs `freeTransform`, `rasterizeLayer`, etc.), add:

```ts
contentAwareFill:   selectionStore.hasSelection(),
contentAwareDelete: selectionStore.hasSelection(),
```

However, since `selectionStore` is a module-level singleton (not React state), this effect must re-run when the selection changes. Subscribe to `selectionStore` using its `subscribe`/`unsubscribe` API and force a re-render with a small counter or by keeping a `hasSelection` boolean in component state:

```ts
// Near the other useState declarations:
const [hasSelection, setHasSelection] = useState(false)

// In a useEffect:
useEffect(() => {
  const update = (): void => setHasSelection(selectionStore.hasSelection())
  selectionStore.subscribe(update)
  return () => selectionStore.unsubscribe(update)
}, [])
```

Then reference `hasSelection` in the enabled-state effect:

```ts
contentAwareFill:   hasSelection,
contentAwareDelete: hasSelection,
```

And add `hasSelection` to the effect's dependency array.

**f) Progress overlay rendering:**

In the JSX return, add the overlay just before the closing `</div>` of the root `.app` div (alongside the other overlay/dialog renders):

```tsx
<ContentAwareFillProgress
  visible={isContentAwareFilling}
  label="Filling…"
/>
```

---

### Step 12 — `electron/main/menu.ts`

In the Edit submenu, after the `item('Delete', ...)` entry and its following separator (`sep()`), add a new separator and two new items:

```ts
item('Delete',               'delete',        { accelerator: 'Backspace',         noIntercept: true }),
sep(),
item('Content-Aware Fill',   'contentAwareFill'),
item('Content-Aware Delete', 'contentAwareDelete', {
  accelerator: 'Shift+Delete',
  noIntercept: false,   // Electron intercepts and sends 'menu:action'
}),
sep(),
item('Resize Image\u2026', ...),
```

**Accelerator note:** `Shift+Delete` / `Shift+Backspace` are distinct keys in Electron menu accelerators. Electron's cross-platform `Delete` token maps to the Delete/Backspace key. Use `Shift+Delete` as the accelerator string. Set `noIntercept: false` (the default) so Electron registers the shortcut globally and forwards it via `menu:action`. This means the renderer does **not** need a separate `keydown` handler for this shortcut — the IPC channel handles it.

**Menu item IDs:** Electron's `id` field (set by the `item()` helper) must match the strings used in `window.api.setMenuItemEnabled(...)`. The IDs are `'contentAwareFill'` and `'contentAwareDelete'`.

---

## Architectural Constraints

- **Unified rasterization pipeline:** The hook calls `handle.rasterizeComposite('sample')` — the single canonical entry point — to obtain the composite image for context sampling. No ad-hoc compositing is introduced.
- **WASM memory management:** Three buffers (`pixels`, `mask`, `out`) are `_malloc`-allocated in TypeScript and freed in `finally`. The returned `Uint8Array` is a `.slice()` (copied out of WASM linear memory) before any free occurs. `HEAPU8` is re-read after the WASM call per project convention for `ALLOW_MEMORY_GROWTH=1`.
- **Undo atomicity:** `captureHistory()` is called once, before any mutations (insert layer, erase pixels). A single undo step reverts both the new fill layer and the erase — because the history snapshot captures the full layer-pixel state before either mutation.
- **No React state for progress during async WASM:** `setIsContentAwareFilling` is a React `useState` setter passed into the hook. Setting it to `true` before the async call and `false` in `finally` keeps the overlay driven by React state without polling or side effects.
- **Tool pointer events:** no raw DOM listeners are introduced. The operations are triggered by menu action IDs only.
- **WASM direct import ban:** `inpaintRegion` is exported from `src/wasm/index.ts` and consumed from there. Nothing in the hook imports from `src/wasm/generated/` directly.
- **Module-level singleton access:** `selectionStore` is imported directly in the hook (module-level singleton pattern). This is consistent with every other hook that reads selection state (e.g. `useClipboard`, `useAdjustments`).
- **Component category:** `ContentAwareFillProgress` is placed under `dialogs/` because it wraps a modal interaction (blocking overlay). It uses no `AppContext` and accepts only props — consistent with the dialog category rules.
- **CSS modules:** both new files use `.module.scss` only.

---

## Open Questions

1. **`handle.getGpuLayer` / `handle.flushLayer` existence.** The Content-Aware Delete erase pass (step 7, item 9 above) requires direct access to the active layer's `GpuLayer` pixel buffer and a way to flush it back to the GPU texture. The design assumes `CanvasHandle` exposes `getGpuLayer(layerId: string): GpuLayer | null` and `flushLayer(layerId: string): void` (both accessible today via `WebGPURenderer` inside the canvas, but potentially not yet exposed on `CanvasHandle`). **Resolution options:**
   - Expose `getGpuLayer` and `flushLayer` on `CanvasHandle` (minimal addition to `canvasHandle.ts`).
   - Alternatively, add a new `CanvasHandle` method `eraseSelection(layerId: string, mask: Uint8Array): void` that performs the erase internally, keeping pixel buffer access private to the canvas module. This is the architecturally cleaner option.

2. **`selectionStore` subscription in the menu-enabled effect.** The design adds a `hasSelection` React state driven by a `selectionStore.subscribe()` effect. This is a new pattern in `App.tsx` (no existing menu item currently depends on selection state). Confirm this is acceptable or whether a different approach (e.g. passing `selectionStore.hasSelection()` as a prop into a menu sync hook) is preferred.

3. **`Shift+Delete` on macOS.** On macOS the Delete key in Electron accelerators refers to the Backspace key on Apple keyboards. The Forward Delete key is a separate symbol. Confirm whether `Shift+Delete` (Shift+Backspace) is the intended shortcut or whether `Shift+Backspace` should be listed explicitly. The spec says "Shift+Delete / Shift+Backspace" — listing `Shift+Delete` in the Electron accelerator covers the Backspace key on Mac. A developer should verify this on hardware before release.

4. **Large image performance.** PatchMatch on a 4000×3000 image with a large selection region will take several seconds even in WASM. The spec explicitly defers cancellation to a future version. A future improvement could run the algorithm on a downscaled proxy and upsample the NNF before reconstruction, but this is out of scope for v1.

5. **Fill layer coordinate space.** The design creates the fill layer at full canvas size (no `layerWidth`/`layerHeight`/`offsetX`/`offsetY` override in `prepareNewLayer`). This means the fill layer is the same size as the canvas, matching the composite. An optimisation could crop the fill layer to the selection bounding box (pass `lw`, `lh`, `ox`, `oy` to `prepareNewLayer`). This is safe to add later without design changes.
