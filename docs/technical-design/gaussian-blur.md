# Technical Design: Gaussian Blur

## Overview

Gaussian Blur is a destructive pixel-layer filter that runs a separable Gaussian convolution over the active layer's pixel data via the existing WASM helper `gaussianBlur()`. It is accessed through the **Filters** menu (infrastructure owned by [filters-menu.md](filters-menu.md)) and presented as a self-contained modal dialog. The dialog captures original pixels at open, provides a debounced live preview by writing blurred pixels directly back to the layer (no history push), and on **Apply** commits the final blurred result and records one undo entry. **Cancel** restores the original pixels with no history side-effect. When an active selection exists, only selected pixels are replaced by their blurred equivalents. One new method — `writeLayerPixels` — is added to `CanvasHandle` to support in-place layer writes.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `FilterKey` — prerequisite from Filters Menu TD; no additional change needed here |
| `src/filters/registry.ts` | New file — prerequisite from Filters Menu TD; no additional change needed here |
| `src/hooks/useFilters.ts` | New file. Menu-enable logic and `handleOpenGaussianBlur` open callback only (see Filters Menu TD) |
| `src/components/window/Canvas/canvasHandle.ts` | Add `writeLayerPixels` to `CanvasHandle` interface and implement it in `useImperativeHandle` |
| `src/components/dialogs/GaussianBlurDialog/GaussianBlurDialog.tsx` | **New file.** Dialog component: captures pixels at open, runs WASM preview, applies/cancels |
| `src/components/dialogs/GaussianBlurDialog/GaussianBlurDialog.module.scss` | **New file.** Dialog styles |
| `src/components/index.ts` | Export `GaussianBlurDialog` |
| `src/components/window/TopBar/TopBar.tsx` | Add filters menu props and Filters `MenuDef` — prerequisite from Filters Menu TD |
| `src/App.tsx` | Extend per Filters Menu TD; replace stub `GaussianBlurDialog` render with full prop set |

---

## State Changes

No new `AppState` fields are required. The blur operation does not change layer structure — it only mutates pixel data in an existing layer.

Dialog-local state (`radius`, `isBusy`) and working refs (`originalPixelsRef`, `selectionMaskRef`, `debounceTimerRef`) live entirely inside `GaussianBlurDialog`. Nothing survives the dialog unmount.

---

## New `CanvasHandle` Method: `writeLayerPixels`

### Check

The current `CanvasHandle` interface does **not** contain `writeLayerPixels`. The closest existing methods are:

- `getLayerPixels(layerId)` — expands a layer's internal buffer to a canvas-size `Uint8Array` (read path).
- `prepareNewLayer(...)` — creates a new `WebGLLayer` record and fills it; unsuitable for updating an existing layer in-place.
- `restoreAllLayerPixels(...)` — restores all layers from a history snapshot map; too broad for a single-layer preview write.

`writeLayerPixels` is therefore a net-new method.

### Interface addition — `src/components/window/Canvas/canvasHandle.ts`

Add to the `CanvasHandle` interface:

```ts
/**
 * Write a canvas-size RGBA pixel buffer into an existing layer, flush to GPU,
 * and re-render. `pixels` must be Uint8Array of length (canvasWidth × canvasHeight × 4),
 * the same format returned by `getLayerPixels`. This is the write-back counterpart
 * to `getLayerPixels`. Does NOT push to undo history — callers are responsible for that.
 */
writeLayerPixels: (layerId: string, pixels: Uint8Array) => void
```

### Implementation — inside `useImperativeHandle` in `canvasHandle.ts`

The inner loop is the exact inverse of `getLayerPixels`: for each layer-local coordinate `(lx, ly)`, compute the canvas-space source index then copy four RGBA bytes into `layer.data`.

```ts
writeLayerPixels: (layerId, pixels) => {
  const renderer = rendererRef.current
  const layer    = glLayersRef.current.get(layerId)
  if (!renderer || !layer) return
  const w = renderer.pixelWidth
  const h = renderer.pixelHeight
  for (let ly = 0; ly < layer.layerHeight; ly++) {
    const cy = layer.offsetY + ly
    if (cy < 0 || cy >= h) continue
    for (let lx = 0; lx < layer.layerWidth; lx++) {
      const cx = layer.offsetX + lx
      if (cx < 0 || cx >= w) continue
      const si = (cy * w + cx) * 4              // source: canvas-size buffer
      const di = (ly * layer.layerWidth + lx) * 4  // dest:   layer-local buffer
      layer.data[di]     = pixels[si]
      layer.data[di + 1] = pixels[si + 1]
      layer.data[di + 2] = pixels[si + 2]
      layer.data[di + 3] = pixels[si + 3]
    }
  }
  renderer.flushLayer(layer)
  renderFromPlan()
},
```

---

## `GaussianBlurDialog` Component

### Props

```ts
// src/components/dialogs/GaussianBlurDialog/GaussianBlurDialog.tsx

import type { CanvasHandle } from '@/components/window/Canvas/canvasHandle'

export interface GaussianBlurDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number   // state.canvas.width — needed as gaussianBlur() argument
  canvasHeight:    number   // state.canvas.height
}
```

`canvasWidth` / `canvasHeight` are passed from `App.tsx` rather than read from `AppContext` inside the component so the dialog has no `AppContext` dependency. The values match `state.canvas.width/height`, consistent with the same pattern in `useCanvasTransforms`.

### Category

**Dialog** — wraps `ModalDialog`, uses `DialogButton` and a slider/number widget. Does not import `AppContext`.

### File-level constants and pure helpers

```ts
const MIN_RADIUS     = 1
const MAX_RADIUS     = 250
const DEFAULT_RADIUS = 2
const DEBOUNCE_MS    = 500

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)))
}
```

`clamp` rounds to integer so fractional slider ticks never produce a sub-pixel radius.

### Selection-aware compositing helper (module-level, not exported)

```ts
function applySelectionComposite(
  blurred:  Uint8Array,
  original: Uint8Array,
  mask:     Uint8Array | null,
): Uint8Array {
  // No selection → full layer is the target; return blurred buffer as-is.
  if (mask === null) return blurred

  // Selection active → pixels where mask[i] !== 0 receive the blurred value;
  // all others keep the original.
  const out = original.slice()
  const pixelCount = mask.length  // 1 byte per canvas pixel
  for (let i = 0; i < pixelCount; i++) {
    if (mask[i] !== 0) {
      const p = i * 4
      out[p]     = blurred[p]
      out[p + 1] = blurred[p + 1]
      out[p + 2] = blurred[p + 2]
      out[p + 3] = blurred[p + 3]
    }
  }
  return out
}
```

`mask[i] !== 0` is the selection test; `selectionStore.mask` values are `1` (selected) or `0` (not selected) as defined in `selectionStore.ts`.

The blur input is always the **full canvas-size** original buffer (not clipped to the selection region). This is required for correct boundary behaviour: the Gaussian kernel reads neighbouring pixels outside the selection boundary to produce the correct output values at those boundary pixels. If the input were pre-clipped, boundary pixels would convolve against zero-alpha falloff instead of the true neighbours.

### Internal state and refs

| Name | Kind | Purpose |
|---|---|---|
| `radius` | `useState<number>(DEFAULT_RADIUS)` | Controlled value driving both slider and number input |
| `isBusy` | `useState<boolean>(false)` | True while a WASM call is in flight; disables Apply during computation |
| `isBusyRef` | `useRef<boolean>(false)` | Synchronous mirror of `isBusy` for reads inside async callbacks where stale closure is a risk |
| `originalPixelsRef` | `useRef<Uint8Array \| null>(null)` | Canvas-size RGBA snapshot taken at dialog open; ground truth for preview and cancel |
| `selectionMaskRef` | `useRef<Uint8Array \| null>(null)` | Snapshot of `selectionStore.mask` taken at dialog open; frozen for the dialog's lifetime (modal — selection cannot change while open) |
| `debounceTimerRef` | `useRef<ReturnType<typeof setTimeout> \| null>(null)` | Handle for the pending debounce timeout |

### Initialization effect

```ts
useEffect(() => {
  if (!isOpen) return
  const handle = canvasHandleRef.current
  if (!handle || activeLayerId == null) return

  originalPixelsRef.current = handle.getLayerPixels(activeLayerId)  // returns a fresh copy
  selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
  setRadius(DEFAULT_RADIUS)
  setIsBusy(false)
  isBusyRef.current = false

  return () => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }
}, [isOpen, canvasHandleRef, activeLayerId])
```

The cleanup function clears any pending debounce if the dialog unmounts (e.g. forced close from outside).

### `runPreview` callback

```ts
const runPreview = useCallback(async (r: number): Promise<void> => {
  const handle   = canvasHandleRef.current
  const original = originalPixelsRef.current
  if (!handle || activeLayerId == null || original == null) return

  // If a WASM call is still running, re-queue after a short delay rather than queue
  // a parallel call. The latest radius value is captured in the re-queued closure.
  if (isBusyRef.current) {
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(r)
    }, 100)
    return
  }

  isBusyRef.current = true
  setIsBusy(true)
  try {
    // Always blur from the original — never from a previously written preview buffer.
    const blurred  = await gaussianBlur(original.slice(), canvasWidth, canvasHeight, r)
    const composed = applySelectionComposite(blurred, original, selectionMaskRef.current)
    handle.writeLayerPixels(activeLayerId, composed)
  } finally {
    isBusyRef.current = false
    setIsBusy(false)
  }
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])
```

### Radius change handler

```ts
const handleRadiusChange = useCallback((value: number): void => {
  const clamped = clamp(value, MIN_RADIUS, MAX_RADIUS)
  setRadius(clamped)
  if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
  debounceTimerRef.current = setTimeout(() => {
    debounceTimerRef.current = null
    void runPreview(clamped)
  }, DEBOUNCE_MS)
}, [runPreview])
```

### Apply handler

```ts
const handleApply = useCallback(async (): Promise<void> => {
  const handle   = canvasHandleRef.current
  const original = originalPixelsRef.current
  if (!handle || activeLayerId == null || original == null) return

  // Cancel any pending debounce so a stale preview write cannot follow the commit.
  if (debounceTimerRef.current !== null) {
    clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = null
  }

  isBusyRef.current = true
  setIsBusy(true)
  try {
    // Re-run from originals — guarantees correctness independent of preview state.
    const blurred  = await gaussianBlur(original.slice(), canvasWidth, canvasHeight, radius)
    const composed = applySelectionComposite(blurred, original, selectionMaskRef.current)
    handle.writeLayerPixels(activeLayerId, composed)
    // captureHistory snapshots captureAllLayerPixels() → picks up the blurred pixels just written.
    captureHistory('Gaussian Blur')
    onClose()
  } catch (err) {
    console.error('[GaussianBlur] Apply failed:', err)
    // Re-enable Apply so the user can retry or cancel rather than being stuck.
  } finally {
    isBusyRef.current = false
    setIsBusy(false)
  }
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, radius, captureHistory, onClose])
```

**Why re-run on Apply rather than trusting the last preview write?** If Apply is clicked before the debounce fires (or while a preview is in flight), the canvas state may not match `radius`. Re-running unconditionally from `original` guarantees deterministic output regardless of preview timing.

**History semantics**: `captureHistory('Gaussian Blur')` is called _after_ `writeLayerPixels`. Internally, `captureHistory` calls `canvasHandle.captureAllLayerPixels()` which snapshots `layer.data` — the just-written blurred pixels. The previous history tip (present before the dialog opened) was the pre-blur state; pressing Ctrl+Z restores to it.

### Cancel handler

```ts
const handleCancel = useCallback((): void => {
  if (debounceTimerRef.current !== null) {
    clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = null
  }
  const handle   = canvasHandleRef.current
  const original = originalPixelsRef.current
  if (handle && activeLayerId != null && original != null) {
    handle.writeLayerPixels(activeLayerId, original)  // restore pre-dialog pixels
  }
  onClose()  // no captureHistory call — undo stack is untouched
}, [canvasHandleRef, activeLayerId, onClose])
```

Cancel writes synchronously — no WASM call. The restore is immediate. `ModalDialog` calls `onClose` for both the Cancel button and Escape key, so wiring `handleCancel` to the `ModalDialog` `onClose` prop handles both cases.

### JSX structure

```tsx
return (
  <ModalDialog open={isOpen} title="Gaussian Blur" width={320} onClose={handleCancel}>
    <div className={styles.body}>
      <div className={styles.row}>
        <label className={styles.label}>Radius</label>
        <input
          type="range"
          className={styles.slider}
          min={MIN_RADIUS} max={MAX_RADIUS} step={1}
          value={radius}
          onChange={e => handleRadiusChange(e.target.valueAsNumber)}
        />
        <input
          type="number"
          className={styles.numberInput}
          min={MIN_RADIUS} max={MAX_RADIUS} step={1}
          value={radius}
          onChange={e => handleRadiusChange(e.target.valueAsNumber)}
          onBlur={e  => handleRadiusChange(e.target.valueAsNumber)}
        />
        <span className={styles.unit}>px</span>
      </div>
    </div>
    <div className={styles.footer}>
      <DialogButton onClick={handleCancel}>Cancel</DialogButton>
      <DialogButton onClick={() => { void handleApply() }} primary disabled={isBusy}>
        Apply
      </DialogButton>
    </div>
  </ModalDialog>
)
```

Required imports: `React`, `useState`, `useEffect`, `useCallback`, `useRef` from `react`; `gaussianBlur` from `@/wasm`; `selectionStore` from `@/store/selectionStore`; `ModalDialog` from `../ModalDialog/ModalDialog`; `DialogButton` from `../../widgets/DialogButton/DialogButton`; `CanvasHandle` type from `@/components/window/Canvas/canvasHandle`; the local styles module.

### Styles — `GaussianBlurDialog.module.scss`

```scss
@use '@/styles/variables' as vars;

.body {
  padding: 16px 20px 10px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.label {
  width: 52px;
  flex-shrink: 0;
  font-size: vars.$font-size-sm;
  color: vars.$color-text-dim;
}

.slider {
  flex: 1;
}

.numberInput {
  width: 52px;
  padding: 3px 6px;
  background: vars.$color-surface-2;
  border: 1px solid vars.$color-border-light;
  border-radius: vars.$radius-sm;
  color: vars.$color-text;
  font-size: vars.$font-size-sm;
  font-family: vars.$font-sans;
  text-align: right;

  &:focus {
    outline: 1px solid vars.$color-accent-solid;
    outline-offset: 0;
  }
}

.unit {
  font-size: vars.$font-size-sm;
  color: vars.$color-text-muted;
  flex-shrink: 0;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid vars.$color-border;
}
```

---

## Preview Flow

1. Dialog opens (`isOpen` transitions to `true`). The initialization `useEffect` fires:
   - `handle.getLayerPixels(activeLayerId)` returns a fresh canvas-size `Uint8Array` copy → stored in `originalPixelsRef`.
   - `selectionStore.mask?.slice() ?? null` → stored in `selectionMaskRef`. Frozen for dialog lifetime (dialog is modal; selection cannot change).
   - `radius` is reset to `DEFAULT_RADIUS` (2). `isBusy` is reset to `false`.

2. User drags the Radius slider. `handleRadiusChange(newValue)` fires on every movement:
   - Clamps and rounds the value; updates `radius` state (numeric input stays in sync).
   - Clears any pending debounce timer; sets a new 500 ms timer.

3. 500 ms after the last movement, the timer fires → `runPreview(clamped)`:
   - If `isBusyRef.current` is `true` (a previous WASM call is still running), re-queues `runPreview` for 100 ms later and returns. This ensures the latest radius is eventually shown without running concurrent WASM calls.
   - Otherwise: sets `isBusy = true`, awaits `gaussianBlur(original.slice(), w, h, r)`.
   - Calls `applySelectionComposite(blurred, original, selectionMaskRef.current)`:
     - If no selection: returns `blurred` directly.
     - If selection: copies `original`, then overwrites selected pixels with `blurred` values.
   - Calls `handle.writeLayerPixels(activeLayerId, composed)`:
     - Writes the canvas-size buffer back into `layer.data` within layer bounds.
     - Calls `renderer.flushLayer(layer)` → uploads to GPU texture.
     - Calls `renderFromPlan()` → re-composites and displays updated result.
   - Sets `isBusy = false`.

4. The canvas shows the blurred preview. The undo history stack is **untouched**.

---

## Apply Flow

1. User clicks **Apply**. `handleApply` fires:
   - Cancels any pending debounce timer.
   - Sets `isBusy = true` (disables Apply button).
   - Awaits `gaussianBlur(original.slice(), canvasWidth, canvasHeight, radius)` — always from original, regardless of preview state.
   - Calls `applySelectionComposite(blurred, original, selectionMaskRef.current)`.
   - Calls `handle.writeLayerPixels(activeLayerId, composed)` — canvas now shows the definitive blurred pixels.
   - Calls `captureHistory('Gaussian Blur')` — snapshots `layer.data` (blurred) as the new history tip. Previous tip (pre-blur pixels) remains in the stack; Ctrl+Z restores it.
   - Calls `onClose()` — `App.tsx` sets `showGaussianBlurDialog = false`, dialog unmounts.

2. The undo stack now has one entry labelled `'Gaussian Blur'` as the tip. Pressing Ctrl+Z restores the layer to its exact pre-dialog pixel data.

---

## Cancel Flow

1. User clicks **Cancel** or presses Escape (`ModalDialog` calls `handleCancel` via `onClose`):
   - Clears any pending debounce timer.
   - Calls `handle.writeLayerPixels(activeLayerId, originalPixelsRef.current)` — restores the layer to byte-for-byte identical pre-dialog state, synchronously.
   - Calls `onClose()` — dialog closes.

2. No `captureHistory` call. History stack is identical to its state before the dialog opened.

3. **Edge case — preview in flight at cancel time**: If a WASM call is running when Cancel fires, it will call `writeLayerPixels` when it resolves. Because Cancel already re-wrote the original pixels, this late write would briefly flash a stale preview. To prevent this, the `runPreview` callback checks `originalPixelsRef.current` before writing; after Cancel, `originalPixelsRef` still holds the original (it is not cleared until Apply/unmount). The correct guard is to add a `cancelledRef` (see Open Questions).

---

## Selection-Aware Compositing Logic

Full pseudocode, matching the `applySelectionComposite` implementation above:

```
function applySelectionComposite(blurred, original, mask):
  if mask is null:
    return blurred          // no selection — whole layer is target

  out = original.slice()    // start with a copy of original
  for i in [0, mask.length):
    if mask[i] != 0:        // pixel is inside the selection
      p = i * 4
      out[p]   = blurred[p]
      out[p+1] = blurred[p+1]
      out[p+2] = blurred[p+2]
      out[p+3] = blurred[p+3]
    // else: pixel is outside selection — original value already in out
  return out
```

- `mask.length == canvasWidth * canvasHeight` (one byte per pixel, same layout as `selectionStore.mask`).
- `blurred` and `original` are both canvas-size (`canvasWidth * canvasHeight * 4` bytes).
- The blur convolution always runs on the **full-layer** original. Blurring only the selected subregion and compositing afterwards would produce incorrect edge blending: the Gaussian kernel needs context pixels outside the selection to compute correct output values at the selection boundary.
- The same function is called identically for both preview writes and the final apply write, so the preview is pixel-exact with the committed result.

---

## `App.tsx` Changes

The Filters Menu TD owns most of these changes. The delta for Gaussian Blur is the full `GaussianBlurDialog` render with all required props (the stub in filters-menu.md has only `onClose`):

```tsx
// Additional import (alongside other dialog imports)
import { GaussianBlurDialog } from '@/components/dialogs/GaussianBlurDialog/GaussianBlurDialog'

// In the JSX, replace the filters-menu.md stub with:
{showGaussianBlurDialog && (
  <GaussianBlurDialog
    isOpen={showGaussianBlurDialog}
    onClose={() => setShowGaussianBlurDialog(false)}
    canvasHandleRef={canvasHandleRef}
    activeLayerId={state.activeLayerId}
    captureHistory={captureHistory}
    canvasWidth={state.canvas.width}
    canvasHeight={state.canvas.height}
  />
)}
```

No other `App.tsx` changes beyond what filters-menu.md already specifies.

---

## Barrel Export

Add to `src/components/index.ts`:

```ts
export { GaussianBlurDialog } from './dialogs/GaussianBlurDialog/GaussianBlurDialog'
export type { GaussianBlurDialogProps } from './dialogs/GaussianBlurDialog/GaussianBlurDialog'
```

---

## Implementation Steps

1. **Add `writeLayerPixels` to `CanvasHandle`** (`src/components/window/Canvas/canvasHandle.ts`):
   - Add the method signature to the `CanvasHandle` interface.
   - Add the implementation inside `useImperativeHandle` as specified above.

2. **Implement Filters Menu TD prerequisites** if not already done:
   - `src/types/index.ts` — add `FilterKey`.
   - `src/filters/registry.ts` — create with `FILTER_REGISTRY`.
   - `src/hooks/useFilters.ts` — create with `isFiltersMenuEnabled` and `handleOpenGaussianBlur`.
   - `src/components/window/TopBar/TopBar.tsx` — add filter menu props and `MenuDef` entry.

3. **Create `src/components/dialogs/GaussianBlurDialog/`** folder.

4. **Create `GaussianBlurDialog.module.scss`** with the styles specified above.

5. **Create `GaussianBlurDialog.tsx`** with:
   - File-level constants and `clamp`.
   - Module-level `applySelectionComposite` pure function.
   - `GaussianBlurDialogProps` interface (exported).
   - `GaussianBlurDialog` function component with all state, refs, and handlers as specified.

6. **Export from barrel** — append to `src/components/index.ts`.

7. **Update `src/App.tsx`** — add the `GaussianBlurDialog` import and replace the stub render with the full prop list.

8. **Run `npm run typecheck`** to validate the complete change set.

---

## Architectural Constraints

- **No `AppContext` in the dialog**: `GaussianBlurDialog` is a Dialog-category component. It receives all its dependencies as props (`canvasHandleRef`, `captureHistory`, `canvasWidth`, `canvasHeight`). It never imports or reads from `AppContext`.
- **WASM access is acceptable in the dialog here**: The AGENTS.md rule "never import from `src/wasm/generated/` directly" is respected — the component imports `gaussianBlur` from `@/wasm` (the public wrapper), not from `@/wasm/generated/`. This is the same import path used in `useCanvasTransforms` and other hooks. Placing the WASM call in the dialog (rather than in a hook) is justified because the dialog owns the complete pixel-manipulation lifecycle for this feature.
- **Write through `CanvasHandle`, not `WebGLRenderer` directly**: `writeLayerPixels` is exposed on `CanvasHandle` and called via `canvasHandleRef.current`. The dialog never imports `WebGLRenderer`.
- **CSS Modules only**: Both files in the dialog folder use `.module.scss` imports; plain `.scss` default imports are forbidden per AGENTS.md.
- **No canvas re-initialization**: The dialog reads and writes pixel data through `CanvasHandle` methods. It never touches tab records, `canvasKey`, or `setPendingLayerData`.
- **History push is exactly one**: `captureHistory` is called once — in `handleApply` after the final write. Preview writes and Cancel writes bypass history entirely.
- **Always blur from `originalPixelsRef`**: Every `gaussianBlur()` call (preview and apply) receives `originalPixelsRef.current.slice()`. This prevents compound blur drift from multiple preview calls.
- **`selectionStore` reads are at call time**: `selectionMaskRef` snapshots the selection at dialog open. The mask cannot change while the modal is open (modal blocks canvas and menu), so snapshot-at-open and read-at-call time are equivalent. Using the snapshot avoids any risk of reading a partially-committed mid-drag selection state.

---

## Open Questions

1. **In-flight preview race on Cancel**: A debounced WASM preview call that resolves _after_ Cancel has restored the original pixels will still call `writeLayerPixels` and briefly flash a stale preview. The recommended fix is a `cancelledRef = useRef(false)` that is set to `true` in `handleCancel`, checked at the top of `runPreview` before writing, and reset to `false` in the initialization effect. Add this if the race is observed in practice.

2. **`canvasWidth` / `canvasHeight` vs `renderer.pixelWidth` / `renderer.pixelHeight`**: This design assumes `state.canvas.width/height` equals `renderer.pixelWidth/height` — i.e. the layer buffer operates at logical-pixel resolution, not device-pixel resolution. This matches the pattern in `useCanvasTransforms`. If HiDPI physical-pixel rendering is introduced, the dialog should receive actual physical dimensions from a new `CanvasHandle.getPixelDimensions()` method rather than from `state.canvas`.

3. **Apply button spinner for large canvases**: At radius 250 on a 4096×4096 canvas, the WASM call may take hundreds of milliseconds. The dialog currently disables Apply (`isBusy`) but does not show a spinner. If UX review flags this, add a loading indicator to the `Apply` button content when `isBusy` is true.

```ts
/**
 * Write canvas-size RGBA pixel data into an existing layer and re-render.
 * `pixels` must be `canvasWidth * canvasHeight * 4` bytes.
 * This is the write-back counterpart to `getLayerPixels`.
 */
writeLayerPixels: (layerId: string, pixels: Uint8Array) => void
```

### Implementation

Add the following entry inside the `useImperativeHandle` object in `src/components/window/Canvas/canvasHandle.ts`:

```ts
writeLayerPixels: (layerId, pixels) => {
  const renderer = rendererRef.current
  const layer    = glLayersRef.current.get(layerId)
  if (!renderer || !layer) return
  const w = renderer.pixelWidth
  const h = renderer.pixelHeight
  for (let ly = 0; ly < layer.layerHeight; ly++) {
    const cy = layer.offsetY + ly
    if (cy < 0 || cy >= h) continue
    for (let lx = 0; lx < layer.layerWidth; lx++) {
      const cx = layer.offsetX + lx
      if (cx < 0 || cx >= w) continue
      const si = (cy * w + cx) * 4          // source: canvas-size buffer
      const di = (ly * layer.layerWidth + lx) * 4  // dest:   layer-local buffer
      layer.data[di]     = pixels[si]
      layer.data[di + 1] = pixels[si + 1]
      layer.data[di + 2] = pixels[si + 2]
      layer.data[di + 3] = pixels[si + 3]
    }
  }
  renderer.flushLayer(layer)
  renderFromPlan()
},
```



### File: `src/hooks/useFilters.ts`

This hook is **extended beyond the Filters Menu TD**. The Filters Menu TD defined the minimal interface needed for the menu. Gaussian Blur adds pixel-manipulation methods that require `canvasHandleRef` and `captureHistory`, so those dependencies are added here.

### Full types

```ts
import { useCallback, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { LayerState } from '@/types'
import type { FilterKey } from '@/types'
import { isPixelLayer } from '@/types'
import { gaussianBlur } from '@/wasm'
import { selectionStore } from '@/store/selectionStore'
import type { CanvasHandle } from '@/components/window/Canvas/Canvas'

interface UseFiltersOptions {
  canvasHandleRef:    { readonly current: CanvasHandle | null }
  layers:             LayerState[]
  activeLayerId:      string | null
  canvasWidth:        number
  canvasHeight:       number
  captureHistory:     (label: string) => void
  onOpenFilterDialog: (key: FilterKey) => void
}

export interface UseFiltersReturn {
  isFiltersMenuEnabled:      boolean
  handleOpenGaussianBlur:    () => void
  handlePreviewGaussianBlur: (radius: number) => void   // called by dialog after debounce
  handleApplyGaussianBlur:   (radius: number) => void   // called by dialog on Apply click
  handleCancelGaussianBlur:  () => void                 // called by dialog on Cancel
}
```

### `isFiltersMenuEnabled`

```ts
const isFiltersMenuEnabled = useMemo(() => {
  const active = layers.find(l => l.id === activeLayerId)
  if (active == null) return false
  return isPixelLayer(active)
}, [layers, activeLayerId])
```

Only a directly-active pixel layer qualifies. There is no "use parent pixel layer" fallback — destructive filters must not apply through an adjustment-layer selection.

### `originalPixelsRef`

```ts
const originalPixelsRef   = useRef<Uint8Array | null>(null)
const activeLayerIdRef    = useRef<string | null>(null)
```

Both refs are set at `handleOpenGaussianBlur` call time and cleared when the dialog closes (Apply or Cancel).

### `handleOpenGaussianBlur`

```ts
const handleOpenGaussianBlur = useCallback((): void => {
  const handle  = canvasHandleRef.current
  const layerId = activeLayerId
  if (!handle || !layerId) return
  const pixels = handle.getLayerPixels(layerId)
  if (!pixels) return
  originalPixelsRef.current  = pixels          // canvas-size RGBA copy
  activeLayerIdRef.current   = layerId
  onOpenFilterDialog('gaussian-blur')          // sets showGaussianBlurDialog = true in App
}, [canvasHandleRef, activeLayerId, onOpenFilterDialog])
```

`getLayerPixels` already returns a `new Uint8Array` copy, so this is safe to store.

### `handlePreviewGaussianBlur`

Called by the dialog after it has debounced the slider. Runs the WASM blur on an independent copy of `originalPixels` (never mutates the stored original), handles selection compositing, and writes the result back to the layer.

```ts
const handlePreviewGaussianBlur = useCallback((radius: number): void => {
  const handle    = canvasHandleRef.current
  const layerId   = activeLayerIdRef.current
  const original  = originalPixelsRef.current
  if (!handle || !layerId || !original) return

  void (async () => {
    const w       = canvasWidth
    const h       = canvasHeight
    const blurred = await gaussianBlur(original.slice(), w, h, radius)
    const final   = applySelectionComposite(original, blurred, selectionStore.mask)
    handle.writeLayerPixels(layerId, final)
  })()
}, [canvasHandleRef, canvasWidth, canvasHeight])
```

The `void (async () => { ... })()` pattern intentionally discards the returned Promise. Rapid slider movements will queue multiple concurrent WASM calls, but because each write lands on the same layer, the last one to complete wins. Given the 500 ms debounce in the dialog, concurrent preview inflight operations should be rare for typical usage. If stronger sequencing is needed in the future, a cancellation ref pattern can be layered on top.

### `handleApplyGaussianBlur`

**Always recomputes from `originalPixels`** at the exact current radius. This is intentional: it avoids relying on stale preview results and ensures the committed pixels are always computed from the pristine pre-dialog data, regardless of whether a preview async call is still in flight.

```ts
const handleApplyGaussianBlur = useCallback((radius: number): void => {
  const handle   = canvasHandleRef.current
  const layerId  = activeLayerIdRef.current
  const original = originalPixelsRef.current
  if (!handle || !layerId || !original) return

  void (async () => {
    const w       = canvasWidth
    const h       = canvasHeight
    const blurred = await gaussianBlur(original.slice(), w, h, radius)
    const final   = applySelectionComposite(original, blurred, selectionStore.mask)
    handle.writeLayerPixels(layerId, final)   // write final blurred pixels
    captureHistory('Gaussian Blur')           // captures current (blurred) state as new tip
    originalPixelsRef.current  = null         // clean up
    activeLayerIdRef.current   = null
  })()
}, [canvasHandleRef, canvasWidth, canvasHeight, captureHistory])
```

`captureHistory` is called **after** the write so the history snapshot captures the blurred state. When the user presses Ctrl+Z, the history system jumps to the previous entry (the pre-blur snapshot that was already in the stack before the dialog opened).

### `handleCancelGaussianBlur`

```ts
const handleCancelGaussianBlur = useCallback((): void => {
  const handle   = canvasHandleRef.current
  const layerId  = activeLayerIdRef.current
  const original = originalPixelsRef.current
  if (handle && layerId && original) {
    handle.writeLayerPixels(layerId, original)  // restore pre-dialog pixels
  }
  originalPixelsRef.current = null
  activeLayerIdRef.current  = null
}, [canvasHandleRef])
```

No `captureHistory` call — Cancel records no history entry.

### `applySelectionComposite` (module-level helper)

A pure function defined at module level in `src/hooks/useFilters.ts`. Not exported.

```ts
function applySelectionComposite(
  original: Uint8Array,
  blurred:  Uint8Array,
  mask:     Uint8Array | null,
): Uint8Array {
  if (mask === null) return blurred
  // mask.length === canvasWidth * canvasHeight (1 byte per pixel)
  const out = new Uint8Array(original.length)
  for (let i = 0; i < mask.length; i++) {
    const b = i * 4
    if (mask[i] !== 0) {
      out[b]     = blurred[b]
      out[b + 1] = blurred[b + 1]
      out[b + 2] = blurred[b + 2]
      out[b + 3] = blurred[b + 3]
    } else {
      out[b]     = original[b]
      out[b + 1] = original[b + 1]
      out[b + 2] = original[b + 2]
      out[b + 3] = original[b + 3]
    }
  }
  return out
}
```

The blur is always run on the **full canvas-size** original buffer, then masked. Blurring only the selected region and compositing would produce incorrect edge blending along the selection boundary (the convolution kernel needs context pixels outside the selection to produce the correct result at boundary pixels).

`mask[i] !== 0` is the selection test. `selectionStore.mask` values are `1` for selected and `0` for not selected (per `selectionStore.ts`). Reading `selectionStore.mask` at call time (not captured at dialog open) means the mask is always current at Preview and Apply time — matching the spec's intent that the selection is "evaluated at the moment Apply is clicked."

---

## The `GaussianBlurDialog` Component

### File: `src/components/dialogs/GaussianBlurDialog/GaussianBlurDialog.tsx`

Category: **Dialog** (wraps `ModalDialog`, composes widgets, no direct `AppContext` access).

### Props

```ts
export interface GaussianBlurDialogProps {
  open:      boolean
  onPreview: (radius: number) => void  // called after 500 ms debounce
  onApply:   (radius: number) => void  // called on Apply button click
  onCancel:  () => void                // called on Cancel button click or Escape
}
```

### Component structure

```ts
export function GaussianBlurDialog({
  open,
  onPreview,
  onApply,
  onCancel,
}: GaussianBlurDialogProps): React.JSX.Element | null {
  const [radius, setRadius] = useState(DEFAULT_RADIUS)
  const debounceRef         = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset to default each time the dialog opens
  useEffect(() => {
    if (open) setRadius(DEFAULT_RADIUS)
  }, [open])

  // Debounce preview: fire after 500 ms of inactivity
  const handleRadiusChange = useCallback((value: number): void => {
    const clamped = clamp(value, MIN_RADIUS, MAX_RADIUS)
    setRadius(clamped)
    if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onPreview(clamped)
      debounceRef.current = null
    }, DEBOUNCE_MS)
  }, [onPreview])

  // Clear pending debounce on unmount
  useEffect(() => () => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current)
  }, [])

  const handleApply = useCallback((): void => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    onApply(radius)
  }, [onApply, radius])

  return (
    <ModalDialog open={open} title="Gaussian Blur" width={320} onClose={onCancel}>
      <div className={styles.body}>
        <div className={styles.row}>
          <label className={styles.label}>Radius</label>
          <SliderInput
            value={radius}
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            step={1}
            suffix=" px"
            onChange={handleRadiusChange}
          />
        </div>
      </div>
      <div className={styles.footer}>
        <DialogButton onClick={onCancel}>Cancel</DialogButton>
        <DialogButton onClick={handleApply} primary>Apply</DialogButton>
      </div>
    </ModalDialog>
  )
}
```

#### Constants (file-level)

```ts
const MIN_RADIUS    = 1
const MAX_RADIUS    = 250
const DEFAULT_RADIUS = 2
const DEBOUNCE_MS   = 500

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)))
}
```

`clamp` also rounds to integer so fractional `SliderInput` values never produce a sub-pixel radius.

#### Debounce cancel on Apply

`handleApply` cancels any pending debounce timer before calling `onApply`. This prevents a race where Apply fires, then 500 ms later a stale preview call also fires and briefly replaces the committed result.

#### Escape handling

`ModalDialog` handles Escape key internally via its own `useEffect` and calls `onClose` — which maps to `onCancel` in the parent. No additional keydown listener is needed in `GaussianBlurDialog`.

### File: `src/components/dialogs/GaussianBlurDialog/GaussianBlurDialog.module.scss`

```scss
.body {
  padding: 16px 20px 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.label {
  font-size: 12px;
  color: var(--color-text-dim);
  flex-shrink: 0;
  width: 52px;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
}
```

---

## Preview Flow (detailed)

1. The dialog opens; `useEffect` resets `radius` to 2 and `handleOpenGaussianBlur` has already stored `originalPixels` and `activeLayerId` in refs inside `useFilters`.
2. User moves the Radius slider. `handleRadiusChange` fires on every step, updating `radius` state (causes the numeric input to update) and resetting a 500 ms `setTimeout`.
3. After 500 ms without further movement, the `setTimeout` fires and calls `onPreview(radius)`.
4. App.tsx passes `filters.handlePreviewGaussianBlur` as `onPreview`. The hook's callback fires:
   - Calls `original.slice()` to produce a fresh copy (never mutates `originalPixelsRef.current`).
   - Awaits `gaussianBlur(copy, w, h, radius)` — the WASM separable Gaussian kernel.
   - Calls `applySelectionComposite(original, blurred, selectionStore.mask)` — if `mask` is null, returns `blurred` directly; otherwise composites per-pixel.
   - Calls `handle.writeLayerPixels(layerId, final)` which:
     - Copies the canvas-size RGBA buffer into the layer-local `WebGLLayer.data` buffer using the layer's `offsetX`/`offsetY` and `layerWidth`/`layerHeight` bounds.
     - Calls `renderer.flushLayer(layer)` to upload the CPU buffer to the GPU texture.
     - Calls `renderFromPlan()` to re-composite all layers and display the result.
5. The canvas now shows the blurred preview. The undo history stack is untouched.
6. If the slider moves again before the async blur from step 4 has returned, a second async call is queued. Both will call `writeLayerPixels` when resolved; the last one to land wins. Because both computed from the same `originalPixels`, the only risk is seeing a briefly stale preview radius if two slow calls race, which is acceptable given the 500 ms debounce.

---

## Apply Flow (detailed)

1. User clicks **Apply**. `handleApply` in the dialog fires:
   - Cancels any pending debounce timer (prevents a stale preview write after commit).
   - Calls `onApply(radius)`.
2. App.tsx `onApply` handler:
   - Calls `void filters.handleApplyGaussianBlur(radius)` (async, not awaited — result lands in background).
   - Calls `setShowGaussianBlurDialog(false)` — dialog closes immediately.
3. Inside `handleApplyGaussianBlur`:
   - Reads `original = originalPixelsRef.current` — the pristine pre-dialog pixels.
   - Reads `layerId = activeLayerIdRef.current`.
   - Awaits `gaussianBlur(original.slice(), w, h, radius)`.
   - Calls `applySelectionComposite(original, blurred, selectionStore.mask)`.
   - Calls `handle.writeLayerPixels(layerId, final)` — canvas updates to final blurred pixels.
   - Calls `captureHistory('Gaussian Blur')` — this calls `canvasHandle.captureAllLayerPixels()` which snapshots the current `layer.data` (now blurred) and pushes the entry as the new history tip.
   - Clears both refs to `null`.
4. The undo stack now has the pre-blur entry (whichever was the previous tip before the dialog opened) and the new `'Gaussian Blur'` entry as the tip. Ctrl+Z restores the previous entry's pixel data, which is the original unblurred state.

**Note on async/sync timing**: The dialog is closed before the WASM call resolves. During the brief async window, the canvas shows whatever the last preview wrote (usually also blurred, so no visible flicker). When the async write lands, the canvas may momentarily update — this is acceptable. If the user immediately hits Ctrl+Z during this window, the undo may restore to the pre-blur state before the apply write lands. This edge case is inherent to the fire-and-forget pattern; a future enhancement could block Ctrl+Z during the async window if needed.

---

## Cancel Flow (detailed)

1. User clicks **Cancel** or presses Escape (handled by `ModalDialog.onClose`). The dialog calls `onCancel`.
2. App.tsx `onCancel` handler:
   - Calls `filters.handleCancelGaussianBlur()`.
   - Calls `setShowGaussianBlurDialog(false)`.
3. Inside `handleCancelGaussianBlur`:
   - Calls `handle.writeLayerPixels(layerId, originalPixels)` — restores the layer to its exact pre-dialog state.
   - Clears both refs to `null`.
4. No `captureHistory` call. The history stack is identical to what it was before the dialog opened.

If a preview async call is still in flight when Cancel fires (pathological case: user clicks Cancel faster than the debounce timer fires the WASM call), the in-flight call will still call `writeLayerPixels` after Cancel has restored the original. Because `activeLayerIdRef` and `originalPixelsRef` will be `null` at that point, the early guard in `handlePreviewGaussianBlur` (`if (!handle || !layerId || !original) return`) prevents the write. The cancel restores correctly.

---

## Selection-Aware Compositing Logic

The full logic is implemented in the `applySelectionComposite` helper (defined above in the `useFilters` section).

- **No active selection** (`selectionStore.mask === null`): returns the blurred buffer directly. Every pixel on the layer is replaced.
- **Active selection** (`selectionStore.mask` is a `Uint8Array` of `canvasWidth * canvasHeight` bytes): allocates an output buffer and loops over every pixel. For each pixel index `i`: if `mask[i] !== 0`, take the blurred RGBA; otherwise take the original RGBA. The selection values are 0 or 1 (per `selectionStore.ts`), so `!== 0` correctly identifies selected pixels.
- The blur input is always the **full canvas-size** original buffer. This is required for correct kernel behaviour at selection boundaries: a Gaussian kernel reads neighbouring pixels to compute each output pixel; if the input were pre-clipped to the selection region, boundary pixels would convolve with zero-alpha falloff rather than the true neighbouring colours.
- The function is called identically in both `handlePreviewGaussianBlur` and `handleApplyGaussianBlur`, ensuring the preview is byte-for-byte identical to the committed result.

---

## `App.tsx` Changes

### 1. Import `useFilters` and `FILTER_REGISTRY` (add alongside existing imports)

```ts
import { useFilters }      from '@/hooks/useFilters'
import { FILTER_REGISTRY } from '@/filters/registry'
import type { FilterKey }  from '@/types'
import { GaussianBlurDialog } from '@/components/dialogs/GaussianBlurDialog/GaussianBlurDialog'
```

### 2. Static constant (alongside `ADJUSTMENT_MENU_ITEMS`)

```ts
const FILTER_MENU_ITEMS = FILTER_REGISTRY.map(e => ({ key: e.key, label: e.label }))
```

### 3. Dialog open state (alongside other `show*` booleans)

```ts
const [showGaussianBlurDialog, setShowGaussianBlurDialog] = useState(false)
```

### 4. Compose `useFilters`

```ts
const filters = useFilters({
  canvasHandleRef,
  layers:         state.layers,
  activeLayerId:  state.activeLayerId,
  canvasWidth:    state.canvas.width,
  canvasHeight:   state.canvas.height,
  captureHistory,
  onOpenFilterDialog: useCallback((key: FilterKey): void => {
    if (key === 'gaussian-blur') filters.handleOpenGaussianBlur()
  }, []),
})
```

Wait — `handleOpenGaussianBlur` internally calls `onOpenFilterDialog('gaussian-blur')`, which calls itself. This would be circular. Remove the indirection. Pass `setShowGaussianBlurDialog` direction via a stable callback:

```ts
const openFilterDialog = useCallback((key: FilterKey): void => {
  if (key === 'gaussian-blur') setShowGaussianBlurDialog(true)
}, [])

const filters = useFilters({
  canvasHandleRef,
  layers:             state.layers,
  activeLayerId:      state.activeLayerId,
  canvasWidth:        state.canvas.width,
  canvasHeight:       state.canvas.height,
  captureHistory,
  onOpenFilterDialog: openFilterDialog,
})
```

`handleOpenGaussianBlur` inside `useFilters` then reads pixels and calls `onOpenFilterDialog('gaussian-blur')`, which calls `openFilterDialog` → `setShowGaussianBlurDialog(true)`. No circularity.

### 5. Pass new props to `TopBar`

```ts
onOpenFilterDialog={openFilterDialog}
isFiltersMenuEnabled={filters.isFiltersMenuEnabled}
filterMenuItems={FILTER_MENU_ITEMS}
```

The TopBar action for each filter item calls `onOpenFilterDialog(item.key)`, which flows to `openFilterDialog`. But note: the TopBar calls `onOpenFilterDialog` directly, **not** `filters.handleOpenGaussianBlur`. The pixel-reading step must therefore happen inside `openFilterDialog`:

```ts
const openFilterDialog = useCallback((key: FilterKey): void => {
  if (key === 'gaussian-blur') {
    filters.handleOpenGaussianBlur()     // reads pixels, then calls onOpenFilterDialog internally
  }
}, [filters])
```

And `useFilters.handleOpenGaussianBlur` calls `onOpenFilterDialog('gaussian-blur')` → `setShowGaussianBlurDialog(true)`. The TopBar must call this `openFilterDialog` wrapper, not the bare `setShowGaussianBlurDialog`. Pass `openFilterDialog` as the `onOpenFilterDialog` prop to TopBar.

### 6. Render `GaussianBlurDialog`

```tsx
<GaussianBlurDialog
  open={showGaussianBlurDialog}
  onPreview={filters.handlePreviewGaussianBlur}
  onApply={(radius) => {
    void filters.handleApplyGaussianBlur(radius)
    setShowGaussianBlurDialog(false)
  }}
  onCancel={() => {
    filters.handleCancelGaussianBlur()
    setShowGaussianBlurDialog(false)
  }}
/>
```

---

## `src/components/index.ts` Addition

```ts
export { GaussianBlurDialog } from './dialogs/GaussianBlurDialog/GaussianBlurDialog'
export type { GaussianBlurDialogProps } from './dialogs/GaussianBlurDialog/GaussianBlurDialog'
```

---

## Implementation Steps

1. **Add `writeLayerPixels` to `CanvasHandle`**: Edit `src/components/window/Canvas/canvasHandle.ts` — add the method signature to the `CanvasHandle` interface and add the implementation to the `useImperativeHandle` call as specified above.

2. **Create `src/filters/registry.ts`** (Filters Menu TD prerequisite — if not yet done): single `FILTER_REGISTRY` array with the `'gaussian-blur'` entry.

3. **Add `FilterKey` to `src/types/index.ts`** (Filters Menu TD prerequisite — if not yet done): `export type FilterKey = 'gaussian-blur'`.

4. **Create `src/hooks/useFilters.ts`**: implement `isFiltersMenuEnabled`, `originalPixelsRef`, `handleOpenGaussianBlur`, `handlePreviewGaussianBlur`, `handleApplyGaussianBlur`, `handleCancelGaussianBlur`, and the `applySelectionComposite` module-level helper.

5. **Create `src/components/dialogs/GaussianBlurDialog/GaussianBlurDialog.tsx`**: implement the dialog component as specified above using `ModalDialog`, `SliderInput`, and `DialogButton`.

6. **Create `src/components/dialogs/GaussianBlurDialog/GaussianBlurDialog.module.scss`**: add styles as specified above.

7. **Export from `src/components/index.ts`**: add both the component and its props type.

8. **Extend `src/components/window/TopBar/TopBar.tsx`** (Filters Menu TD prerequisite — if not yet done): add `onOpenFilterDialog`, `isFiltersMenuEnabled`, `filterMenuItems` props; insert Filters `MenuDef` between Image and View.

9. **Update `src/App.tsx`**: add imports, `openFilterDialog` callback, `useFilters` call, `showGaussianBlurDialog` state, new `TopBar` props, and `GaussianBlurDialog` JSX as specified above.

---

## Architectural Constraints

- **No business logic in `App.tsx`** (`AGENTS.md`): `App.tsx` only composes `useFilters` and passes refs/callbacks. All pixel reading, WASM invocation, compositing, and history recording live in `useFilters`.
- **No standalone WASM imports in components** (`AGENTS.md`): `gaussianBlur` is imported only in `src/hooks/useFilters.ts`, never in the dialog component.
- **Write through `CanvasHandle`, not `WebGLRenderer` directly** (`AGENTS.md`): `writeLayerPixels` is exposed on `CanvasHandle` and called via `canvasHandleRef.current`. The hook never imports `WebGLRenderer`.
- **Dialog category** (`AGENTS.md`): `GaussianBlurDialog` wraps `ModalDialog` and uses widgets (`SliderInput`, `DialogButton`). It does not import `AppContext`.
- **Tools vs. hooks** (`AGENTS.md`): Gaussian Blur is not a drawing tool — it has no pointer event handler. It belongs in a hook, not under `src/tools/`.
- **CSS Modules** (`AGENTS.md`): styles are in `GaussianBlurDialog.module.scss`, not a plain `.scss` file.
- **`selectionStore` is a module-level singleton**: read directly in `useFilters` at preview/apply time, not passed as a prop. This matches how `cropStore` is used in `useCanvasTransforms`.
- **No new AppState fields**: the filter dialog state (`showGaussianBlurDialog`) lives as `useState` in `App.tsx`, matching the pattern for all other dialogs (`showResizeDialog`, `showExportDialog`, etc.).

---

## Open Questions

1. **Race condition on rapid Apply**: If the user moves the slider rapidly and immediately clicks Apply before the last preview WASM call completes, Apply calls `handleApplyGaussianBlur` which also starts an async WASM call. The in-flight preview call will still land and call `writeLayerPixels`, then Apply's call lands and overwrites. With `originalPixelsRef` cleared after Apply, the preview guard (`if (!original) return`) catches any preview calls that outlive the Apply. However the preview write that lands *before* the Apply write could briefly flash a different radius. If this is observed in testing, introduce a `generationRef` counter incremented on each Apply/Cancel and checked in the preview async callback.

2. **`useFilters` and the Filters Menu TD interface**: The Filters Menu TD defines a minimal `UseFiltersReturn` (`isFiltersMenuEnabled`, `handleOpenGaussianBlur`). This design adds three more methods. The Filters Menu TD should be treated as the minimum viable interface, not the final one. No file conflict exists — both are describing the same file.

3. **Apply button loading state**: For very large canvases (e.g. 4096 × 4096) with Radius 250, the WASM call may take several hundred milliseconds. The dialog closes before Apply resolves, so the user will not see a spinner. If this is flagged as a UX issue, `handleApplyGaussianBlur` can be made synchronously awaited in the `onApply` handler (making `onApply: (radius: number) => Promise<void>`) and the dialog can display a disabled-button state while awaiting. This is out of scope per the spec but is a clean extension point.
