# Technical Design: Bilateral Filter

## Overview

Bilateral Filter is a destructive, single-pass WebGPU compute filter that smooths noise and fine texture while preserving hard colour boundaries. Each output pixel is a weighted average of its neighbourhood, where the weight combines a **spatial Gaussian** (distance from centre) with a **colour Gaussian** (RGB Euclidean distance from the centre pixel's colour). Neighbours across a strong colour edge receive near-zero weight, so edges remain sharp. The filter exposes two controls: **Spatial Radius** (1–20 px) and **Color Sigma** (1–150). It follows the identical floating-panel pattern established by `UnsharpMaskDialog` (two or more controls, debounced preview, Apply/Cancel). Alpha is preserved unchanged. No WASM, no CPU fallback.

---

## Affected Areas

| File | Change |
|---|---|
| `src/webgpu/filterShaders.ts` | Add `FILTER_BILATERAL_COMPUTE` shader constant |
| `src/webgpu/filterCompute.ts` | Add `bilateralPipeline` field; add `FilterComputeEngine.bilateral()` method; add module-level `bilateral()` export |
| `src/types/index.ts` | Extend `FilterKey` union with `'bilateral-filter'` |
| `src/filters/registry.ts` | Add `{ key: 'bilateral-filter', label: 'Bilateral…', group: 'noise' }` entry |
| `src/hooks/useFilters.ts` | Add `handleOpenBilateralFilter` callback; extend `UseFiltersReturn` |
| `src/App.tsx` | Add `isBilateralFilterOpen` state; add `'bilateral-filter'` branch in `handleOpenFilterDialog`; render `BilateralFilterDialog` |
| `src/components/dialogs/BilateralFilterDialog/BilateralFilterDialog.tsx` | New dialog component |
| `src/components/dialogs/BilateralFilterDialog/BilateralFilterDialog.module.scss` | New SCSS module |
| `src/components/index.ts` | Export `BilateralFilterDialog` and `BilateralFilterDialogProps` |

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
  | 'median-filter'       // bilateral-filter.md
  | 'bilateral-filter'    // ← new
```

No new `AppState` fields. All dialog state is component-local.

---

## GPU Algorithm

### Bilateral weighting formula

For centre pixel **p** and neighbour **q** at offset `(dx, dy)`:

$$w(p, q) = \exp\!\left(-\frac{dx^2 + dy^2}{2\,\sigma_s^2}\right) \cdot \exp\!\left(-\frac{\|\mathbf{p}_{rgb} - \mathbf{q}_{rgb}\|^2}{2\,\sigma_c^2}\right)$$

Output colour:
$$C_{out} = \frac{\sum_{q \in \mathcal{N}} w(p,q)\,\mathbf{q}_{rgb}}{\sum_{q \in \mathcal{N}} w(p,q)}$$

The RGB Euclidean distance `||p - q||²` is computed as `dot(p.rgb - q.rgb, p.rgb - q.rgb)`. Since texel components are in `[0, 1]` (normalized from the `rgba8unorm` source), `sigmaColor` is expressed in the same 0–1 range.

### Sigma mapping (UI → shader)

| UI parameter | Range | Shader value |
|---|---|---|
| `spatialRadius` | 1–20 | `sigmaSpatial = f32(spatialRadius)` (1.0–20.0) |
| `colorSigma` | 1–150 | `sigmaColor = f32(colorSigma) / 255.0` (≈0.004–0.588) |

The spatial sigma is set equal to the radius so that the Gaussian covers the full neighbourhood at ≈3σ. The colour sigma is normalised to the texel range.

### Neighbourhood clamping

Border clamping: `clamp(coord + offset, 0, dims - 1)`.

### Performance characteristics

At radius 20, the inner loop executes 41×41 = 1,681 iterations per invocation. Each iteration performs one `textureLoad`, two dot products, and two `exp()` calls. On modern integrated and discrete GPUs this is within acceptable real-time preview latency for typical canvas sizes. The debounced preview (25 ms threshold) limits unnecessary computation during rapid slider movement.

No fixed-size private arrays are needed — only running accumulator scalars.

### WGSL uniform struct

```wgsl
struct BilateralParams {
  radius       : u32,   // 1–20
  _pad0        : u32,
  sigmaSpatial : f32,   // computed from radius
  sigmaColor   : f32,   // colorSigma / 255.0
}
```

Total: 16 bytes. **Mixed `u32`/`f32` layout** — the TypeScript side must use `ArrayBuffer + DataView` (not `Uint32Array`) to write float values into the correct byte offsets at little-endian:

```ts
const buf = new ArrayBuffer(16)
const dv  = new DataView(buf)
dv.setUint32(0,  radius,       true)   // offset 0, u32
dv.setUint32(4,  0,            true)   // offset 4, u32 pad
dv.setFloat32(8, sigmaSpatial, true)   // offset 8, f32
dv.setFloat32(12, sigmaColor,  true)   // offset 12, f32
```

This matches the established pattern in the engine (see `radialBlur` and `motionBlur`).

### Shader bindings

| Binding | Type | Format | Usage |
|---|---|---|---|
| `@group(0) @binding(0)` | `texture_2d<f32>` | `rgba8unorm` (read) | Source pixels |
| `@group(0) @binding(1)` | `texture_storage_2d<rgba8unorm, write>` | `rgba8unorm` (write) | Output pixels |
| `@group(0) @binding(2)` | `var<uniform> BilateralParams` | — | Filter parameters |

### Full WGSL source

```wgsl
// FILTER_BILATERAL_COMPUTE
struct BilateralParams {
  radius       : u32,
  _pad0        : u32,
  sigmaSpatial : f32,
  sigmaColor   : f32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : BilateralParams;

@compute @workgroup_size(8, 8)
fn cs_bilateral(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let center = textureLoad(srcTex, vec2i(id.xy), 0);
  let r      = i32(params.radius);

  let inv2SigmaS2 = 1.0 / (2.0 * params.sigmaSpatial * params.sigmaSpatial);
  let inv2SigmaC2 = 1.0 / (2.0 * params.sigmaColor   * params.sigmaColor);

  var weightSum = 0.0;
  var colorSum  = vec3f(0.0);

  for (var ky = -r; ky <= r; ky++) {
    for (var kx = -r; kx <= r; kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      let neighbor = textureLoad(srcTex, vec2i(sx, sy), 0);

      let spatialDist2 = f32(kx * kx + ky * ky);
      let colorDiff    = neighbor.rgb - center.rgb;
      let colorDist2   = dot(colorDiff, colorDiff);

      let w = exp(-spatialDist2 * inv2SigmaS2) * exp(-colorDist2 * inv2SigmaC2);

      colorSum  += neighbor.rgb * w;
      weightSum += w;
    }
  }

  let result = colorSum * (1.0 / weightSum);
  textureStore(dstTex, vec2i(id.xy), vec4f(result, center.a));
}
```

> **Numerical stability**: At radius 1, colorSigma 1, the centre pixel always contributes weight 1.0 (spatial dist = 0, colour dist = 0 → exp(0) = 1), so `weightSum ≥ 1.0` and division is safe. No special-case guard is needed.

---

## TypeScript Interface

### `FilterComputeEngine` — new private field

```ts
private readonly bilateralPipeline: GPUComputePipeline
```

Initialized in the constructor:
```ts
this.bilateralPipeline = this.createPipeline(FILTER_BILATERAL_COMPUTE, 'cs_bilateral')
```

### `FilterComputeEngine.bilateral()` method signature

```ts
async bilateral(
  pixels: Uint8Array,
  width: number,
  height: number,
  radius: number,       // 1–20
  sigmaSpatial: number, // equals radius (f32)
  sigmaColor: number,   // colorSigma / 255.0 (f32)
): Promise<Uint8Array>
```

**Parameter buffer construction** (mixed types — use `DataView`):
```ts
const buf = new ArrayBuffer(16)
const dv  = new DataView(buf)
dv.setUint32(0,   radius,       true)
dv.setUint32(4,   0,            true)
dv.setFloat32(8,  sigmaSpatial, true)
dv.setFloat32(12, sigmaColor,   true)
const paramsBuf = createUniformBuffer(device, 16)
writeUniformBuffer(device, paramsBuf, buf)
```

**Texture layout**:
- `srcTex`: `rgba8unorm`, `TEXTURE_BINDING | COPY_DST`
- `outTex`: `rgba8unorm`, `STORAGE_BINDING | COPY_SRC`
- No intermediate texture required.

**Dispatch**:
```ts
pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
```

### Module-level export

```ts
export async function bilateral(
  pixels: Uint8Array,
  width: number,
  height: number,
  radius: number,
  sigmaSpatial: number,
  sigmaColor: number,
): Promise<Uint8Array> {
  return _engine!.bilateral(pixels, width, height, radius, sigmaSpatial, sigmaColor)
}
```

### Dialog → engine parameter mapping

```ts
// In BilateralFilterDialog's runPreview / handleApply:
const sigmaSpatial = spatialRadius                    // f32: 1.0–20.0
const sigmaColor   = colorSigma / 255.0               // f32: ~0.004–0.588
await bilateral(pixels, w, h, spatialRadius, sigmaSpatial, sigmaColor)
```

Import in dialog: `import { bilateral } from '@/webgpu/filterCompute'`

---

## Dialog Component

**File**: `src/components/dialogs/BilateralFilterDialog/BilateralFilterDialog.tsx`

**Pattern**: Two-control variant — follows `UnsharpMaskDialog` as the template (multiple state fields, refs for each, sync'd refs for use inside the async `runPreview` callback).

**Props interface**:
```ts
export interface BilateralFilterDialogProps {
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
const MIN_SPATIAL_RADIUS     = 1
const MAX_SPATIAL_RADIUS     = 20
const DEFAULT_SPATIAL_RADIUS = 5

const MIN_COLOR_SIGMA        = 1
const MAX_COLOR_SIGMA        = 150
const DEFAULT_COLOR_SIGMA    = 25

const DEBOUNCE_MS            = 25
```

**State + refs** (following `UnsharpMaskDialog` pattern for multi-field debounced preview):
```ts
const [spatialRadius, setSpatialRadius] = useState(DEFAULT_SPATIAL_RADIUS)
const [colorSigma,    setColorSigma]    = useState(DEFAULT_COLOR_SIGMA)
const spatialRadiusRef = useRef(DEFAULT_SPATIAL_RADIUS)
const colorSigmaRef    = useRef(DEFAULT_COLOR_SIGMA)
```

`runPreview` reads from refs to avoid stale closure issues — identical to `UnsharpMaskDialog.runPreview`.

**Preview call**:
```ts
const sigS   = spatialRad                   // equals spatial radius
const sigC   = colSig / 255.0
const result = await bilateral(original.slice(), canvasWidth, canvasHeight,
                                spatialRad, sigS, sigC)
const composed = applySelectionComposite(result, original, selectionMaskRef.current)
handle.writeLayerPixels(activeLayerId, composed)
```

**Apply history label**: `'Bilateral Filter'`

**SCSS**: `BilateralFilterDialog.module.scss` — two-row layout, each row: label + slider + numeric input. Follow `UnsharpMaskDialog.module.scss`.

---

## Filter Registration

**`src/filters/registry.ts`** — append after `median-filter` in the `noise` group:

```ts
{ key: 'bilateral-filter', label: 'Bilateral…', group: 'noise' },
```

---

## `useFilters.ts` Changes

Add to `UseFiltersReturn`:
```ts
handleOpenBilateralFilter: () => void
```

Add implementation:
```ts
const handleOpenBilateralFilter = useCallback(
  () => onOpenFilterDialog('bilateral-filter'),
  [onOpenFilterDialog]
)
```

---

## `App.tsx` Changes

```ts
const [isBilateralFilterOpen, setIsBilateralFilterOpen] = useState(false)
```

In `handleOpenFilterDialog`:
```ts
case 'bilateral-filter': setIsBilateralFilterOpen(true); break
```

Render:
```tsx
<BilateralFilterDialog
  isOpen={isBilateralFilterOpen}
  onClose={() => setIsBilateralFilterOpen(false)}
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
export { BilateralFilterDialog } from './dialogs/BilateralFilterDialog/BilateralFilterDialog'
export type { BilateralFilterDialogProps } from './dialogs/BilateralFilterDialog/BilateralFilterDialog'
```

---

## Architectural Constraints

- **No WASM, no CPU fallback.** The shader is the sole execution path.
- **`layout: 'auto'`** — all three bindings must be referenced in the shader; unused bindings are stripped by the driver.
- **Mixed `u32`/`f32` params struct** — use `ArrayBuffer + DataView`, not `Uint32Array` (same pattern as `radialBlur` and `motionBlur`). The WGSL struct layout places `sigmaSpatial` and `sigmaColor` at byte offsets 8 and 12, which are `f32`. If `Uint32Array` were used to write these, the float bit patterns would be misinterpreted.
- **`rgba8unorm` output** — single-pass, no intermediate texture.
- **Alpha preservation** — `center.a` is passed through without modification.
- **Dialog is a dialog component** — accesses props and calls `bilateral()` only; must not read `AppContext` directly.

---

## Open Questions

1. **Colour sigma interpretation**: The current design divides the UI value by 255 to map to texel range (0–1). An alternative is to work in 0–255 space throughout (multiply neighbour and centre values by 255 before computing the difference). The 0–1 formulation is consistent with how the GPU naturally interprets `rgba8unorm` and is preferred.
2. **Radius 20 performance**: 1,681 `textureLoad` calls per invocation at radius 20. On lower-end integrated GPUs this may produce preview latency above the acceptable threshold. Consider capping the preview-time radius (e.g., max 10 for preview, full radius on Apply) if profiling shows issues. This would be a dialog-level concern, not a shader concern.
3. **Uniform-colour regions and very low Color Sigma**: With colorSigma = 1, `sigmaColor ≈ 0.004`. In near-uniform-colour regions, even small quantisation differences between texels (from `rgba8unorm` 8-bit precision) can drive colour weights to near-zero for some neighbours, potentially leaving the centre pixel nearly unchanged. This may be the desired behaviour (minimal effect) but should be validated visually.
