# Technical Design: Reduce Colors

## Overview

Reduce Colors is a non-destructive child adjustment layer that constrains the visible color range of a pixel layer to a fixed set of colors. It has two modes: **Reduce to N Colors** derives N representative colors from the parent layer's pixel data using WASM median-cut, then remaps every pixel to its nearest match; **Map to Palette** remaps every pixel to the nearest color in the live global swatch palette. Nearness is always measured in OKLab space. The GPU remapping pass runs as a WebGPU compute shader; no source pixels are ever modified.

This design builds on the same infrastructure used by all other adjustment children — `UPDATE_ADJUSTMENT_LAYER`, `AdjustmentPanel`, `useAdjustments`, `buildRenderPlan` / `buildAdjustmentEntry`, the `adjustment-group` compositing model, `adjustmentMaskMap`, and the `hasMask` pattern. Two things are genuinely new: (1) an async WASM-driven pre-computation step that deposits a derived palette back into params, and (2) the swatch palette must be read from live global state at plan-build time and injected into the render op as a GPU storage buffer.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'reduce-colors'` to `AdjustmentType`; add `'reduce-colors'` entry to `AdjustmentParamsMap`; add `ReduceColorsAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Add `'reduce-colors'` entry to `ADJUSTMENT_REGISTRY` with default params |
| `src/webgpu/shaders/adjustments/helpers.ts` | Add `OKLAB_HELPERS` WGSL constant (sRGB ↔ linear ↔ OKLab conversion functions) |
| `src/webgpu/shaders/adjustments/reduce-colors.ts` | **New file.** `RC_COMPUTE` WGSL compute shader constant |
| `src/webgpu/shaders.ts` | Add `export { RC_COMPUTE } from './shaders/adjustments/reduce-colors'` |
| `src/webgpu/utils.ts` | Add `createStorageBuffer(device, size)` helper |
| `src/webgpu/WebGPURenderer.ts` | Add `'reduce-colors'` variant to `AdjustmentRenderOp`; add `rcPipeline: GPUComputePipeline`; add `encodeReduceColorsPass()` private method; extend `encodeAdjustmentOp()` dispatch |
| `src/components/window/Canvas/canvasPlan.ts` | Add `swatches: RGBAColor[]` parameter to `buildRenderPlan` and `buildAdjustmentEntry`; add `'reduce-colors'` case to `buildAdjustmentEntry` |
| `src/components/window/Canvas/Canvas.tsx` | Pass `state.swatches` to `buildCanvasRenderPlan`; add `useEffect([state.swatches, isActive])` that calls `doRender()` |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `'reduce-colors'` to `adjustmentTitle`; add header icon; add icon dispatch case; add `ReduceColorsPanel` render branch with `canvasHandleRef` |
| `src/components/panels/ReduceColorsPanel/ReduceColorsPanel.tsx` | **New file.** Panel sub-component |
| `src/components/panels/ReduceColorsPanel/ReduceColorsPanel.module.scss` | **New file.** Scoped styles |
| `src/components/index.ts` | Add barrel export for `ReduceColorsPanel` |

No changes to `src/store/AppContext.tsx`, `src/hooks/useAdjustments.ts`, `src/App.tsx`, or `src/rasterization/` — the generic `UPDATE_ADJUSTMENT_LAYER` action, `buildRenderPlan` grouping logic, `GpuRasterPipeline`, and `readFlattenedPlan` carry the new op variant through automatically once the renderer dispatch is extended.

---

## State Changes

### `src/types/index.ts`

#### Extend `AdjustmentType`

```ts
export type AdjustmentType =
  | 'brightness-contrast'
  | 'hue-saturation'
  | 'color-vibrance'
  | 'color-balance'
  | 'black-and-white'
  | 'color-temperature'
  | 'color-invert'
  | 'selective-color'
  | 'curves'
  | 'color-grading'
  | 'reduce-colors'   // ← new
```

#### Extend `AdjustmentParamsMap`

```ts
'reduce-colors': {
  mode: 'reduce' | 'palette'
  /**
   * Number of target colors for mode='reduce'. Range 2–256. Default 16.
   * Has no effect in mode='palette'.
   */
  colorCount: number
  /**
   * Derived palette computed by WASM median-cut for the current colorCount.
   * null until the first quantization completes after layer creation or colorCount change.
   * Stored here (not in a side-channel ref) so it survives history serialization.
   * Each entry is an RGBA color in sRGB [0..255].
   * Has no effect in mode='palette'.
   */
  derivedPalette: RGBAColor[] | null
}
```

#### New layer interface

```ts
export interface ReduceColorsAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'reduce-colors'
  params: AdjustmentParamsMap['reduce-colors']
  /** True when a selection was active at creation time; baked mask pixels live in Canvas adjustmentMaskMap. */
  hasMask: boolean
}
```

#### Extend `AdjustmentLayerState` union

```ts
export type AdjustmentLayerState =
  | BrightnessContrastAdjustmentLayer
  // ...existing...
  | ColorGradingAdjustmentLayer
  | ReduceColorsAdjustmentLayer  // ← new
```

---

## New Components / Hooks / Tools

### `src/components/panels/ReduceColorsPanel/ReduceColorsPanel.tsx` — Panel

**Category:** Panel (reads `AppContext` directly; dispatches `UPDATE_ADJUSTMENT_LAYER`).

**Single responsibility:** Render the mode toggle, N slider / numeric input (mode='reduce'), or palette count label / inline warning (mode='palette'). Trigger async quantization when `colorCount` or the parent layer identity changes while mode='reduce'.

**Props:**
```ts
interface ReduceColorsPanelProps {
  layer: ReduceColorsAdjustmentLayer
  parentLayerName: string
  canvasHandleRef: React.RefObject<CanvasHandle | null>
}
```

**Behaviour:**
- Reads `state.swatches` from `useAppContext()` to display the live palette count in mode='palette'. No direct GPU interaction.
- Maintains a `isQuantizing` local state (`useState<boolean>`) so the UI can show a "Computing…" hint during async derivation.
- `useEffect([layer.id, layer.params.mode, layer.params.colorCount])`: when these change **and** mode='reduce', re-runs quantization (described in Implementation Steps).
- Does **not** call `doRender()` directly — dispatching `UPDATE_ADJUSTMENT_LAYER` with the new `derivedPalette` triggers the Canvas `state.layers` effect which calls `doRender()`.

---

## Key Design Decisions

### Decision 1 — Mode 1 quantization: WASM CPU, not GPU

The existing `quantize(pixels, maxColors)` in `src/wasm/index.ts` implements median-cut and returns an RGBA sRGB palette. This is reused for color derivation.

Median-cut operates in sRGB, but the spec mandates OKLab perceptual distance for the **remapping** step. Using median-cut for derivation is an acceptable pragmatic choice (the spec acknowledges this): the derived colors are representative in sRGB volume-split terms, while the final nearest-color assignment uses OKLab distance — this delivers perceptually balanced output without requiring a full GPU k-means implementation.

The derived palette is stored in `params.derivedPalette` (sRGB `RGBAColor[]`) and converted to OKLab `Float32Array` at plan-build time by `buildAdjustmentEntry`, so the conversion is done once per plan rebuild and never inside the shader.

### Decision 2 — Palette stored in params, not a side-channel map

The derived palette is stored in `params.derivedPalette` rather than a ref-held side-channel (like `adjustmentMaskMap`) for the following reasons:
- It participates in undo/redo naturally (history serializes params).
- It persists when the panel is closed and reopened — no need to re-derive on reopen.
- It is deterministic given `(source pixels + colorCount)`, so the only trigger for re-derivation is a `colorCount` change or an upstream pixel edit.

The `derivedPalette` is `null` on first creation. The GPU pass emits a passthrough (no-op) when `paletteCount == 0`, so the canvas renders the unmodified parent while quantization runs in the background.

### Decision 3 — Live swatch reactivity via plan-build-time injection

For mode='palette', the swatch palette is **not** stored in the adjustment layer's params — it is always the live `state.swatches` array at render time. This matches the spec requirement that palette changes while the panel is closed are still reflected on the next render.

The palette is injected into the `AdjustmentRenderOp` at plan-build time:
- `buildRenderPlan` and `buildAdjustmentEntry` gain a new `swatches: RGBAColor[]` parameter.
- `Canvas.tsx` passes `state.swatches` when calling `buildCanvasRenderPlan`.
- `Canvas.tsx` adds a new `useEffect([state.swatches, isActive])` that calls `doRender()` so any swatch change causes an immediate re-render regardless of whether any panel is open.

### Decision 4 — Storage buffer for the palette (not a uniform array)

The palette has a variable length (2–256 entries). A WGSL `var<uniform>` requires a statically-sized struct; using a `var<storage, read>` binding with a runtime-sized `array<vec4f>` is the correct pattern. Each `vec4f` stores `(L, a, b, _unused)` in OKLab. Max 256 entries × 16 bytes = 4096 bytes.

Because of the extra storage binding (#5), the generic `encodeComputePassRaw` helper cannot be used for this pass. A dedicated `encodeReduceColorsPass()` private method is added to `WebGPURenderer`.

---

## GPU Buffer Layout

### Uniform buffer — `RCParams` (binding 2)

```
Offset  Size  Field
     0     4  paletteCount: u32   — actual number of valid palette entries (0 = passthrough)
     4    12  _pad: vec3u
────────────────────
Total: 16 bytes
```

### Storage buffer — `palette` (binding 5, read-only)

```
Offset  Size  Field
     0    16  palette[0]: vec4f  — (L: f32, a: f32, b: f32, _unused: f32) in OKLab
    16    16  palette[1]: vec4f
   ...
 n*16    16  palette[n]: vec4f
────────────────────────────────────
Max entries: 256
Max total:   256 × 16 = 4096 bytes
```

OKLab convention: L ∈ [0, 1], a ∈ [−0.5, 0.5], b ∈ [−0.5, 0.5] (standard OKLab range at display brightness).

---

## WGSL Shader Outline — `RC_COMPUTE`

**File:** `src/webgpu/shaders/adjustments/reduce-colors.ts`

```wgsl
// OKLab helpers are included from helpers.ts (OKLAB_HELPERS).

struct RCParams {
  paletteCount : u32,
  _pad         : vec3u,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : RCParams;
@group(0) @binding(3) var selMask  : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;
@group(0) @binding(5) var<storage, read> palette : array<vec4f>;

@compute @workgroup_size(8, 8)
fn cs_reduce_colors(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);

  // Passthrough: fully transparent or no palette loaded yet
  if (src.a < 0.0001 || params.paletteCount == 0u) {
    textureStore(dstTex, coord, src);
    return;
  }

  // Convert source pixel to OKLab for perceptual nearest-colour search
  let srcLinear = srgb_to_linear(src.rgb);
  let srcLab    = linear_srgb_to_oklab(srcLinear);

  var bestIdx  : u32 = 0u;
  var bestDist : f32 = 1.0e30;
  for (var i: u32 = 0u; i < params.paletteCount; i++) {
    let pLab = palette[i].xyz;
    let d    = dot(srcLab - pLab, srcLab - pLab);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }

  // Convert winning palette entry back to sRGB
  let bestLinear = oklab_to_linear_srgb(palette[bestIdx].xyz);
  let bestSrgb   = linear_to_srgb(bestLinear);
  let adjusted   = vec4f(bestSrgb, src.a);

  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, adjusted, mask));
}
```

**OKLab helpers** to add to `src/webgpu/shaders/adjustments/helpers.ts` as `OKLAB_HELPERS`:

```wgsl
fn srgb_to_linear(c: vec3f) -> vec3f {
  return select(c / 12.92,
                pow((c + 0.055) / 1.055, vec3f(2.4)),
                c > vec3f(0.04045));
}
fn linear_to_srgb(c: vec3f) -> vec3f {
  return select(c * 12.92,
                1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055,
                c > vec3f(0.0031308));
}
fn linear_srgb_to_oklab(c: vec3f) -> vec3f {
  let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  let l_ = pow(max(l, 0.0), 1.0 / 3.0);
  let m_ = pow(max(m, 0.0), 1.0 / 3.0);
  let s_ = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3f(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  );
}
fn oklab_to_linear_srgb(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  return vec3f(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  );
}
```

---

## `AdjustmentRenderOp` Extension

Add to `WebGPURenderer.ts`:

```ts
| {
    kind: 'reduce-colors'
    layerId: string
    visible: boolean
    selMaskLayer?: GpuLayer
    /**
     * OKLab palette: 16 bytes per entry (vec4f: L, a, b, _unused).
     * Length = paletteCount * 16.  Pre-converted at plan-build time by buildAdjustmentEntry.
     */
    palette: Float32Array
    /** Number of valid entries in palette. 0 = adjustment is suspended (mode='palette' with < 2 swatches). */
    paletteCount: number
  }
```

---

## `buildAdjustmentEntry` Changes

In `src/components/window/Canvas/canvasPlan.ts`:

1. **New signature:**
   ```ts
   export function buildAdjustmentEntry(
     ls: AdjustmentLayerState,
     mask: GpuLayer | undefined,
     swatches: RGBAColor[],          // ← new
   ): AdjustmentRenderOp | null
   ```

2. **New case for `'reduce-colors'`:**
   ```ts
   if (ls.adjustmentType === 'reduce-colors') {
     const { mode, colorCount, derivedPalette } = ls.params

     let sourceColors: RGBAColor[]
     if (mode === 'reduce') {
       sourceColors = derivedPalette ?? []
     } else {
       // mode='palette': use live swatches; require ≥ 2
       sourceColors = swatches.length >= 2 ? swatches : []
     }

     const paletteCount = Math.min(sourceColors.length, 256)
     const palette = new Float32Array(256 * 4)  // 256 × vec4f
     for (let i = 0; i < paletteCount; i++) {
       const { r, g, b } = sourceColors[i]
       const lin = srgbByteToLinear(r, g, b)           // helper — see below
       const lab = linearSrgbToOklab(lin.r, lin.g, lin.b)  // helper — see below
       palette[i * 4 + 0] = lab.L
       palette[i * 4 + 1] = lab.a
       palette[i * 4 + 2] = lab.b
       palette[i * 4 + 3] = 0  // unused
     }

     return {
       kind: 'reduce-colors',
       layerId: ls.id,
       visible: ls.visible,
       selMaskLayer: mask,
       palette,
       paletteCount,
     }
   }
   ```

3. **Add two small pure-function helpers** (unexported, module-level) in `canvasPlan.ts` for the CPU-side OKLab conversion used above. These mirror the WGSL helpers but operate on JavaScript numbers so the conversion is authoritatively consistent between CPU plan-build and GPU shader:
   ```ts
   function srgbByteToLinear(r: number, g: number, b: number): { r: number; g: number; b: number } { ... }
   function linearSrgbToOklab(r: number, g: number, b: number): { L: number; a: number; b: number } { ... }
   ```

4. **Update `buildRenderPlan` signature** to accept `swatches` and thread it through to every `buildAdjustmentEntry` call:
   ```ts
   export function buildRenderPlan(
     layers: readonly LayerState[],
     glLayers: Map<string, GpuLayer>,
     maskMap: Map<string, GpuLayer>,
     adjustmentMaskMap: Map<string, GpuLayer>,
     bypassedAdjustmentIds: ReadonlySet<string>,
     swatches: RGBAColor[],           // ← new
   ): RenderPlanEntry[]
   ```

---

## Canvas.tsx Changes

Two changes in `src/components/window/Canvas/Canvas.tsx`:

1. **Pass swatches to plan builder** — update the `buildRenderPlan()` inner function:
   ```ts
   function buildRenderPlan(): RenderPlanEntry[] {
     const plan = buildCanvasRenderPlan(
       state.layers,
       glLayersRef.current,
       buildMaskMap(),
       adjustmentMaskMap.current,
       adjustmentPreviewStore.snapshot(),
       state.swatches,   // ← new
     )
     // ...existing pending layer append...
     return plan
   }
   ```

2. **Re-render on swatch changes** — add a new `useEffect` after the existing `state.layers` effect:
   ```ts
   useEffect(() => {
     if (!isActive) return
     doRender()
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [state.swatches, isActive])
   ```

---

## `ReduceColorsPanel` Behaviour

**Async quantization flow:**

```
User changes colorCount slider
    │
    ▼
ReduceColorsPanel useEffect fires
    │
    ├── setIsQuantizing(true)
    ├── pixels = canvasHandleRef.current?.getLayerPixels(layer.parentId)
    │   (synchronous — reads GpuLayer.data CPU-side mirror)
    │
    ├── quantize(pixels, colorCount)  ← async WASM call
    │
    ▼ (resolved)
    derivedPalette = Array.from each RGBA entry in result.palette
    dispatch(UPDATE_ADJUSTMENT_LAYER, { ...layer, params: { ...params, colorCount, derivedPalette } })
    setIsQuantizing(false)
    │
    ▼
Canvas useEffect([state.layers]) fires → doRender() → new GPU pass with updated palette
```

**Cancellation:** The `useEffect` cleanup sets a `cancelled` flag; if the async call completes after cleanup it does not dispatch.

**Mode toggle:** Switching mode dispatches `UPDATE_ADJUSTMENT_LAYER` immediately (synchronously). Switching to 'reduce' with a non-null `derivedPalette` re-renders immediately at the existing palette; quantization re-runs only if `colorCount` has also changed.

**Palette count label (mode='palette'):** Reads `state.swatches.length` from context. Reactive for free via normal React re-render on context change.

**Inline warning (mode='palette', swatches < 2):** Renders a `<p>` warning row; the Canvas renders passthrough because `paletteCount=0` in the op.

**`canvasHandleRef`** is threaded through `AdjustmentPanel` → `ReduceColorsPanel` (same pattern as `CurvesPanel`).

---

## `encodeReduceColorsPass` in `WebGPURenderer`

```ts
private encodeReduceColorsPass(
  encoder: GPUCommandEncoder,
  srcTex: GPUTexture,
  dstTex: GPUTexture,
  palette: Float32Array,
  paletteCount: number,
  selMaskLayer?: GpuLayer,
): void {
  const { device, pixelWidth: w, pixelHeight: h } = this

  // Params uniform (paletteCount + pad)
  const paramsBuf = createUniformBuffer(device, 16)
  const paramsData = new Uint32Array(4)
  paramsData[0] = paletteCount
  device.queue.writeBuffer(paramsBuf, 0, paramsData)

  // Palette storage buffer (always 256 * 16 bytes; unused tail is zeroed)
  const palBuf = createStorageBuffer(device, 256 * 16)
  device.queue.writeBuffer(palBuf, 0, palette)

  const maskFlagsData = new Uint32Array(8)
  maskFlagsData[0] = selMaskLayer ? 1 : 0
  const maskFlagsBuf = createUniformBuffer(device, 32)
  writeUniformBuffer(device, maskFlagsBuf, maskFlagsData)

  const dummyMask = selMaskLayer?.texture ?? srcTex

  const bindGroup = device.createBindGroup({
    layout: this.rcPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: dstTex.createView() },
      { binding: 2, resource: { buffer: paramsBuf } },
      { binding: 3, resource: dummyMask.createView() },
      { binding: 4, resource: { buffer: maskFlagsBuf } },
      { binding: 5, resource: { buffer: palBuf } },
    ],
  })

  const pass = encoder.beginComputePass()
  pass.setPipeline(this.rcPipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
  pass.end()

  this.pendingDestroyBuffers.push(paramsBuf, palBuf, maskFlagsBuf)
}
```

Add to `encodeAdjustmentOp` dispatch:
```ts
if (entry.kind === 'reduce-colors') {
  this.encodeReduceColorsPass(encoder, srcTex, dstTex, entry.palette, entry.paletteCount, entry.selMaskLayer)
  return
}
```

---

## `createStorageBuffer` in `utils.ts`

```ts
export function createStorageBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
}
```

---

## Implementation Steps

1. **`src/webgpu/shaders/adjustments/helpers.ts`** — append `OKLAB_HELPERS` WGSL constant containing the four conversion functions (`srgb_to_linear`, `linear_to_srgb`, `linear_srgb_to_oklab`, `oklab_to_linear_srgb`).

2. **`src/webgpu/shaders/adjustments/reduce-colors.ts`** — create file exporting `RC_COMPUTE`. Import `MASK_FLAGS_STRUCT` and `OKLAB_HELPERS` from `helpers.ts`. Implement `cs_reduce_colors` as outlined in the WGSL Shader Outline section.

3. **`src/webgpu/shaders.ts`** — add `export { RC_COMPUTE } from './shaders/adjustments/reduce-colors'`.

4. **`src/webgpu/utils.ts`** — add `createStorageBuffer`.

5. **`src/types/index.ts`** — add `'reduce-colors'` to `AdjustmentType`; add `'reduce-colors'` to `AdjustmentParamsMap`; add `ReduceColorsAdjustmentLayer`; extend `AdjustmentLayerState`.

6. **`src/adjustments/registry.ts`** — add entry:
   ```ts
   {
     adjustmentType: 'reduce-colors' as const,
     label: 'Reduce Colors…',
     defaultParams: { mode: 'reduce', colorCount: 16, derivedPalette: null },
   },
   ```

7. **`src/webgpu/WebGPURenderer.ts`**:
   - Import `RC_COMPUTE` and `createStorageBuffer`.
   - Add `'reduce-colors'` variant to `AdjustmentRenderOp` union.
   - Add `private readonly rcPipeline: GPUComputePipeline` field.
   - In the constructor, after the existing pipeline initialisations, add:
     `this.rcPipeline = this.createComputePipeline(RC_COMPUTE, 'cs_reduce_colors')`
   - Add `encodeReduceColorsPass()` private method.
   - Add the `'reduce-colors'` dispatch branch in `encodeAdjustmentOp()` (before the exhaustive check).

8. **`src/components/window/Canvas/canvasPlan.ts`**:
   - Add module-level `srgbByteToLinear` and `linearSrgbToOklab` pure helpers.
   - Add `swatches: RGBAColor[]` parameter to `buildAdjustmentEntry` and `buildRenderPlan`.
   - Add `'reduce-colors'` case to `buildAdjustmentEntry`.
   - Thread `swatches` through both `buildRenderPlan` call sites (inline standalone and adjustment-group child loop).

9. **`src/components/window/Canvas/Canvas.tsx`**:
   - Pass `state.swatches` to `buildCanvasRenderPlan` in the `buildRenderPlan()` inner function.
   - Add `useEffect([state.swatches, isActive])` that calls `doRender()`.

10. **`src/components/panels/ReduceColorsPanel/ReduceColorsPanel.tsx`** — create the panel component. Import `quantize` from `@/wasm`. Implement mode toggle, N slider (2–256, default 16) with synced numeric input, async quantization flow with cancellation guard, palette count label, and inline warning. Dispatch `UPDATE_ADJUSTMENT_LAYER`.

11. **`src/components/panels/ReduceColorsPanel/ReduceColorsPanel.module.scss`** — create scoped styles.

12. **`src/components/index.ts`** — add `export { ReduceColorsPanel } from './panels/ReduceColorsPanel/ReduceColorsPanel'`.

13. **`src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`**:
    - Import `ReduceColorsPanel` and `ReduceColorsAdjustmentLayer`.
    - Add `'reduce-colors': return 'Reduce Colors'` to `adjustmentTitle`.
    - Add `ReduceColorsHeaderIcon` inline SVG component.
    - Add `'reduce-colors'` case to `AdjPanelIcon`.
    - Add `ReduceColorsPanel` render branch passing `layer as ReduceColorsAdjustmentLayer`, `parentLayerName`, and `canvasHandleRef`.

---

## Architectural Constraints

**`AGENTS.md` rules particularly relevant here:**

- **Non-destructive:** parent pixel data is never modified. The `derivedPalette` stored in params is derived from parent pixels but does not alter them. ✓
- **Unified rasterization pipeline:** the `'reduce-colors'` `AdjustmentRenderOp` variant is dispatched through `encodeAdjustmentOp` and carried through `readFlattenedPlan` by the existing GPU rasterization path. Flatten, export, and merge all run the same pass. ✓
- **Panel category:** `ReduceColorsPanel` reads `AppContext` (for swatches) and dispatches directly — correctly categorized as a Panel, not a Widget. ✓
- **No business logic in `App.tsx`:** all orchestration goes through the existing `useAdjustments` hook and `handleCreateAdjustmentLayer`, which already handles the `ADJUSTMENT_REGISTRY` lookup. ✓
- **State in `AppContext`, not component state:** `derivedPalette` is stored in the layer's `params` in `AppState`, not as a local `useState` in the panel. The panel only holds transient `isQuantizing` UI state. ✓
- **WASM boundary:** `quantize()` is called only through `src/wasm/index.ts`; the `src/wasm/generated/` directory is never imported directly. ✓

---

## Open Questions

1. **Pixel data freshness for re-quantization:** `getLayerPixels` returns the current CPU-side `GpuLayer.data` mirror, which reflects the parent layer's pixel data as of the last GPU flush. If the user paints on the parent layer after creating the adjustment and before dragging the N slider, the quantization uses the updated pixels — this is correct behaviour per the spec ("analyzes the visible pixels on the parent layer"). However, there is no automatic re-quantization triggered by upstream pixel edits. Should the adjustment auto-re-derive when the parent layer's pixels change? The spec does not require this, but it is worth confirming with product.

2. **Quantization performance on very large canvases:** median-cut on a 4096×4096 layer (67M pixels) may take several hundred milliseconds in WASM. The panel shows a "Computing…" indicator, but there is no debounce on the slider. Consider whether to debounce slider `onChange` (e.g. 200 ms) to avoid triggering a new quantization on every tick of a fast drag, or whether to accept the async queue-up behaviour.

3. **`colorCount` display during async:** while `isQuantizing=true`, the slider and numeric input remain editable. If the user changes `colorCount` again before the previous quantization completes, the cancellation flag ensures only the latest result is dispatched. Confirm this is the desired UX vs. disabling the slider during computation.

4. **OKLab palette conversion at plan-build time:** the CPU-side OKLab helpers in `canvasPlan.ts` must exactly match the WGSL helpers in the shader to ensure that the pre-converted palette fed to the GPU passes round-trip correctly. These should share the same numeric constants — consider whether to maintain them as a shared TypeScript module under `src/utils/oklab.ts` that is imported by both `canvasPlan.ts` and used as the source of truth for the WGSL constants in `helpers.ts`.
