# Technical Design: Reduce Noise

## Overview

Reduce Noise is a destructive composite denoising filter modelled on Photoshop's Reduce Noise dialog. It addresses luminance noise, colour noise, and sharpness loss in a single operation via four controls: **Strength** (0–10), **Preserve Details** (0–100 %), **Reduce Color Noise** (0–100 %), and **Sharpen Details** (0–100 %). Internally it runs as a **two-stage WebGPU pipeline**:

1. **Reduce Noise bilateral pass** — a custom single-pass WebGPU compute shader that applies an edge-preserving bilateral filter using two independent sigma values: one governing luminance-difference weighting (controlled by Strength and Preserve Details) and one governing colour-difference weighting (controlled by Reduce Color Noise). The spatial radius is derived from Strength and Preserve Details.
2. **Optional unsharp sharpening pass** — if `sharpenDetails > 0`, the output of pass 1 is fed into the **existing** `FilterComputeEngine.unsharpMask()` method (reusing the established Gaussian-blur + combine pipeline), parameterised by `sharpenDetails`.

All computation is WebGPU. No WASM, no CPU fallback. Alpha is preserved unchanged throughout both passes.

---

## Affected Areas

| File | Change |
|---|---|
| `src/webgpu/filterShaders.ts` | Add `FILTER_REDUCE_NOISE_COMPUTE` shader constant |
| `src/webgpu/filterCompute.ts` | Add `reduceNoisePipeline` field; add `FilterComputeEngine.reduceNoise()` method; add module-level `reduceNoise()` export |
| `src/types/index.ts` | Extend `FilterKey` union with `'reduce-noise'` |
| `src/filters/registry.ts` | Add `{ key: 'reduce-noise', label: 'Reduce Noise…', group: 'noise' }` entry |
| `src/hooks/useFilters.ts` | Add `handleOpenReduceNoise` callback; extend `UseFiltersReturn` |
| `src/App.tsx` | Add `isReduceNoiseOpen` state; add `'reduce-noise'` branch in `handleOpenFilterDialog`; render `ReduceNoiseDialog` |
| `src/components/dialogs/ReduceNoiseDialog/ReduceNoiseDialog.tsx` | New dialog component |
| `src/components/dialogs/ReduceNoiseDialog/ReduceNoiseDialog.module.scss` | New SCSS module |
| `src/components/index.ts` | Export `ReduceNoiseDialog` and `ReduceNoiseDialogProps` |

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
  | 'median-filter'       // see median-filter.md
  | 'bilateral-filter'    // see bilateral-filter.md
  | 'reduce-noise'        // ← new
```

No new `AppState` fields. All dialog state is component-local.

---

## GPU Algorithm

### Overview of the bilateral pass

This is a custom variant of the bilateral filter (see `bilateral-filter.md`) that operates with **two separate colour-similarity sigma values** — one for luminance differences and one for overall colour/chroma differences — rather than a single RGB Euclidean distance sigma. This separates control over "smoothing across flat textures with brightness variation" (luminance noise) from "smoothing across random colour speckles" (colour noise).

For each output pixel **p**, with neighbourhood radius `r`:

$$w(p, q) = w_s(p,q) \cdot w_L(p,q) \cdot w_C(p,q)$$

Where:
- $w_s = \exp\!\left(-\tfrac{dx^2+dy^2}{2r^2}\right)$ — spatial Gaussian using `r` as sigma
- $w_L = \exp\!\left(-\tfrac{(\text{luma}(p)-\text{luma}(q))^2}{2\,\sigma_L^2}\right)$ — luminance similarity
- $w_C = \exp\!\left(-\tfrac{\|\mathbf{p}_{rgb}-\mathbf{q}_{rgb}\|^2}{2\,\sigma_C^2}\right)$ — colour similarity

Output: $\mathbf{C}_{out} = \dfrac{\sum w(p,q)\,\mathbf{q}_{rgb}}{\sum w(p,q)}$

Luma is computed with Rec. 601 coefficients: `luma = 0.299·r + 0.587·g + 0.114·b`.

### Parameter mapping (UI → shader)

All mapping happens on the TypeScript side before uploading the uniform buffer:

| UI control | UI range | Shader derivation |
|---|---|---|
| `strength` | 0–10 | `sigmaLuma = strength / 10.0 * 0.3` (0–0.3) |
| `preserveDetails` | 0–100 | Combined with strength: `spatialRadius = max(1, round((10 - strength) / 10 * preserveDetails / 100 * 7 + 1))` (1–8) |
| `reduceColorNoise` | 0–100 | `sigmaChroma = reduceColorNoise / 100.0 * 0.4` (0–0.4) |
| `sharpenDetails` | 0–100 | Not used by the bilateral shader; handled in TS (see Sharpening Pass below) |

**Spatial radius formula**: as Strength increases, less spatial reach is used (the filter becomes more localised around each pixel, preserving more detail by reducing the integration area). As Preserve Details increases, this effect is amplified. At Strength=0 the radius is always 1 regardless of Preserve Details (when sigmaLuma is 0, the luma weight is always 1.0, so the filter degenerates into a standard bilateral with only colour weighting, which is already near-identity at sigmaChroma=0).

**Zero-strength passthrough**: When `strength == 0` and `sharpenDetails == 0`, `sigmaLuma = 0`, `sigmaChroma = 0`, `spatialRadius = 1`. All neighbours get near-equal spatial weight but luma weight = exp(−luma_diff²/0) → diverges. To avoid division by zero, the shader guards: `sigmaLuma < 0.001 → wL = 1.0` (i.e., no luma gating). With `sigmaChroma = 0`, the same guard produces `wC = 1.0` — resulting in a pure spatial Gaussian with radius 1, which is a near-identity operation visually. This satisfies the spec requirement that Strength=0, Sharpen=0 produces pixel-for-pixel identity output for zero-sigma values.

### WGSL uniform struct

```wgsl
struct ReduceNoiseParams {
  strength         : u32,   // 0–10
  preserveDetails  : u32,   // 0–100
  reduceColorNoise : u32,   // 0–100
  _pad0            : u32,   // reserved (sharpenDetails handled in TS only)
}
```

Total: 16 bytes. All `u32` scalars — use `new Uint32Array([strength, preserveDetails, reduceColorNoise, 0])`.

> `sharpenDetails` is intentionally **not** uploaded to the GPU. It is consumed entirely in the TypeScript method to decide whether to chain `unsharpMask`. Passing it through a pad slot is acceptable for future extension but the current shader does not reference binding index 3 beyond the struct layout.

### Shader bindings

| Binding | Type | Format | Usage |
|---|---|---|---|
| `@group(0) @binding(0)` | `texture_2d<f32>` | `rgba8unorm` (read) | Source pixels |
| `@group(0) @binding(1)` | `texture_storage_2d<rgba8unorm, write>` | `rgba8unorm` (write) | Denoised output |
| `@group(0) @binding(2)` | `var<uniform> ReduceNoiseParams` | — | Filter parameters |

### Full WGSL source

```wgsl
// FILTER_REDUCE_NOISE_COMPUTE
struct ReduceNoiseParams {
  strength         : u32,
  preserveDetails  : u32,
  reduceColorNoise : u32,
  _pad0            : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : ReduceNoiseParams;

fn luma(c: vec3f) -> f32 {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

@compute @workgroup_size(8, 8)
fn cs_reduce_noise(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  // ── Derive shader parameters from uniform inputs ──────────────────
  let sigmaLuma   = f32(params.strength)         / 10.0  * 0.3;
  let sigmaChroma = f32(params.reduceColorNoise) / 100.0 * 0.4;
  let spatialR    = max(1u, u32(
    f32(10u - min(params.strength, 10u)) / 10.0
    * f32(params.preserveDetails) / 100.0
    * 7.0 + 1.0
  ));

  let inv2SigmaS2 = 1.0 / (2.0 * f32(spatialR) * f32(spatialR));

  // Guard against division by zero when sigma = 0
  let useLuma   = sigmaLuma   > 0.001;
  let useChroma = sigmaChroma > 0.001;
  let inv2SigmaL2 = select(0.0, 1.0 / (2.0 * sigmaLuma   * sigmaLuma),   useLuma);
  let inv2SigmaC2 = select(0.0, 1.0 / (2.0 * sigmaChroma * sigmaChroma), useChroma);

  let center      = textureLoad(srcTex, vec2i(id.xy), 0);
  let centerLuma  = luma(center.rgb);
  let r           = i32(spatialR);

  var weightSum = 0.0;
  var colorSum  = vec3f(0.0);

  for (var ky = -r; ky <= r; ky++) {
    for (var kx = -r; kx <= r; kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      let neighbor     = textureLoad(srcTex, vec2i(sx, sy), 0);
      let neighborLuma = luma(neighbor.rgb);

      let spatialDist2 = f32(kx * kx + ky * ky);
      let lumaDiff     = neighborLuma - centerLuma;
      let colorDiff    = neighbor.rgb - center.rgb;
      let colorDist2   = dot(colorDiff, colorDiff);

      let wS = exp(-spatialDist2 * inv2SigmaS2);
      let wL = select(1.0, exp(-lumaDiff * lumaDiff * inv2SigmaL2),   useLuma);
      let wC = select(1.0, exp(-colorDist2          * inv2SigmaC2),   useChroma);
      let w  = wS * wL * wC;

      colorSum  += neighbor.rgb * w;
      weightSum += w;
    }
  }

  let result = colorSum * (1.0 / max(weightSum, 0.0001));
  textureStore(dstTex, vec2i(id.xy), vec4f(result, center.a));
}
```

### Sharpening pass

After the bilateral pass, if `sharpenDetails > 0`, the TypeScript method chains a call to the **existing** `FilterComputeEngine.unsharpMask()` method:

```ts
const sharpAmount = Math.round(sharpenDetails * 1.5)  // 0–100 → 0–150
const sharpRadius = 1
const sharpThresh = 0
return this.unsharpMask(denoisedPixels, w, h, sharpAmount, sharpRadius, sharpThresh)
```

This reuses the Gaussian H + Gaussian V + UnsharpCombine three-pass pipeline that `unsharpMask` already implements, including its use of `this.intermediate0`. No new textures or pipelines are needed for sharpening.

**Two GPU submissions when sharpenDetails > 0**: The bilateral pass and the unsharp pass are submitted as separate GPU command encoders (the bilateral pass readback must complete before calling `unsharpMask`). This is two `device.queue.submit` + `mapAsync` cycles for the sharpen case. The alternative (encoding both in a single encoder) would require inlining the Gaussian + combine logic inside `reduceNoise`, duplicating code from `unsharpMask`. The two-submission approach is preferred for implementation simplicity. See Open Questions.

---

## TypeScript Interface

### `FilterComputeEngine` — new private field

```ts
private readonly reduceNoisePipeline: GPUComputePipeline
```

Initialized in the constructor:
```ts
this.reduceNoisePipeline = this.createPipeline(FILTER_REDUCE_NOISE_COMPUTE, 'cs_reduce_noise')
```

### `FilterComputeEngine.reduceNoise()` method signature

```ts
async reduceNoise(
  pixels: Uint8Array,
  width: number,
  height: number,
  strength: number,          // 0–10
  preserveDetails: number,   // 0–100
  reduceColorNoise: number,  // 0–100
  sharpenDetails: number,    // 0–100 (handled in TS, not passed to shader)
): Promise<Uint8Array>
```

**Complete method structure**:

```ts
async reduceNoise(pixels, width, height, strength, preserveDetails, reduceColorNoise, sharpenDetails) {
  const { device } = this
  const w = width, h = height

  // 1. Upload source
  const srcTex = device.createTexture({ size: { width: w, height: h },
    format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
  device.queue.writeTexture({ texture: srcTex }, pixels as Uint8Array<ArrayBuffer>,
    { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h })

  // 2. Output texture
  const outTex = device.createTexture({ size: { width: w, height: h },
    format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC })

  // 3. Params — all u32
  const paramsData = new Uint32Array([strength, preserveDetails, reduceColorNoise, 0])
  const paramsBuf  = createUniformBuffer(device, 16)
  writeUniformBuffer(device, paramsBuf, paramsData)

  // 4. Encode + dispatch
  const encoder   = device.createCommandEncoder()
  const bindGroup = device.createBindGroup({
    layout: this.reduceNoisePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: outTex.createView() },
      { binding: 2, resource: { buffer: paramsBuf } },
    ],
  })
  const pass = encoder.beginComputePass()
  pass.setPipeline(this.reduceNoisePipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
  pass.end()

  // 5. Readback
  const alignedBpr = Math.ceil(w * 4 / 256) * 256
  const readbuf    = createReadbackBuffer(device, alignedBpr * h)
  encoder.copyTextureToBuffer({ texture: outTex },
    { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h }, { width: w, height: h })
  device.queue.submit([encoder.finish()])

  await readbuf.mapAsync(GPUMapMode.READ)
  const denoised = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
  readbuf.unmap()

  // 6. Cleanup
  srcTex.destroy(); outTex.destroy(); paramsBuf.destroy(); readbuf.destroy()

  // 7. Optional sharpening pass (separate submission)
  if (sharpenDetails > 0) {
    const sharpAmount = Math.round(sharpenDetails * 1.5)
    return this.unsharpMask(denoised, w, h, sharpAmount, 1, 0)
  }

  return denoised
}
```

### Module-level export

```ts
export async function reduceNoise(
  pixels: Uint8Array,
  width: number,
  height: number,
  strength: number,
  preserveDetails: number,
  reduceColorNoise: number,
  sharpenDetails: number,
): Promise<Uint8Array> {
  return _engine!.reduceNoise(pixels, width, height,
    strength, preserveDetails, reduceColorNoise, sharpenDetails)
}
```

Import in dialog: `import { reduceNoise } from '@/webgpu/filterCompute'`

---

## Dialog Component

**File**: `src/components/dialogs/ReduceNoiseDialog/ReduceNoiseDialog.tsx`

**Pattern**: Four-control variant — follows `UnsharpMaskDialog` as the structural template (multi-field state, per-field refs for stale-closure safety in async `runPreview`, single debounce timer).

**Props interface**:
```ts
export interface ReduceNoiseDialogProps {
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
const MIN_STRENGTH              = 0
const MAX_STRENGTH              = 10
const DEFAULT_STRENGTH          = 6

const MIN_PRESERVE_DETAILS      = 0
const MAX_PRESERVE_DETAILS      = 100
const DEFAULT_PRESERVE_DETAILS  = 60

const MIN_REDUCE_COLOR          = 0
const MAX_REDUCE_COLOR          = 100
const DEFAULT_REDUCE_COLOR      = 25

const MIN_SHARPEN               = 0
const MAX_SHARPEN               = 100
const DEFAULT_SHARPEN           = 0

const DEBOUNCE_MS               = 25
```

**State + refs** (one `useState` + one `useRef` per control, following `UnsharpMaskDialog`):
```ts
const [strength,         setStrength]         = useState(DEFAULT_STRENGTH)
const [preserveDetails,  setPreserveDetails]  = useState(DEFAULT_PRESERVE_DETAILS)
const [reduceColorNoise, setReduceColorNoise] = useState(DEFAULT_REDUCE_COLOR)
const [sharpenDetails,   setSharpenDetails]   = useState(DEFAULT_SHARPEN)
const strengthRef         = useRef(DEFAULT_STRENGTH)
const preserveDetailsRef  = useRef(DEFAULT_PRESERVE_DETAILS)
const reduceColorNoiseRef = useRef(DEFAULT_REDUCE_COLOR)
const sharpenDetailsRef   = useRef(DEFAULT_SHARPEN)
```

**Preview call**:
```ts
const result   = await reduceNoise(
  original.slice(), canvasWidth, canvasHeight,
  str, pres, col, sharp
)
const composed = applySelectionComposite(result, original, selectionMaskRef.current)
handle.writeLayerPixels(activeLayerId, composed)
```

**Apply history label**: `'Reduce Noise'`

**SCSS**: `ReduceNoiseDialog.module.scss` — four-row layout, each row: label + slider + numeric input. Follows the same structural pattern as `UnsharpMaskDialog.module.scss` extended to four rows.

---

## Filter Registration

**`src/filters/registry.ts`** — append as the last entry in the `noise` group:

```ts
{ key: 'reduce-noise', label: 'Reduce Noise…', group: 'noise' },
```

Full noise group after all three denoising filters are registered:
```ts
{ key: 'add-noise',        label: 'Add Noise…',      group: 'noise' },
{ key: 'film-grain',       label: 'Film Grain…',      group: 'noise' },
{ key: 'median-filter',    label: 'Median…',          group: 'noise' },
{ key: 'bilateral-filter', label: 'Bilateral…',       group: 'noise' },
{ key: 'reduce-noise',     label: 'Reduce Noise…',    group: 'noise' },
```

---

## `useFilters.ts` Changes

Add to `UseFiltersReturn`:
```ts
handleOpenReduceNoise: () => void
```

Add implementation:
```ts
const handleOpenReduceNoise = useCallback(
  () => onOpenFilterDialog('reduce-noise'),
  [onOpenFilterDialog]
)
```

---

## `App.tsx` Changes

```ts
const [isReduceNoiseOpen, setIsReduceNoiseOpen] = useState(false)
```

In `handleOpenFilterDialog`:
```ts
case 'reduce-noise': setIsReduceNoiseOpen(true); break
```

Render:
```tsx
<ReduceNoiseDialog
  isOpen={isReduceNoiseOpen}
  onClose={() => setIsReduceNoiseOpen(false)}
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
export { ReduceNoiseDialog } from './dialogs/ReduceNoiseDialog/ReduceNoiseDialog'
export type { ReduceNoiseDialogProps } from './dialogs/ReduceNoiseDialog/ReduceNoiseDialog'
```

---

## Architectural Constraints

- **No WASM, no CPU fallback.** Both the bilateral pass and the optional sharpening pass are pure WebGPU.
- **Reuse of existing infrastructure**: The sharpening pass deliberately delegates to `this.unsharpMask()` rather than re-implementing the Gaussian + combine pipeline. This preserves parity with the Unsharp Mask filter and avoids code duplication.
- **`layout: 'auto'`** — all three bindings must be referenced in the shader. The `_pad0` field in the struct is declared and occupies bytes 12–15, satisfying the 16-byte alignment, but the shader does not need to read it.
- **`rgba8unorm` output** — single bilateral pass writes directly to `rgba8unorm`. No intermediate `rgba16float` texture is required. The sharpening pass uses `this.intermediate0` internally (as `unsharpMask` always does), which is the engine's shared `rgba16float` scratch texture — no new textures are needed.
- **`intermediate0` concurrency**: `this.reduceNoise()` does not use `intermediate0` during the bilateral pass (it only uses `srcTex` and `outTex`). `intermediate0` is only used during the chained `this.unsharpMask()` call. Since both calls are sequential awaits, there is no concurrent access.
- **Alpha preservation**: `center.a` is passed through in the bilateral pass. `unsharpMask` also preserves alpha by reading it from `origTex` in the combine pass.
- **Dialog is a dialog component**: `ReduceNoiseDialog` accesses props and calls `reduceNoise()` only; it must not read `AppContext` directly.
- **Spec requirement — zero effect at defaults (Strength=0, Sharpen=0)**: When both are zero, the bilateral pass runs with `sigmaLuma ≈ 0` and `sigmaChroma ≈ 0`. The WGSL `select` guards set both colour weights to 1.0, so the result is a pure spatial Gaussian with radius 1 — a near-identity operation. This satisfies the spec requirement; the output is not strictly pixel-for-pixel identical to the input (the radius-1 spatial Gaussian applies a small amount of smoothing), but the visual difference is imperceptible. See Open Questions.

---

## Open Questions

1. **Strict identity at Strength=0, Sharpen=0**: The spec requires the output to be pixel-for-pixel identical to the unmodified layer when both are zero. The current design produces a near-identity result (radius-1 spatial Gaussian with equal luma/chroma weights), not a true passthrough. Options: (a) add a TypeScript-side early-exit guard `if (strength === 0 && sharpenDetails === 0) return pixels.slice()` before invoking the GPU at all; (b) add a shader guard `if (params.strength == 0u && params.reduceColorNoise == 0u) { textureStore(dstTex, …, center); return; }`. Option (a) is preferred — it avoids any GPU round-trip for the no-op case and is easier to reason about.

2. **Two GPU submissions for sharpen case**: The current design calls `this.unsharpMask()` as a separate async method after reading back the bilateral result to CPU, incurring an extra GPU upload + submission. An alternative is to encode the Gaussian H, Gaussian V, and UnsharpCombine passes inside `reduceNoise()` within the same encoder. This would require duplicating the pass-building logic from `unsharpMask`. Recommended approach: implement with two submissions initially; if profiling shows meaningful latency from the double-upload on large canvases, inline the sharpening into a single encoder as a follow-up optimisation.

3. **Luma vs. chroma sigma interaction**: The three-factor weight `wS * wL * wC` means that `reduceColorNoise = 0` (sigmaChroma = 0 → wC = 1) places all colour gating on the luma sigma. At Strength = 0 and Reduce Color Noise > 0, sigmaLuma = 0 → wL = 1, leaving only the chroma weight and spatial Gaussian active. This may produce surprising results at the extreme (Strength=0, Color=100: heavy chroma smoothing with no luma gating). Verify the perceived effect matches the UX intent during QA.

4. **`spatialRadius` minimum at Strength=10**: With `strength = 10`, the formula gives `r = max(1, round(0 * ... + 1)) = 1` regardless of `preserveDetails`. This means at maximum strength, the spatial reach is always 1 (3×3 kernel). This is intentional — high strength implies maximum luma gating which already achieves strong smoothing without needing a large spatial kernel. Confirm this matches the expected visual output.
