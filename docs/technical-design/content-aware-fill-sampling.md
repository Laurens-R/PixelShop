# Technical Design: Content-Aware Fill – Sampling Area Control

## Overview

This feature adds a sampling-radius constraint to the existing PatchMatch inpainting pipeline. Before running Content-Aware Fill or Content-Aware Delete, a pre-run **Sampling Options dialog** collects a radius in pixels from the user. That radius drives a pure utility function (`computeSourceMask`) that computes a binary `sourceMask` — the set of pixels the algorithm is permitted to draw patches from. The `sourceMask` flows downward through every layer of the stack: a new optional parameter on the C++ `inpaint()` function, a matching new parameter on the WASM export `pixelops_inpaint`, an optional `Uint8Array` on the TypeScript `inpaintRegion()` wrapper, and a `samplingRadius` argument on the hook's run callbacks. Dialog open state is managed in `App.tsx`, consistent with every other filter/operation dialog in the application. Radius 0 means unlimited — identical to today's behaviour — so the change is fully non-breaking.

---

## Affected Areas

### New files

| File | Purpose |
|------|---------|
| `src/utils/computeSourceMask.ts` | Pure utility: converts `fillMask` + `radiusPx` → `Uint8Array \| null` |
| `src/components/dialogs/ContentAwareFillOptionsDialog/ContentAwareFillOptionsDialog.tsx` | Pre-run dialog: sampling radius input, Fill / Delete primary action |
| `src/components/dialogs/ContentAwareFillOptionsDialog/ContentAwareFillOptionsDialog.module.scss` | Companion SCSS module |

### Modified files

| File | Change summary |
|------|---------------|
| `wasm/src/inpaint.h` | `inpaint()` gains `const uint8_t* sourceMask` parameter |
| `wasm/src/inpaint.cpp` | `PyramidLevel` gains `sourceMask` field; `downsampleLevel()` updated; `buildLevelBuffers()` gates source-pixel inclusion on `sourceMask`; all candidate-source checks throughout PatchMatch gated on `sourceMask` |
| `wasm/src/pixelops.cpp` | `pixelops_inpaint` gains `sourceMaskPtr` parameter (inserted between `patchSize` and `out`) |
| `src/wasm/types.ts` | `_pixelops_inpaint` gains `sourceMaskPtr: number` |
| `src/wasm/index.ts` | `inpaintRegion()` gains optional `sourceMask?: Uint8Array` |
| `src/hooks/useContentAwareFill.ts` | `runInpaint` accepts `samplingRadius`; calls `computeSourceMask`; guards empty-source region; return type renamed |
| `src/App.tsx` | Adds dialog open/mode state; `handleContentAwareFill` / `handleContentAwareDelete` open the dialog; `handleContentAwareFillConfirm` runs the hook with the chosen radius; renders `ContentAwareFillOptionsDialog` |
| `src/components/index.ts` | Barrel-exports new dialog component and its props type |

`wasm/CMakeLists.txt` — **no changes required**. The exported symbol name `_pixelops_inpaint` is unchanged; only its implementation signature changes, which does not affect the `EXPORTED_FUNCTIONS` list.

---

## State Changes

No changes to `AppState` or the `AppContext` reducer. All new state is **local to `App.tsx`**, consistent with every other filter dialog in the file (e.g. `showGaussianBlurDialog`, `showMotionBlurDialog`).

Two new state fields added to `App.tsx`:

```tsx
const [showContentAwareFillOptionsDialog, setShowContentAwareFillOptionsDialog] = useState(false)
const [contentAwareFillOptionsMode, setContentAwareFillOptionsMode] = useState<'fill' | 'delete'>('fill')
```

---

## New Components / Hooks / Tools

### `ContentAwareFillOptionsDialog` — dialog

**Path:** `src/components/dialogs/ContentAwareFillOptionsDialog/ContentAwareFillOptionsDialog.tsx`  
**Category:** Dialog — must wrap `ModalDialog`.  
**Single responsibility:** Collect a sampling radius from the user before an inpaint run. Emits `onConfirm(radius)` or `onCancel()`.

```ts
interface ContentAwareFillOptionsDialogProps {
  open:      boolean
  mode:      'fill' | 'delete'
  onConfirm: (radius: number) => void
  onCancel:  () => void
}
```

Behaviour:

- Tracks `radius` as internal `useState`, **initialized to 200**.
- Resets to 200 every time `open` transitions from `false` to `true` via `useEffect` on `open`.
- Rendered inside `ModalDialog` with title `"Sampling Options"` and `onClose → onCancel`.
- Contains:
  - A labelled integer input (`"Sampling Radius"`, unit label `"px"`, `min={0}`, default 200).
  - A description paragraph: `"Only pixels within this distance of the selection boundary will be used as source material. Set to 0 to sample the entire image."`
  - Footer: **Cancel** button and a primary action button labelled `"Fill"` (`mode === 'fill'`) or `"Delete"` (`mode === 'delete'`).
- Wrapped in `<form onSubmit>` so **Enter** submits.
- **Escape** is handled by `ModalDialog`'s `onClose` (already wired to `onCancel`).
- The radius input receives focus when the dialog opens (via `autoFocus` or a `useEffect`/ref approach — see Open Questions).

---

### `computeSourceMask` — pure utility

**Path:** `src/utils/computeSourceMask.ts`  
**Single responsibility:** Convert a fill mask and a radius into a binary source-eligibility mask.

```ts
export function computeSourceMask(
  fillMask: Uint8Array,   // width × height, nonzero = fill region
  width:    number,
  height:   number,
  radiusPx: number,       // integer; 0 = no constraint
): Uint8Array | null      // null = unconstrained (radius === 0)
```

Returns `null` when `radiusPx === 0`. The caller passes `null` directly as `sourceMask` to `inpaintRegion`; the WASM layer receives pointer `0`, preserving existing unconstrained behaviour.

**Algorithm (BFS distance approximation):**

1. **Seed collection.** Find all *fill-boundary* pixels: non-fill pixels (`fillMask[i] === 0`) that are 4-adjacent to at least one fill pixel (`fillMask[j] !== 0`). Add each to a BFS queue and record its own `(x, y)` as its `nearestBoundaryX / nearestBoundaryY`.
2. **BFS expansion.** For each pixel `p` dequeued, examine its 4-connected non-fill neighbours `q` that have not yet been visited. Inherit `nearestBoundary[q] = nearestBoundary[p]`, then compute the squared Euclidean distance from `q` to `nearestBoundary[q]`. If `dist² ≤ radiusPx²`, mark `sourceMask[q] = 1`, set `nearestBoundary[q]`, and enqueue `q`.
3. Return the completed `sourceMask`.

Note: inheriting `nearestBoundary` through the BFS tree is an approximation — the boundary pixel referenced may not be the globally nearest for every pixel. For the expected image sizes and radii this produces visually indistinguishable results. A full Euclidean distance transform (Saito-Toriwaki) can replace steps 1–2 for exact distances if needed (see Open Questions).

---

### Modified hook: `useContentAwareFill`

**Changed signature** of the internal `runInpaint` function and the exported return type:

```ts
// Before
export interface UseContentAwareFillReturn {
  handleContentAwareFill:   () => Promise<void>
  handleContentAwareDelete: () => Promise<void>
}

// After
export interface UseContentAwareFillReturn {
  runContentAwareFill:   (samplingRadius: number) => Promise<void>
  runContentAwareDelete: (samplingRadius: number) => Promise<void>
}
```

**New logic inside `runInpaint(eraseActiveLayer, samplingRadius)`**, inserted after the WASM readiness guard and before `setIsContentAwareFilling(true)`:

```ts
const PATCH_SIZE        = 4
const MIN_SOURCE_PIXELS = (2 * PATCH_SIZE + 1) ** 2  // 81 — one full patch window

const sourceMask = computeSourceMask(mask, cw, ch, samplingRadius)

if (sourceMask !== null) {
  let eligibleCount = 0
  for (let i = 0; i < sourceMask.length; i++) eligibleCount += sourceMask[i]
  if (eligibleCount < MIN_SOURCE_PIXELS) {
    onError(
      'Sampling radius is too small — no source pixels available. ' +
      'Try a larger radius or set it to 0.'
    )
    isRunningRef.current = false
    return
  }
}
```

The call to `inpaintRegion` becomes:

```ts
const inpainted = await inpaintRegion(composite, width, height, mask, sourceMask ?? undefined)
```

---

## Implementation Steps

### Step 1 — `wasm/src/inpaint.h`

Add `const uint8_t* sourceMask` as a new parameter to `inpaint()`, inserted between `patchSize` and `out`:

```cpp
void inpaint(
    const uint8_t* pixels, int width, int height,
    const uint8_t* mask, int patchSize,
    const uint8_t* sourceMask,   // ← new: 1 = eligible, 0 = excluded; pass nullptr for unconstrained
    uint8_t* out
);
```

---

### Step 2 — `wasm/src/inpaint.cpp`

**2a. `PyramidLevel` struct** — add `sourceMask` field:

```cpp
struct PyramidLevel {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> pixels;
    std::vector<uint8_t> mask;
    std::vector<uint8_t> sourceMask;   // ← new; empty = unconstrained at this level
};
```

**2b. `downsampleLevel()`** — after the existing `mask` downsampling loop, add OR-pooling for `sourceMask`. If `src.sourceMask` is empty, leave `dst.sourceMask` empty:

```cpp
if (!src.sourceMask.empty()) {
    dst.sourceMask.resize(static_cast<size_t>(dst.width) * dst.height, 0);
    for (int y = 0; y < dst.height; ++y) {
        for (int x = 0; x < dst.width; ++x) {
            uint8_t sm = 0;
            for (int oy = 0; oy < 2 && !sm; ++oy) {
                const int sy = clampI(y * 2 + oy, 0, src.height - 1);
                for (int ox = 0; ox < 2 && !sm; ++ox) {
                    const int sx = clampI(x * 2 + ox, 0, src.width - 1);
                    sm = static_cast<uint8_t>(sm | src.sourceMask[sy * src.width + sx]);
                }
            }
            dst.sourceMask[y * dst.width + x] = sm;
        }
    }
}
```

OR-pooling (rather than AND-pooling or average-pooling) ensures the coarser levels remain permissive: if any pixel in a 2×2 block is an eligible source, the block is eligible at the next level. This prevents the source region from vanishing prematurely at coarse pyramid levels.

**2c. `buildLevelBuffers()`** — gate source-pixel inclusion on `sourceMask`. The `LevelBuffers` struct requires access to the level's `sourceMask`; pass it as a parameter or add it to `LevelBuffers`:

```cpp
static void buildLevelBuffers(
    const std::vector<uint8_t>& mask,
    const std::vector<uint8_t>& sourceMask,   // ← new; may be empty
    int width, int height,
    LevelBuffers& buffers
)
```

In the source-pixel branch:

```cpp
// Before
} else {
    buffers.sourcePixels.emplace_back(x, y);
}

// After
} else {
    if (sourceMask.empty() || sourceMask[idx]) {
        buffers.sourcePixels.emplace_back(x, y);
    }
}
```

**2d. `inpaint()` function body** — populate `level0.sourceMask` from the new parameter:

```cpp
if (sourceMask != nullptr) {
    level0.sourceMask.assign(sourceMask, sourceMask + static_cast<size_t>(n));
}
```

The `sourceMask` field propagates through the pyramid automatically via `downsampleLevel` (step 2b).

**2e. All candidate-source checks in the PatchMatch loop** — everywhere a source location `(sx, sy)` is proposed (coarse-to-fine upscale seeding, nearest-source BFS seeding, EM propagation, random search), add a guard after the existing fill-mask check:

```cpp
// Existing guard
if (level.mask[sy * w + sx]) continue;

// New guard (add immediately after)
if (!level.sourceMask.empty() && !level.sourceMask[sy * w + sx]) continue;
```

This must be applied consistently at every location that proposes a candidate offset. Search for all occurrences of `level.mask[cand` or `level.mask[sy` within the PatchMatch loop body.

Update all `buildLevelBuffers` call sites to pass `level.sourceMask`.

---

### Step 3 — `wasm/src/pixelops.cpp`

Update `pixelops_inpaint` to accept and forward `sourceMask`:

```cpp
EMSCRIPTEN_KEEPALIVE
void pixelops_inpaint(
    const uint8_t* pixels, int width, int height,
    const uint8_t* mask, int patchSize,
    const uint8_t* sourceMask,   // ← new; pass nullptr (0) for unconstrained
    uint8_t* out
) {
    inpaint(pixels, width, height, mask, patchSize, sourceMask, out);
}
```

---

### Step 4 — `wasm/CMakeLists.txt`

No changes. The exported symbol `_pixelops_inpaint` is already listed in `EXPORTED_FUNCTIONS`; only its implementation signature changes.

---

### Step 5 — `src/wasm/types.ts`

Add `sourceMaskPtr` to `_pixelops_inpaint` in `PixelOpsModule`, inserted between `patchSize` and `outPtr`:

```ts
_pixelops_inpaint(
  pixelsPtr:     number,
  width:         number,
  height:        number,
  maskPtr:       number,
  patchSize:     number,
  sourceMaskPtr: number,   // ← new; 0 = unconstrained
  outPtr:        number
): void
```

---

### Step 6 — `src/wasm/index.ts`

Update `inpaintRegion` signature and implementation:

```ts
export async function inpaintRegion(
  pixels:     Uint8Array,
  width:      number,
  height:     number,
  mask:       Uint8Array,
  sourceMask?: Uint8Array,   // ← new; undefined = unconstrained
): Promise<Uint8Array> {
  const m = await getPixelOps()
  const PATCH_SIZE = 4
  const byteLen = pixels.byteLength

  const pixelsPtr    = m._malloc(byteLen)
  const maskPtr      = m._malloc(mask.byteLength)
  const sourceMskPtr = sourceMask ? m._malloc(sourceMask.byteLength) : 0
  const outPtr       = m._malloc(byteLen)
  try {
    m.HEAPU8.set(pixels, pixelsPtr)
    m.HEAPU8.set(mask,   maskPtr)
    if (sourceMask && sourceMskPtr) m.HEAPU8.set(sourceMask, sourceMskPtr)
    m._pixelops_inpaint(pixelsPtr, width, height, maskPtr, PATCH_SIZE, sourceMskPtr, outPtr)
    // Re-read HEAPU8 in case WASM memory grew during the call
    return m.HEAPU8.slice(outPtr, outPtr + byteLen)
  } finally {
    m._free(pixelsPtr)
    m._free(maskPtr)
    if (sourceMskPtr) m._free(sourceMskPtr)
    m._free(outPtr)
  }
}
```

---

### Step 7 — `src/utils/computeSourceMask.ts`

Create the new file implementing `computeSourceMask` as specified in the New Components section. Export only `computeSourceMask` — no other symbols.

---

### Step 8 — `src/components/dialogs/ContentAwareFillOptionsDialog/ContentAwareFillOptionsDialog.tsx`

Create the dialog component as described in the New Components section. Key implementation notes:

- Use `ModalDialog` with `title="Sampling Options"` and `onClose={onCancel}`.
- Reset `radius` to 200 inside a `useEffect` that fires when `open` transitions to `true`.
- Wrap contents in `<form onSubmit={e => { e.preventDefault(); onConfirm(radius) }}>` so Enter triggers confirm.
- Validate that `radius` is a non-negative integer before calling `onConfirm`; clamp negative input to 0.

---

### Step 9 — `src/components/dialogs/ContentAwareFillOptionsDialog/ContentAwareFillOptionsDialog.module.scss`

Create companion SCSS module. Follow the existing dialog aesthetic (match `GaussianBlurDialog.module.scss` for reference: footer with flex row, gap, and right-aligned buttons; standard input sizing and label alignment).

---

### Step 10 — `src/components/index.ts`

Add two lines alongside the existing `ContentAwareFillProgress` exports:

```ts
export { ContentAwareFillOptionsDialog } from './dialogs/ContentAwareFillOptionsDialog/ContentAwareFillOptionsDialog'
export type { ContentAwareFillOptionsDialogProps } from './dialogs/ContentAwareFillOptionsDialog/ContentAwareFillOptionsDialog'
```

---

### Step 11 — `src/hooks/useContentAwareFill.ts`

Four changes:

a. Add import:
   ```ts
   import { computeSourceMask } from '@/utils/computeSourceMask'
   ```

b. Change `runInpaint(eraseActiveLayer: boolean)` to `runInpaint(eraseActiveLayer: boolean, samplingRadius: number)`.

c. After the WASM readiness guard (before `setIsContentAwareFilling(true)`), add the `sourceMask` computation and empty-source guard as shown in the hook description above.

d. Pass `sourceMask ?? undefined` to `inpaintRegion`.

e. Update `UseContentAwareFillReturn` and the returned callbacks:
   ```ts
   export interface UseContentAwareFillReturn {
     runContentAwareFill:   (samplingRadius: number) => Promise<void>
     runContentAwareDelete: (samplingRadius: number) => Promise<void>
   }
   // …
   return {
     runContentAwareFill:   (r) => runInpaint(false, r),
     runContentAwareDelete: (r) => runInpaint(true,  r),
   }
   ```

---

### Step 12 — `src/App.tsx`

Five changes:

a. Add import (alongside the existing `ContentAwareFillProgress` import):
   ```ts
   import { ContentAwareFillProgress, ContentAwareFillOptionsDialog } from '@/components'
   ```

b. Add new state after the existing content-aware fill state block (lines 104–106):
   ```tsx
   const [showContentAwareFillOptionsDialog, setShowContentAwareFillOptionsDialog] = useState(false)
   const [contentAwareFillOptionsMode, setContentAwareFillOptionsMode] = useState<'fill' | 'delete'>('fill')
   ```

c. Update the `useContentAwareFill` destructure:
   ```tsx
   const { runContentAwareFill, runContentAwareDelete } = useContentAwareFill({ … })
   ```

d. Replace the forwarded `handleContentAwareFill` / `handleContentAwareDelete` references in the top-menu props and keyboard handler with new local callbacks that open the dialog. Add these after the `useContentAwareFill` call:
   ```tsx
   const handleContentAwareFill = useCallback(() => {
     requireTransformDecision(() => {
       setContentAwareFillOptionsMode('fill')
       setShowContentAwareFillOptionsDialog(true)
     })
   }, [requireTransformDecision])

   const handleContentAwareDelete = useCallback(() => {
     requireTransformDecision(() => {
       setContentAwareFillOptionsMode('delete')
       setShowContentAwareFillOptionsDialog(true)
     })
   }, [requireTransformDecision])

   const handleContentAwareFillConfirm = useCallback((radius: number) => {
     setShowContentAwareFillOptionsDialog(false)
     if (contentAwareFillOptionsMode === 'fill') {
       runContentAwareFill(radius)
     } else {
       runContentAwareDelete(radius)
     }
   }, [contentAwareFillOptionsMode, runContentAwareFill, runContentAwareDelete])
   ```

e. In the JSX, render the new dialog (alongside the existing `ContentAwareFillProgress`):
   ```tsx
   <ContentAwareFillOptionsDialog
     open={showContentAwareFillOptionsDialog}
     mode={contentAwareFillOptionsMode}
     onConfirm={handleContentAwareFillConfirm}
     onCancel={() => setShowContentAwareFillOptionsDialog(false)}
   />
   ```

---

## Architectural Constraints

- **`App.tsx` as thin orchestrator.** Dialog open/mode state is local to `App.tsx`. It must not enter `AppContext` or `AppState`. This mirrors every other filter/operation dialog in the file.
- **Hook single responsibility.** `useContentAwareFill` owns only inpaint execution — not dialog state, not radius state. Dialog state belongs in `App.tsx`.
- **`ModalDialog` wrapping.** `ContentAwareFillOptionsDialog` must wrap `ModalDialog`. It must not implement its own modal shell or scrim.
- **WASM memory rules.** `sourceMaskPtr` must be allocated with `_malloc` and freed in `finally`, identical to the existing `maskPtr` pattern. `HEAPU8` must be re-read from the module *after* the WASM call in case memory grew — the existing `m.HEAPU8.slice(outPtr, …)` already does this.
- **No direct import of `src/wasm/generated/`.** All WASM paths go through `src/wasm/index.ts`.
- **`.module.scss` only.** The new dialog's styles must live entirely in `ContentAwareFillOptionsDialog.module.scss`. A plain `.scss` default import is treated as `undefined` at runtime by Vite.
- **Barrel export.** The new component must be exported from `src/components/index.ts` before it is imported anywhere else.

---

## Option B: User-Painted Sampling Area

The `sourceMask` parameter is the single interface point between the UI layer and the WASM inpainting layer for source-region control. No WASM changes are required to support Option B.

In Option B, the user would paint a green overlay on the canvas after invoking Content-Aware Fill/Delete. The overlay is a rendered `Uint8Array` constructed on the JS side (1 = painted, 0 = not painted). This array is passed directly as `sourceMask` to the same `inpaintRegion` call — identically to how Option A's radius-computed mask is passed. The only new work in Option B is the painting UI mode and the overlay-to-mask conversion; the entire WASM stack is reused without modification.

---

## Open Questions

1. **OR-pooling at coarse pyramid levels.** If the source band is very narrow (1–2 pixels wide) and is progressively OR-pooled away over several pyramid levels, coarse-level matching will behave as if unconstrained. This is acceptable (coarse levels provide global structure; the constraint is enforced precisely at the finest level) but should be verified empirically with narrow-band test cases.

2. **BFS approximation vs. exact Euclidean distance.** The inherited-boundary BFS is an approximation. For most selection shapes the error is below one pixel. If test images with thin, concave selections show visible asymmetric halos in the source band, replace the BFS with a proper Euclidean distance transform (e.g. Saito-Toriwaki two-pass scan).

3. **`MIN_SOURCE_PIXELS` threshold.** The design uses 81 (one 9×9 patch area) as the minimum eligible source pixel count before showing an error toast. Confirm with the product team whether a larger minimum (e.g. 10× = 810, roughly a 28×28 area) produces better UX for small-radius edge cases where fills would be technically possible but visually poor.

4. **Auto-focus on dialog open.** The radius input should receive focus when the dialog opens. Decide between `autoFocus` on the `<input>` element (simple, but has known Safari focus-on-mount quirks) and a `useEffect`-driven `inputRef.current?.focus()` (preferred for testability and reliability).

5. **`requireTransformDecision` wrapping.** The design wraps both `handleContentAwareFill` and `handleContentAwareDelete` in `requireTransformDecision`. Confirm that Content-Aware Fill should interrupt an active free-transform session (requiring the user to apply or cancel first), consistent with all other Edit-menu actions.
