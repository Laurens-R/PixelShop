# Technical Design: Bloom

## Overview

Bloom is a non-destructive adjustment layer that synthesises a soft glowing halo from the bright areas of the composited pixel data below it. It belongs to a new **Real-time Effects** category in the Image menu — distinct from tonal/colour corrections — because it generates new visual content from luminance rather than remapping existing values.

Architecturally, bloom is the first multi-pass adjustment in the renderer. All eleven existing adjustments run a single compute dispatch and write to `dstTex`. Bloom requires up to seven sequential dispatches (extract → optional downsample → 3 × H+V blur → composite) using private intermediate textures. This drives the main structural additions: a dedicated `encodeBloomPass` method in `WebGPURenderer`, a bloom intermediate-texture cache on the renderer, and five new compute pipelines. Everything else (type system, registry, plan builder, rasterisation pipeline, UI) follows the existing per-adjustment pattern precisely.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'bloom'` to `AdjustmentType`; add `BloomParams` to `AdjustmentParamsMap`; add `BloomAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Add `AdjustmentRegistrationEntry` for bloom; add optional `group?: string` field to the entry shape |
| `src/components/window/Canvas/canvasPlan.ts` | Add `bloom` branch to `buildAdjustmentEntry`; add `BloomRenderOp` to `AdjustmentRenderOp` union |
| `src/webgpu/WebGPURenderer.ts` | Add five bloom `GPUComputePipeline` fields; add `bloomTexCache`; implement `encodeBloomPass` and `ensureBloomTextures`; wire into `encodeAdjustmentOp`; destroy bloom textures in `destroy()` |
| `src/webgpu/shaders/adjustments/bloom.ts` | **New file.** Five WGSL entry points |
| `src/webgpu/shaders.ts` | Export five bloom shader constants |
| `src/components/panels/BloomOptions/BloomOptions.tsx` | **New file.** Adjustment panel UI |
| `src/components/panels/BloomOptions/BloomOptions.module.scss` | **New file.** Panel styles |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `BloomHeaderIcon`; add to `AdjPanelIcon` switch; add to `adjustmentTitle`; render `<BloomOptions>` |
| `src/components/index.ts` | Export `BloomOptions` |
| `src/components/window/TopBar/TopBar.tsx` | Add `group?: string` to `adjustmentMenuItems` prop type; update Image menu builder to emit separators between groups (same pattern as Filters) |
| `src/App.tsx` | Include `group` in `ADJUSTMENT_MENU_ITEMS` mapping |

---

## State Changes

### `src/types/index.ts`

**1. Extend `AdjustmentType`**

```ts
export type AdjustmentType =
  | 'brightness-contrast'
  | /* … existing … */
  | 'reduce-colors'
  | 'bloom'          // ← add
```

**2. Add `BloomParams` to `AdjustmentParamsMap`**

```ts
export interface AdjustmentParamsMap {
  // … existing entries …
  'bloom': {
    threshold: number   // 0–1, default 0.50
    strength:  number   // 0–2, default 0.50
    spread:    number   // 1–100 (integer pixels at full res), default 20
    quality:   'full' | 'half' | 'quarter'  // default 'half'
  }
}
```

`knee` is fixed at `0.1` in the WGSL and is **not** stored in params (spec does not expose it as a control).

**3. Add `BloomAdjustmentLayer` interface**

```ts
export interface BloomAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'bloom'
  params: AdjustmentParamsMap['bloom']
  hasMask: boolean
}
```

**4. Extend `AdjustmentLayerState` union**

```ts
export type AdjustmentLayerState =
  | /* … existing … */
  | ReduceColorsAdjustmentLayer
  | BloomAdjustmentLayer     // ← add
```

No new fields on `AppState` are required. Bloom participates in the same `openAdjustmentLayerId` mechanism as all other adjustments.

---

## New Components / Hooks / Tools

### `BloomOptions` panel

- **Category**: Panel (reads `AppContext`, owns its own state reads and dispatches — no props other than the layer record and parent name)
- **Path**: `src/components/panels/BloomOptions/BloomOptions.tsx`
- **Single responsibility**: Render the four bloom controls and dispatch `UPDATE_ADJUSTMENT_LAYER` on every change
- **Inputs**: `layer: BloomAdjustmentLayer`, `parentLayerName: string`
- **Output**: Dispatches param updates; no callbacks upward

No new hooks, no new tools.

---

## Implementation Steps

### Step 1 — Type system (`src/types/index.ts`)

Add `'bloom'` to `AdjustmentType`, add `BloomParams` to `AdjustmentParamsMap`, add `BloomAdjustmentLayer` interface, and append `| BloomAdjustmentLayer` to `AdjustmentLayerState`. The exhaustive `never` checks in `buildAdjustmentEntry` and `encodeAdjustmentOp` will fail at build time until Steps 3 and 5 are complete — this is intentional and safe.

---

### Step 2 — Registry (`src/adjustments/registry.ts`)

Add `group?: string` to the `AdjustmentRegistrationEntry` interface, then add the bloom entry at the end of `ADJUSTMENT_REGISTRY`:

```ts
export interface AdjustmentRegistrationEntry<T extends AdjustmentType = AdjustmentType> {
  adjustmentType: T
  label: string
  defaultParams: AdjustmentParamsMap[T]
  group?: string   // ← add; used by TopBar to emit separators
}

// In ADJUSTMENT_REGISTRY array:
{
  adjustmentType: 'bloom' as const,
  label: 'Bloom…',
  group: 'real-time-effects',
  defaultParams: {
    threshold: 0.5,
    strength:  0.5,
    spread:    20,
    quality:   'half',
  },
},
```

The `group` field is not consumed by `useAdjustments` or any other logic — only by `TopBar.tsx`.

---

### Step 3 — Render plan (`src/components/window/Canvas/canvasPlan.ts`)

**3a. Add `BloomRenderOp` to the `AdjustmentRenderOp` union** (in `WebGPURenderer.ts` — see Step 5 for placement):

```ts
| {
    kind: 'bloom'
    layerId: string
    threshold: number
    strength:  number
    spread:    number
    quality:   'full' | 'half' | 'quarter'
    visible:   boolean
    selMaskLayer?: GpuLayer
  }
```

**3b. Add the `bloom` branch to `buildAdjustmentEntry`** in `canvasPlan.ts`, immediately before the `_exhaustive` line:

```ts
if (ls.adjustmentType === 'bloom') {
  return {
    kind: 'bloom',
    layerId: ls.id,
    threshold: ls.params.threshold,
    strength:  ls.params.strength,
    spread:    ls.params.spread,
    quality:   ls.params.quality,
    visible:   ls.visible,
    selMaskLayer: mask,
  }
}
```

---

### Step 4 — Bloom WGSL shaders (`src/webgpu/shaders/adjustments/bloom.ts`)

New file. Five WGSL entry points, each compiled to its own compute pipeline.

#### 4a. Common structs (referenced by multiple entry points)

```wgsl
struct MaskFlags {
  hasMask : u32,
  _pad    : vec3u,
}
```

This is copy-pasted verbatim from `helpers.ts` because each shader module is compiled independently. Do not import across modules.

#### 4b. `cs_bloom_extract` — bright-area extraction

**Purpose**: Read `srcTex`, compute per-pixel BT.709 luminance, apply a soft-knee curve around `threshold`, and multiply the original colour by the resulting weight. Outputs the hue-preserving glow seed to `dstTex`.

**Bind group (group 0)**:
| Binding | Type | Name | Notes |
|---|---|---|---|
| 0 | `texture_2d<f32>` | `srcTex` | Full-canvas compositor state |
| 1 | `texture_storage_2d<rgba8unorm, write>` | `dstTex` | Extract output (canvas size) |
| 2 | `var<uniform> BloomExtractParams` | `params` | threshold, _pad×3 |
| 3 | `texture_2d<f32>` | `selMask` | Selection mask (dummy if none) |
| 4 | `var<uniform> MaskFlags` | `maskFlags` | `hasMask` flag |

**WGSL uniform struct**:
```wgsl
struct BloomExtractParams {
  threshold : f32,
  _pad0     : f32,
  _pad1     : f32,
  _pad2     : f32,
}
```
Total: 16 bytes.

**TypeScript uniform layout** (matches `encodeComputePassRaw` convention):
```ts
new Float32Array([params.threshold, 0, 0, 0])
```

**Shader logic**:
```wgsl
@compute @workgroup_size(8, 8)
fn cs_bloom_extract(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);

  let lum = dot(src.rgb, vec3f(0.2126, 0.7152, 0.0722));  // BT.709
  let t   = params.threshold;
  let k   = 0.1;                                           // fixed soft-knee width
  let w   = smoothstep(t - k, t + k, lum);
  let glow = vec4f(src.rgb * w, src.a * w);

  var out = glow;
  if (maskFlags.hasMask != 0u) {
    let mask = textureLoad(selMask, coord, 0).r;
    out = glow * mask;  // zero outside selection
  }
  textureStore(dstTex, coord, out);
}
```

The mask application zeros the glow outside the baked selection, which correctly restricts bloom to the masked area. The `src` pixels inside the selection still receive their full glow weight; outside the selection the glow contribution is zero.

#### 4c. `cs_bloom_downsample` — optional scale-down

**Purpose**: Box-average `srcTex` (canvas size) into a smaller `dstTex` (quality-scaled size). Each output pixel averages a 2×2 (Half) or 4×4 (Quarter) source block using integer coordinate arithmetic.

**Bind group (group 0)**:
| Binding | Type | Name |
|---|---|---|
| 0 | `texture_2d<f32>` | `srcTex` |
| 1 | `texture_storage_2d<rgba8unorm, write>` | `dstTex` |
| 2 | `var<uniform> BloomDownsampleParams` | `params` |

```wgsl
struct BloomDownsampleParams {
  scale : u32,   // 2 (Half) or 4 (Quarter)
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
}
```
Total: 16 bytes.

Each thread reads `scale × scale` source pixels via clamped `textureLoad` and averages them. The dispatch dimensions equal the output (scaled-down) texture size.

#### 4d. `cs_bloom_blur_h` — horizontal box blur (bloom-local)

**Purpose**: Horizontal separable box blur. Reads `srcTex` (any size, rgba8unorm), writes `dstTex` (same size, rgba8unorm). Uses `textureDimensions(srcTex)` to determine extent, so it works correctly on any working size.

**Bind group (group 0)**:
| Binding | Type | Name |
|---|---|---|
| 0 | `texture_2d<f32>` | `srcTex` |
| 1 | `texture_storage_2d<rgba8unorm, write>` | `dstTex` |
| 2 | `var<uniform> BloomBlurParams` | `params` |

```wgsl
struct BloomBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}
```
Total: 16 bytes. Same shape as `BoxBlurParams` in the existing filter shaders (coincidental, not shared).

**Blur radius passed from `encodeBloomPass`**:

```ts
const scaleFactor = quality === 'full' ? 1 : quality === 'half' ? 2 : 4
const blurRadius  = Math.max(1, Math.round(params.spread / scaleFactor))
```

A Spread of 20 at Half quality → radius 10 on a 50 % texture, producing an equivalent halo at full resolution after upsampling.

#### 4e. `cs_bloom_blur_v` — vertical box blur (bloom-local)

Identical to `cs_bloom_blur_h` except the kernel runs along Y. Same bind group layout and param struct.

Both blur shaders dispatch at the **working texture dimensions**, not canvas dimensions.

#### 4f. `cs_bloom_composite` — upsample glow + Screen blend

**Purpose**: Read the blurred glow texture (working size, possibly smaller than canvas) and the original `srcTex` (canvas size). Upsample the glow bilinearly using a sampler, scale by `strength`, Screen-blend onto `srcTex`, and write to `dstTex`. Apply selection mask if present.

**Screen blend formula** (per channel):
$$\text{out} = 1 - (1 - \text{src}) \times (1 - \text{glow} \times \text{strength})$$

**Bind group (group 0)**:
| Binding | Type | Name | Notes |
|---|---|---|---|
| 0 | `texture_2d<f32>` | `srcTex` | Original canvas state (canvas size) |
| 1 | `texture_2d<f32>` | `glowTex` | Blurred glow (working size — may differ) |
| 2 | `texture_storage_2d<rgba8unorm, write>` | `dstTex` | Output (canvas size) |
| 3 | `sampler` | `bilinearSampler` | Bilinear, clamp-to-edge (reuse `this.lutSampler`) |
| 4 | `var<uniform> BloomCompositeParams` | `params` | strength, _pad×3 |
| 5 | `texture_2d<f32>` | `selMask` | Selection mask |
| 6 | `var<uniform> MaskFlags` | `maskFlags` | `hasMask` flag |

```wgsl
struct BloomCompositeParams {
  strength : f32,
  _pad0    : f32,
  _pad1    : f32,
  _pad2    : f32,
}
```
Total: 16 bytes.

**Shader logic (abbreviated)**:
```wgsl
@compute @workgroup_size(8, 8)
fn cs_bloom_composite(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let uv    = (vec2f(id.xy) + 0.5) / vec2f(dims);

  let src  = textureLoad(srcTex, coord, 0);
  let glow = textureSample(glowTex, bilinearSampler, uv);
  let g    = clamp(glow.rgb * params.strength, vec3f(0.0), vec3f(1.0));
  let out  = vec4f(1.0 - (1.0 - src.rgb) * (1.0 - g), src.a);

  if (maskFlags.hasMask != 0u) {
    let mask = textureLoad(selMask, coord, 0).r;
    textureStore(dstTex, coord, mix(src, out, mask));
  } else {
    textureStore(dstTex, coord, out);
  }
}
```

The dispatch dimensions are the **canvas dimensions** (same as `srcTex`/`dstTex`).

---

### Step 5 — WebGPU renderer (`src/webgpu/WebGPURenderer.ts`)

#### 5a. Add `BloomRenderOp` to the `AdjustmentRenderOp` union

```ts
| {
    kind: 'bloom'
    layerId:   string
    threshold: number
    strength:  number
    spread:    number
    quality:   'full' | 'half' | 'quarter'
    visible:   boolean
    selMaskLayer?: GpuLayer
  }
```

#### 5b. Import bloom shaders

In `shaders.ts`:
```ts
export {
  BLOOM_EXTRACT_COMPUTE,
  BLOOM_DOWNSAMPLE_COMPUTE,
  BLOOM_BLUR_H_COMPUTE,
  BLOOM_BLUR_V_COMPUTE,
  BLOOM_COMPOSITE_COMPUTE,
} from './shaders/adjustments/bloom'
```

In `WebGPURenderer.ts`, add to the existing imports from `'./shaders'`.

#### 5c. Add fields to `WebGPURenderer`

```ts
// Bloom compute pipelines
private readonly bloomExtractPipeline:    GPUComputePipeline
private readonly bloomDownsamplePipeline: GPUComputePipeline
private readonly bloomBlurHPipeline:      GPUComputePipeline
private readonly bloomBlurVPipeline:      GPUComputePipeline
private readonly bloomCompositePipeline:  GPUComputePipeline

// Bloom intermediate texture cache — invalidated when quality changes
private bloomTexCache: {
  quality:    'full' | 'half' | 'quarter'
  extractTex: GPUTexture   // canvas size, rgba8unorm
  blurATex:   GPUTexture   // working size, rgba8unorm (ping)
  blurBTex:   GPUTexture   // working size, rgba8unorm (pong)
} | null = null
```

These replace the earlier "allocate per-call" approach. Caching avoids allocating and destroying ~46–70 MB of GPU textures every render frame for a typical 4K canvas.

#### 5d. Initialize pipelines in the constructor

```ts
this.bloomExtractPipeline    = this.createComputePipeline(BLOOM_EXTRACT_COMPUTE,    'cs_bloom_extract')
this.bloomDownsamplePipeline = this.createComputePipeline(BLOOM_DOWNSAMPLE_COMPUTE, 'cs_bloom_downsample')
this.bloomBlurHPipeline      = this.createComputePipeline(BLOOM_BLUR_H_COMPUTE,     'cs_bloom_blur_h')
this.bloomBlurVPipeline      = this.createComputePipeline(BLOOM_BLUR_V_COMPUTE,     'cs_bloom_blur_v')
this.bloomCompositePipeline  = this.createComputePipeline(BLOOM_COMPOSITE_COMPUTE,  'cs_bloom_composite')
```

Add after the existing `rcPipeline` line.

#### 5e. Add `ensureBloomTextures`

```ts
private ensureBloomTextures(quality: 'full' | 'half' | 'quarter'): {
  extractTex: GPUTexture
  blurATex:   GPUTexture
  blurBTex:   GPUTexture
} {
  if (this.bloomTexCache && this.bloomTexCache.quality === quality) {
    return this.bloomTexCache
  }
  // Destroy stale cache
  this.bloomTexCache?.extractTex.destroy()
  this.bloomTexCache?.blurATex.destroy()
  this.bloomTexCache?.blurBTex.destroy()

  const { device, pixelWidth: w, pixelHeight: h } = this
  const scaleFactor = quality === 'full' ? 1 : quality === 'half' ? 2 : 4
  const bw = Math.ceil(w / scaleFactor)
  const bh = Math.ceil(h / scaleFactor)

  const usage =
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.COPY_DST

  const make = (tw: number, th: number): GPUTexture =>
    device.createTexture({ size: { width: tw, height: th }, format: 'rgba8unorm', usage })

  this.bloomTexCache = {
    quality,
    extractTex: make(w, h),
    blurATex:   make(bw, bh),
    blurBTex:   make(bw, bh),
  }
  return this.bloomTexCache
}
```

`COPY_DST` is needed because at `quality = 'full'` the extract texture is copied into `blurATex` via `copyTextureToTexture` (both are canvas size). At half/quarter, the downsample shader writes directly to `blurATex`.

#### 5f. Add `encodeBloomPass`

```ts
private encodeBloomPass(
  encoder:      GPUCommandEncoder,
  srcTex:       GPUTexture,
  dstTex:       GPUTexture,
  threshold:    number,
  strength:     number,
  spread:       number,
  quality:      'full' | 'half' | 'quarter',
  selMaskLayer: GpuLayer | undefined,
): void {
  const { device, pixelWidth: w, pixelHeight: h } = this
  const { extractTex, blurATex, blurBTex } = this.ensureBloomTextures(quality)

  const scaleFactor  = quality === 'full' ? 1 : quality === 'half' ? 2 : 4
  const bw           = Math.ceil(w / scaleFactor)
  const bh           = Math.ceil(h / scaleFactor)
  const blurRadius   = Math.max(1, Math.round(spread / scaleFactor))

  const dummyMask    = selMaskLayer?.texture ?? srcTex
  const maskFlagsArr = new Uint32Array(8); maskFlagsArr[0] = selMaskLayer ? 1 : 0
  const maskFlagsBuf = createUniformBuffer(device, 32)
  writeUniformBuffer(device, maskFlagsBuf, maskFlagsArr)

  // ── Pass 1: Extract ───────────────────────────────────────────────────────
  const extractParamsBuf = createUniformBuffer(device, 16)
  writeUniformBuffer(device, extractParamsBuf, new Float32Array([threshold, 0, 0, 0]))
  const extractBG = device.createBindGroup({
    layout: this.bloomExtractPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: extractTex.createView() },
      { binding: 2, resource: { buffer: extractParamsBuf } },
      { binding: 3, resource: dummyMask.createView() },
      { binding: 4, resource: { buffer: maskFlagsBuf } },
    ],
  })
  const extractPass = encoder.beginComputePass()
  extractPass.setPipeline(this.bloomExtractPipeline)
  extractPass.setBindGroup(0, extractBG)
  extractPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
  extractPass.end()

  // ── Pass 2: Downsample (skipped at Full quality) ──────────────────────────
  let workingSrc = blurATex  // ping starts as blurATex
  let workingDst = blurBTex  // pong

  if (quality !== 'full') {
    const dsParamsBuf = createUniformBuffer(device, 16)
    writeUniformBuffer(device, dsParamsBuf, new Uint32Array([scaleFactor, 0, 0, 0]))
    const dsBG = device.createBindGroup({
      layout: this.bloomDownsamplePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: extractTex.createView() },
        { binding: 1, resource: blurATex.createView() },
        { binding: 2, resource: { buffer: dsParamsBuf } },
      ],
    })
    const dsPass = encoder.beginComputePass()
    dsPass.setPipeline(this.bloomDownsamplePipeline)
    dsPass.setBindGroup(0, dsBG)
    dsPass.dispatchWorkgroups(Math.ceil(bw / 8), Math.ceil(bh / 8))
    dsPass.end()
    this.pendingDestroyBuffers.push(dsParamsBuf)
  } else {
    // Full quality: copy extractTex → blurATex (both canvas size)
    encoder.copyTextureToTexture(
      { texture: extractTex },
      { texture: blurATex },
      { width: w, height: h },
    )
  }

  // ── Passes 3–8: 3 × H+V box blur ─────────────────────────────────────────
  const blurParamsBuf = createUniformBuffer(device, 16)
  writeUniformBuffer(device, blurParamsBuf, new Uint32Array([blurRadius, 0, 0, 0]))

  for (let i = 0; i < 3; i++) {
    // H pass: workingSrc → workingDst
    const hBG = device.createBindGroup({
      layout: this.bloomBlurHPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: workingSrc.createView() },
        { binding: 1, resource: workingDst.createView() },
        { binding: 2, resource: { buffer: blurParamsBuf } },
      ],
    })
    const hPass = encoder.beginComputePass()
    hPass.setPipeline(this.bloomBlurHPipeline)
    hPass.setBindGroup(0, hBG)
    hPass.dispatchWorkgroups(Math.ceil(bw / 8), Math.ceil(bh / 8))
    hPass.end()
    ;[workingSrc, workingDst] = [workingDst, workingSrc]

    // V pass: workingSrc → workingDst
    const vBG = device.createBindGroup({
      layout: this.bloomBlurVPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: workingSrc.createView() },
        { binding: 1, resource: workingDst.createView() },
        { binding: 2, resource: { buffer: blurParamsBuf } },
      ],
    })
    const vPass = encoder.beginComputePass()
    vPass.setPipeline(this.bloomBlurVPipeline)
    vPass.setBindGroup(0, vBG)
    vPass.dispatchWorkgroups(Math.ceil(bw / 8), Math.ceil(bh / 8))
    vPass.end()
    ;[workingSrc, workingDst] = [workingDst, workingSrc]
  }
  // After 6 ping-pong swaps (3 pairs), workingSrc holds the final blurred glow.

  // ── Pass 9: Composite ─────────────────────────────────────────────────────
  const compParamsBuf = createUniformBuffer(device, 16)
  writeUniformBuffer(device, compParamsBuf, new Float32Array([strength, 0, 0, 0]))
  const compBG = device.createBindGroup({
    layout: this.bloomCompositePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: workingSrc.createView() },   // blurred glow
      { binding: 2, resource: dstTex.createView() },
      { binding: 3, resource: this.lutSampler },            // bilinear
      { binding: 4, resource: { buffer: compParamsBuf } },
      { binding: 5, resource: dummyMask.createView() },
      { binding: 6, resource: { buffer: maskFlagsBuf } },
    ],
  })
  const compPass = encoder.beginComputePass()
  compPass.setPipeline(this.bloomCompositePipeline)
  compPass.setBindGroup(0, compBG)
  compPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
  compPass.end()

  this.pendingDestroyBuffers.push(extractParamsBuf, blurParamsBuf, compParamsBuf, maskFlagsBuf)
}
```

Note: `blurParamsBuf` is created once before the loop and reused across all 6 blur dispatches (the radius is constant per render call). The bind groups are recreated per-pass because `workingSrc`/`workingDst` swap, but the param buffer is shared.

#### 5g. Wire into `encodeAdjustmentOp`

Add immediately before the `_exhaustive` line:

```ts
if (entry.kind === 'bloom') {
  this.encodeBloomPass(
    encoder, srcTex, dstTex,
    entry.threshold, entry.strength, entry.spread, entry.quality,
    entry.selMaskLayer,
  )
  return
}
```

#### 5h. Destroy bloom textures in `destroy()`

```ts
destroy(): void {
  // … existing destroy calls …
  this.bloomTexCache?.extractTex.destroy()
  this.bloomTexCache?.blurATex.destroy()
  this.bloomTexCache?.blurBTex.destroy()
  this.bloomTexCache = null
  // …
}
```

---

### Step 6 — UI component (`src/components/panels/BloomOptions/`)

#### `BloomOptions.tsx`

Category: **Panel** (reads `AppContext` directly via `useAppContext`). Follows the `BrightnessContrastPanel` and `ReduceColorsPanel` patterns.

```ts
interface BloomOptionsPanelProps {
  layer:           BloomAdjustmentLayer
  parentLayerName: string
}
```

**Controls**:
1. **Threshold** — `type="range"`, `min={0}`, `max={1}`, `step={0.01}`, paired `type="number"` clamped to [0, 1]. CSS `--pct` variable for track fill.
2. **Strength** — `type="range"`, `min={0}`, `max={2}`, `step={0.01}`, paired `type="number"` clamped to [0, 2].
3. **Spread** — `type="range"`, `min={1}`, `max={100}`, `step={1}`, paired `type="number"` clamped to [1, 100] and rounded to integer. Unit label "px" rendered inline.
4. **Quality** — Three `<button>` elements in a `div.segmented` (same pattern as `ReduceColorsPanel` and `CurvesPanel`). Options: `Full`, `Half`, `Quarter`. Active button gets `styles.segBtnActive` class.

Every `onChange` / `onClick` dispatches:
```ts
dispatch({
  type: 'UPDATE_ADJUSTMENT_LAYER',
  payload: { ...layer, params: { ...layer.params, [field]: value } },
})
```

Footer row: `<ParentConnectorIcon />` + "Adjusting **{parentLayerName}**" + "Reset" button that restores all four fields to defaults.

#### `BloomOptions.module.scss`

Copy the layout conventions from `BrightnessContrastPanel.module.scss` exactly. Add:
- `.unitLabel` — small grey `px` suffix for Spread
- `.segmented`, `.segBtn`, `.segBtnActive` — same semantics as in `ReduceColorsPanel.module.scss` (do not share the class — each panel scopes its own CSS module)

---

### Step 7 — `AdjustmentPanel.tsx` (`src/components/panels/AdjustmentPanel/`)

**7a. Add `BloomHeaderIcon`** (inline SVG, same style as the other header icons in this file):

```tsx
const BloomHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
    <circle cx="6" cy="6" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="6" cy="6" r="3" opacity="0.6" />
    <circle cx="6" cy="6" r="4.5" opacity="0.3" />
  </svg>
)
```

**7b. Add to `adjustmentTitle`**:
```ts
case 'bloom': return 'Bloom'
```

**7c. Add to `AdjPanelIcon`**:
```ts
if (type === 'bloom') return <BloomHeaderIcon />
```

**7d. Add `BloomOptions` import** at the top alongside the other panel imports.

**7e. Add import of `BloomAdjustmentLayer`** to the type imports.

**7f. Add render branch** inside the returned JSX:
```tsx
{adjLayer.adjustmentType === 'bloom' && (
  <BloomOptions layer={adjLayer as BloomAdjustmentLayer} parentLayerName={parentLayerName} />
)}
```

**7g. Panel width**: Use `236` (same as most panels — no special-case needed).

---

### Step 8 — Barrel exports

In `src/components/index.ts`, add:
```ts
export { BloomOptions } from './panels/BloomOptions/BloomOptions'
```

---

### Step 9 — Menu changes

#### `TopBar.tsx`

**9a. Update `adjustmentMenuItems` prop type**:
```ts
adjustmentMenuItems?: Array<{ type: AdjustmentType; label: string; group?: string }>
```

**9b. Update the Image menu builder** from a flat `map` to the same group-separator pattern used for Filters:
```ts
{
  label: 'Image',
  items: (() => {
    const result: MenuDef['items'] = []
    let lastGroup: string | undefined = undefined
    for (const item of (adjustmentMenuItems ?? [])) {
      if (item.group !== undefined && item.group !== lastGroup && lastGroup !== undefined) {
        result.push({ separator: true, label: '' })
      }
      lastGroup = item.group
      result.push({
        label:    item.label,
        disabled: !isAdjustmentMenuEnabled,
        action:   () => onCreateAdjustmentLayer?.(item.type),
      })
    }
    return result
  })(),
},
```

**9c. Add `adjustmentMenuItems` to the `useMemo` dependency array** (it is already there; verify when editing).

#### `App.tsx`

Update `ADJUSTMENT_MENU_ITEMS` to include `group`:
```ts
const ADJUSTMENT_MENU_ITEMS = ADJUSTMENT_REGISTRY.map(e => ({
  type:  e.adjustmentType,
  label: e.label,
  group: e.group,
}))
```

The `Real-time Effects` group will appear below a plain unlabeled separator, consistent with how the Filters menu separates groups. The `MenuBar` component does not currently support labeled section headers, so the separator is unlabeled. If a labeled divider is required in future, `MenuItemDef` and `MenuBar.tsx` would need a `sectionHeader?: boolean` + `label` extension — this is left as an open question.

---

## Architectural Constraints

**AGENTS.md maintenance checklist** for new adjustments:

1. ✅ Add to adjustment registry and related types — covered by Steps 1–2
2. ✅ Add render-plan entry mapping — covered by Step 3
3. ✅ Add WebGL/WebGPU pass/shader path — covered by Steps 4–5
4. ✅ Unified rasterisation includes it — bloom flows through `buildAdjustmentEntry → buildRenderPlan → encodePlanToComposite → encodeAdjustmentOp → encodeBloomPass`. `readFlattenedPlan` and `rasterizeDocument` both call `encodePlanToComposite`, so flatten, export, and merge all execute bloom identically to the screen preview. No separate compositing path exists.
5. ⚠️ Parity tests — see Open Questions.

**Other relevant rules**:

- **No CPU fallback**: bloom has no CPU rasterisation path. If `encodeBloomPass` were to fail, it surfaces an error through the existing GPU renderer error handling. The spec AGENTS.md rule "If flatten/export/merge execution fails, surface the error" is satisfied because `readFlattenedPlan` already propagates GPU device errors to `rasterizeDocument` → `rasterizeComposite` → caller.
- **Bypass-preview state**: bloom participates in the existing `bypassedAdjustmentIds` mechanism in `buildRenderPlan`. No bloom-specific bypass handling is needed.
- **Intermediate textures are renderer-owned, not per-tab**: The bloom tex cache lives on `WebGPURenderer`. Canvas resize destroys and recreates the renderer via `canvasKey`, which triggers the `destroy()` path that clears `bloomTexCache`. This is correct.
- **`encodeComputePassRaw` is not used for bloom**: The composite and extract passes have non-standard bind group layouts (different number of bindings). `encodeBloomPass` builds all bind groups manually, consistent with `encodeCurvesPass` and `encodeSelectiveColorPass` which also build their own groups.

---

## Files to Change — Summary

| File | Action | Notes |
|---|---|---|
| `src/types/index.ts` | Modify | +`'bloom'` to union, +`BloomParams`, +`BloomAdjustmentLayer`, +union member |
| `src/adjustments/registry.ts` | Modify | +`group?` to entry interface, +bloom entry |
| `src/components/window/Canvas/canvasPlan.ts` | Modify | +bloom branch in `buildAdjustmentEntry` |
| `src/webgpu/WebGPURenderer.ts` | Modify | +5 pipelines, +`bloomTexCache`, +`ensureBloomTextures`, +`encodeBloomPass`, +bloom case in `encodeAdjustmentOp`, +destroy in `destroy()`, +`BloomRenderOp` in union |
| `src/webgpu/shaders/adjustments/bloom.ts` | **New** | 5 WGSL entry points |
| `src/webgpu/shaders.ts` | Modify | +5 exports |
| `src/components/panels/BloomOptions/BloomOptions.tsx` | **New** | Panel UI |
| `src/components/panels/BloomOptions/BloomOptions.module.scss` | **New** | Panel styles |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Modify | +`BloomHeaderIcon`, +`adjustmentTitle` case, +`AdjPanelIcon` case, +`<BloomOptions>` render, +imports |
| `src/components/index.ts` | Modify | +`BloomOptions` export |
| `src/components/window/TopBar/TopBar.tsx` | Modify | +`group?` to prop type, group-separator logic in Image menu |
| `src/App.tsx` | Modify | +`group` in `ADJUSTMENT_MENU_ITEMS` |

**Total: 7 modified files, 3 new files.**

---

## Open Questions

1. **Parity tests**: AGENTS.md requires parity tests across screen preview, flatten, and export. No test infrastructure for adjustment layers is visible in the scanned codebase. Before shipping bloom, the team should clarify where parity tests live and add a bloom test case that compares `renderPlan` output against `readFlattenedPlan` output with the same plan.

2. **Labeled "Real-time Effects" separator**: The spec calls for a *labeled* divider in the Image menu (visually showing the section name "Real-time Effects"). The current `MenuItemDef` type only supports unlabeled separators (`{ separator: true, label: '' }`). This design uses an unlabeled separator, matching how the Filters menu separates groups. If a labeled section header is required, `MenuItemDef` must gain a `sectionHeader?: boolean` field and `MenuBar.tsx` must render a visible header row — a small but targeted change to a shared component.

3. **`rgba8unorm` vs. `rgba16float` for blur intermediates**: The blur shaders use `rgba8unorm` for both `blurATex` and `blurBTex`. For very large radii (Spread = 100 at Full quality → radius 100) and bright sources, accumulated box-blur rounding may slightly soften the exact halo shape. If this is visually objectionable during QA, the H-pass intermediate can be upgraded to `rgba16float` (matching the existing filter box blur pattern), which requires separate H-output and V-input textures of type `rgba16float`. This would add one more cached texture per quality level and require the V shader to bind `texture_2d<f32>` reading from `rgba16float`.

4. **Spread value interpretation at canvas boundaries**: Spread is defined as pixels at full native resolution. At `quality = 'half'`, the blur radius is halved before blurring the downsampled texture, which preserves the effective full-resolution halo size. At `quality = 'quarter'`, it is quartered. This is the correct interpretation per the spec. Confirm with design that the visual result matches expectations, especially for small canvases (64 × 64) where Spread = 100 would produce a radius = 100 blur that exceeds the canvas dimension — box blur naturally clamps at image edges, so this is safe but may produce unexpected softness.

5. **Multiple bloom layers on the same parent**: The spec explicitly allows this. Each bloom adjustment layer is an independent `AdjustmentRenderOp` in the render plan. The `ensureBloomTextures` cache is keyed by `quality` only — not by layer ID. If two bloom layers with different `quality` settings exist on the same parent, the second call to `encodeBloomPass` will destroy and recreate the cache for the first's quality. This causes one cache invalidation per frame per quality mismatch, not a bug but a minor inefficiency. Acceptable for the expected use case.
