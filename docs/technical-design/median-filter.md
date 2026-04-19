# Technical Design: Median Filter

## Overview

Median Filter is a destructive, single-pass WebGPU compute filter that removes salt-and-pepper and impulse noise by replacing each pixel's RGB values with the channel-wise median sampled from a square (2r+1)×(2r+1) neighbourhood. It follows the identical floating-panel pattern established by `GaussianBlurDialog` (single control, debounced preview, Apply/Cancel). The GPU shader collects up to 81 float samples per channel into a `var<private>` array, runs insertion sort, and picks the middle element. Alpha is preserved unchanged. No WASM, no CPU fallback.

---

## Affected Areas

| File | Change |
|---|---|
| `src/webgpu/filterShaders.ts` | Add `FILTER_MEDIAN_COMPUTE` shader constant |
| `src/webgpu/filterCompute.ts` | Add `medianPipeline` field; add `FilterComputeEngine.median()` method; add module-level `median()` export |
| `src/types/index.ts` | Extend `FilterKey` union with `'median-filter'` |
| `src/filters/registry.ts` | Add `{ key: 'median-filter', label: 'Median…', group: 'noise' }` entry |
| `src/hooks/useFilters.ts` | Add `handleOpenMedianFilter` callback; extend `UseFiltersReturn` |
| `src/App.tsx` | Add `isMedianFilterOpen` state; add `'median-filter'` branch in `handleOpenFilterDialog`; render `MedianFilterDialog` |
| `src/components/dialogs/MedianFilterDialog/MedianFilterDialog.tsx` | New dialog component |
| `src/components/dialogs/MedianFilterDialog/MedianFilterDialog.module.scss` | New SCSS module |
| `src/components/index.ts` | Export `MedianFilterDialog` and `MedianFilterDialogProps` |

---

## State Changes

### `src/types/index.ts` — extend `FilterKey`

```ts
export type FilterKey =
  | 'gaussian-blur'
  | 'box-blur'
  | 'radial-blur'
  | 'motion-blur'
  | 'remove-motion-blur'
  | 'sharpen'
  | 'sharpen-more'
  | 'unsharp-mask'
  | 'smart-sharpen'
  | 'add-noise'
  | 'film-grain'
  | 'lens-blur'
  | 'clouds'
  | 'median-filter'     // ← new
```

No new `AppState` fields. All dialog state is component-local (`useState` / `useRef`).

---

## GPU Algorithm

### Neighbourhood clamping

Pixels outside the layer boundary are handled with **border clamping** (`clamp(coord + offset, 0, dims - 1)`), matching the convention used by all existing filters.

### Radius mapping

| UI radius | GPU radius | Kernel size | Sample count |
|---|---|---|---|
| 1 | 1 | 3×3 | 9 |
| 2 | 2 | 5×5 | 25 |
| 3 | 3 | 7×7 | 49 |
| 4–10 | 4 | 9×9 | 81 |

The UI exposes 1–10. Values 5–10 are valid UX choices but all map to GPU radius 4. The shader clamps internally: `let r = min(params.radius, 4u)`. This keeps the `var<private>` array size fixed at 81 entries regardless of the incoming uniform value.

### WGSL private array and insertion sort

WGSL does not support dynamically-sized arrays in private address space, but fixed-size `var<private>` arrays are valid. Declare:
```wgsl
var<private> vals: array<f32, 81>;
```
This is allocated per-invocation on the GPU stack. Three separate fill+sort+pick loops execute for R, G, B channels (alpha is read once and written unchanged).

### WGSL uniform struct

```wgsl
struct MedianParams {
  radius : u32,   // GPU radius 1–4 (TS clamps before upload)
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}
```

Total: 16 bytes. All `u32` scalars — use `new Uint32Array([gpuRadius, 0, 0, 0])`.

### Shader bindings

| Binding | Type | Format | Usage |
|---|---|---|---|
| `@group(0) @binding(0)` | `texture_2d<f32>` | `rgba8unorm` (read) | Source pixels |
| `@group(0) @binding(1)` | `texture_storage_2d<rgba8unorm, write>` | `rgba8unorm` (write) | Output pixels |
| `@group(0) @binding(2)` | `var<uniform> MedianParams` | — | Radius parameter |

### Full WGSL source

```wgsl
// FILTER_MEDIAN_COMPUTE
struct MedianParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : MedianParams;

var<private> vals: array<f32, 81>;

fn insertionSort(n: u32) {
  for (var i = 1u; i < n; i++) {
    let key = vals[i];
    var j = i32(i) - 1;
    loop {
      if (j < 0 || vals[u32(j)] <= key) { break; }
      vals[u32(j) + 1u] = vals[u32(j)];
      j = j - 1;
    }
    vals[u32(j + 1)] = key;
  }
}

@compute @workgroup_size(8, 8)
fn cs_median(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let r   = min(params.radius, 4u);
  let n   = (2u * r + 1u) * (2u * r + 1u);
  let mid = n / 2u;

  let orig = textureLoad(srcTex, vec2i(id.xy), 0);

  // Collect + sort R
  var count = 0u;
  for (var ky = -i32(r); ky <= i32(r); ky++) {
    for (var kx = -i32(r); kx <= i32(r); kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      vals[count] = textureLoad(srcTex, vec2i(sx, sy), 0).r;
      count += 1u;
    }
  }
  insertionSort(n);
  let medR = vals[mid];

  // Collect + sort G
  count = 0u;
  for (var ky = -i32(r); ky <= i32(r); ky++) {
    for (var kx = -i32(r); kx <= i32(r); kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      vals[count] = textureLoad(srcTex, vec2i(sx, sy), 0).g;
      count += 1u;
    }
  }
  insertionSort(n);
  let medG = vals[mid];

  // Collect + sort B
  count = 0u;
  for (var ky = -i32(r); ky <= i32(r); ky++) {
    for (var kx = -i32(r); kx <= i32(r); kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      vals[count] = textureLoad(srcTex, vec2i(sx, sy), 0).b;
      count += 1u;
    }
  }
  insertionSort(n);
  let medB = vals[mid];

  textureStore(dstTex, vec2i(id.xy), vec4f(medR, medG, medB, orig.a));
}
```

> **Note on `var<private>` insertion sort correctness**: Because `insertionSort` is called three times per invocation (once per channel), and each call re-uses the same `vals` array, the array is overwritten on each fill loop. The sort state from the previous channel does not carry over — the array is fully refilled before each sort call. This is correct.

---

## TypeScript Interface

### `FilterComputeEngine` — new private field

```ts
private readonly medianPipeline: GPUComputePipeline
```

Initialized in the constructor:
```ts
this.medianPipeline = this.createPipeline(FILTER_MEDIAN_COMPUTE, 'cs_median')
```

### `FilterComputeEngine.median()` method signature

```ts
async median(
  pixels: Uint8Array,
  width: number,
  height: number,
  radius: number,           // UI value 1–10; clamp to 1–4 before passing to GPU
): Promise<Uint8Array>
```

**Parameter buffer construction** (all `u32`, no `DataView` needed):
```ts
const gpuRadius  = Math.max(1, Math.min(4, radius))
const paramsData = new Uint32Array([gpuRadius, 0, 0, 0])
const paramsBuf  = createUniformBuffer(device, 16)
writeUniformBuffer(device, paramsBuf, paramsData)
```

**Texture layout**:
- `srcTex`: `rgba8unorm`, `TEXTURE_BINDING | COPY_DST`
- `outTex`: `rgba8unorm`, `STORAGE_BINDING | COPY_SRC`
- No intermediate texture required.

**Dispatch**:
```ts
pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
```

### Module-level export (singleton wrapper)

```ts
export async function median(
  pixels: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Promise<Uint8Array> {
  return _engine!.median(pixels, width, height, radius)
}
```

Import in dialog: `import { median } from '@/webgpu/filterCompute'`

---

## Dialog Component

**File**: `src/components/dialogs/MedianFilterDialog/MedianFilterDialog.tsx`

**Pattern**: Single-control variant of `GaussianBlurDialog`. Identical structure:
- `isOpen` guard + initialization effect
- `originalPixelsRef` + `selectionMaskRef` captured on open
- Debounced `runPreview` with `isBusyRef` guard (DEBOUNCE_MS = 25)
- `handleApply` commits via `captureHistory('Median Filter')`
- `handleCancel` restores `originalPixelsRef.current` to the layer

**Props interface**:
```ts
export interface MedianFilterDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}
```

**Constants**:
```ts
const MIN_RADIUS     = 1
const MAX_RADIUS     = 10
const DEFAULT_RADIUS = 1
const DEBOUNCE_MS    = 25
```

**Preview call**:
```ts
const result   = await median(original.slice(), canvasWidth, canvasHeight, r)
const composed = applySelectionComposite(result, original, selectionMaskRef.current)
handle.writeLayerPixels(activeLayerId, composed)
```

**SCSS**: `MedianFilterDialog.module.scss` — follow `GaussianBlurDialog.module.scss` exactly (single-row slider layout).

---

## Filter Registration

**`src/filters/registry.ts`** — append to the `noise` group:

```ts
{ key: 'median-filter',    label: 'Median…',    group: 'noise' },
```

Full noise group after change:
```ts
{ key: 'add-noise',        label: 'Add Noise…',      group: 'noise' },
{ key: 'film-grain',       label: 'Film Grain…',      group: 'noise' },
{ key: 'median-filter',    label: 'Median…',          group: 'noise' },   // ← new
{ key: 'bilateral-filter', label: 'Bilateral…',       group: 'noise' },   // ← new (see bilateral-filter.md)
{ key: 'reduce-noise',     label: 'Reduce Noise…',    group: 'noise' },   // ← new (see reduce-noise.md)
```

---

## `useFilters.ts` Changes

Add to `UseFiltersReturn`:
```ts
handleOpenMedianFilter: () => void
```

Add implementation inside `useFilters`:
```ts
const handleOpenMedianFilter = useCallback(
  () => onOpenFilterDialog('median-filter'),
  [onOpenFilterDialog]
)
```

Return it in the returned object.

---

## `App.tsx` Changes

```ts
const [isMedianFilterOpen, setIsMedianFilterOpen] = useState(false)
```

In `handleOpenFilterDialog`:
```ts
case 'median-filter': setIsMedianFilterOpen(true); break
```

Render dialog (alongside other dialogs):
```tsx
<MedianFilterDialog
  isOpen={isMedianFilterOpen}
  onClose={() => setIsMedianFilterOpen(false)}
  canvasHandleRef={canvasHandleRef}
  activeLayerId={activeLayerId}
  captureHistory={captureHistory}
  canvasWidth={canvasWidth}
  canvasHeight={canvasHeight}
/>
```

---

## `src/components/index.ts` Changes

```ts
export { MedianFilterDialog } from './dialogs/MedianFilterDialog/MedianFilterDialog'
export type { MedianFilterDialogProps } from './dialogs/MedianFilterDialog/MedianFilterDialog'
```

---

## Architectural Constraints

- **No WASM, no CPU fallback** — the shader is the only execution path.
- **`layout: 'auto'`** — the pipeline layout is derived automatically; all three bindings (srcTex, dstTex, params) must be declared in the shader and used. Unused bindings would be stripped.
- **`rgba8unorm` output** — matches every other single-pass filter in the engine (radial blur, motion blur, sharpen, etc.).
- **`var<private>` array** — 81 `f32` values = 324 bytes per invocation. This is shader-private register space, not workgroup shared memory. At `@workgroup_size(8, 8)` = 64 invocations, the total register pressure is per-invocation and handled by the GPU compiler.
- **Alpha preservation** — `orig.a` is read once and written to the output; the sort never touches the alpha channel.
- **Dialog is a dialog component** — `MedianFilterDialog` may only access props and call the `median` filter function. It must not access `AppContext` directly.

---

## Open Questions

1. **UI radius 5–10 all mapping to GPU radius 4**: Should the UI label indicate that values above 4 have no additional effect, or is the silent clamp acceptable? A note in the panel ("Radius above 4 uses a 9×9 kernel") could improve discoverability.
2. **Per-channel sort vs. per-channel-tuple sort**: The current design sorts R, G, B independently (three separate sort passes). This preserves per-channel median but can produce colors that did not exist in the neighbourhood (e.g., median R from one pixel, median G from another). An alternative is component-median (which Photoshop uses). Spec is silent on this distinction — flagging for decision before implementation.
3. **Performance on large canvases with radius 4**: 9×9 = 81 texture fetches × 3 channels × O(n²) insertion sort per invocation. On a 4K canvas (~8M pixels) this is acceptable on modern hardware but worth benchmarking. If profiling reveals issues, a histogram-based median (O(n) per invocation) is an upgrade path without interface changes.
