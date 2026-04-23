# Technical Design: Outline

## Overview

Outline is a non-destructive real-time effect that draws a solid-color stroke around (or within) the visible content of a parent pixel, text, or shape layer. It derives a silhouette mask from the parent's composited alpha channel, expands or contracts it via separable 1D morphological passes (dilation for outside, erosion for inside, both for center), derives the stroke mask by subtracting the appropriate boundaries, optionally feathers the mask with a box-blur approximation of Gaussian blur, colorizes it, and composites it under the parent layer pixels using Porter-Duff Normal blend mode. Unlike Drop Shadow and Glow, Outline has no directional offset, no Blend Mode selector, and no Knockout option — and it requires its own WGSL shader suite because erosion is a fundamentally new operation and the composite step differs in structure.

The effect runs entirely on the GPU as a sequence of WebGPU compute passes dispatched from a new `encodeOutlinePass()` method on `WebGPURenderer`, and participates in the existing adjustment-group render plan.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'outline'` to `AdjustmentType`; add `OutlineParams` to `AdjustmentParamsMap`; add `OutlineAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Register `'outline'` entry with `group: 'real-time-effects'` |
| `src/webgpu/shaders/adjustments/outline.ts` | **New file** — eight WGSL compute shader string constants |
| `src/webgpu/WebGPURenderer.ts` | Add `'outline'` `AdjustmentRenderOp` variant; add 8 pipeline fields and `outlineTexCache` field; add `ensureOutlineTextures()` and `encodeOutlinePass()` methods; add dispatch branch in `encodeAdjustmentOp()`; destroy outline textures in resize/cleanup paths |
| `src/components/window/Canvas/canvasPlan.ts` | Add `'outline'` branch in `buildAdjustmentEntry()` |
| `src/components/panels/OutlineOptions/OutlineOptions.tsx` | **New file** — panel component |
| `src/components/panels/OutlineOptions/OutlineOptions.module.scss` | **New file** — panel styles |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `OutlineAdjustmentLayer` to type imports; add `OutlineOptions` import; add `'outline'` to `adjustmentTitle()` switch; add `OutlineHeaderIcon` component; add `'outline'` branch to `AdjPanelIcon`; add `<OutlineOptions>` render block |
| `src/components/index.ts` | Export `OutlineOptions` |

`useAdjustments.ts` requires no changes. `isEffectEligibleLayer` and `handleCreateAdjustmentLayer` already handle all `AdjustmentType` values generically.

---

## State Changes

### `src/types/index.ts`

**1. Extend `AdjustmentType`:**

```ts
export type AdjustmentType =
  | /* ...existing... */
  | 'glow'
  | 'outline'
```

**2. Add `OutlineParams` to `AdjustmentParamsMap`:**

```ts
'outline': {
  /** Stroke color including alpha. r/g/b/a are 0–255. Default: { r:255, g:0, b:0, a:255 } */
  color:     RGBAColor
  /** Overall stroke opacity, 0–100 (%). Applied on top of color.a. Default: 100 */
  opacity:   number
  /** Stroke width in pixels, 1–100. Integer values only. Default: 3 */
  thickness: number
  /** Controls which side of the silhouette boundary the stroke occupies. Default: 'outside' */
  position:  'outside' | 'inside' | 'center'
  /** Gaussian-approximation blur radius for the stroke mask, 0–50 px. Default: 0 */
  softness:  number
}
```

**3. Add `OutlineAdjustmentLayer` interface** (follows the exact pattern of `GlowAdjustmentLayer`):

```ts
export interface OutlineAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'outline'
  params: AdjustmentParamsMap['outline']
  hasMask: boolean
}
```

**4. Extend `AdjustmentLayerState` union:**

```ts
export type AdjustmentLayerState =
  | /* ...existing members... */
  | GlowAdjustmentLayer
  | OutlineAdjustmentLayer
```

---

## Registry Entry

### `src/adjustments/registry.ts`

Append to `ADJUSTMENT_REGISTRY` after the existing `'glow'` entry:

```ts
{
  adjustmentType: 'outline' as const,
  label: 'Outline…',
  group: 'real-time-effects',
  defaultParams: {
    color:     { r: 255, g: 0, b: 0, a: 255 },
    opacity:   100,
    thickness: 3,
    position:  'outside',
    softness:  0,
  },
},
```

Because `EFFECTS_MENU_ITEMS` in `App.tsx` is built by filtering `ADJUSTMENT_REGISTRY` for `group === 'real-time-effects'`, this entry appears automatically in the Effects menu — no change to `App.tsx` is needed.

---

## WGSL Shader Design

**File**: `src/webgpu/shaders/adjustments/outline.ts`

The pipeline uses eight compute shaders operating at canvas resolution. All intermediate data is stored in the **R channel** of `rgba8unorm` scratch textures. Three scratch textures (`tempA`, `tempB`, `tempC`) are ping-ponged throughout. `tempC` is required only by the center-position pass sequence but is always allocated alongside `tempA` and `tempB` for simplicity.

### Structs and Byte Layouts

All uniform structs are padded to a multiple of 16 bytes to satisfy WebGPU alignment rules.

**`OutlineMorphParams`** (16 bytes) — shared by all four morph passes:

```wgsl
struct OutlineMorphParams {
  radius : u32,   // offset  0 — morph radius in pixels
  _pad0  : u32,   // offset  4
  _pad1  : u32,   // offset  8
  _pad2  : u32,   // offset 12
}
```

**`OutlineBlurParams`** (16 bytes) — shared by both blur passes:

```wgsl
struct OutlineBlurParams {
  radius : u32,   // offset  0 — box half-width in pixels
  _pad0  : u32,   // offset  4
  _pad1  : u32,   // offset  8
  _pad2  : u32,   // offset 12
}
```

**`OutlineMaskParams`** (16 bytes) — used by the mask-derivation pass:

```wgsl
struct OutlineMaskParams {
  mode  : u32,   // offset  0 — 0=outside, 1=inside, 2=center
  _pad0 : u32,   // offset  4
  _pad1 : u32,   // offset  8
  _pad2 : u32,   // offset 12
}
```

**`OutlineCompositeParams`** (32 bytes):

```wgsl
struct OutlineCompositeParams {
  colorR  : f32,  // offset  0 — stroke color R, 0..1
  colorG  : f32,  // offset  4 — stroke color G, 0..1
  colorB  : f32,  // offset  8 — stroke color B, 0..1
  colorA  : f32,  // offset 12 — stroke color alpha, 0..1
  opacity : f32,  // offset 16 — overall opacity, 0..1
  _pad0   : u32,  // offset 20
  _pad1   : u32,  // offset 24
  _pad2   : u32,  // offset 28
}
// Total: 32 bytes (multiple of 16)
```

**`MaskFlags`** (16 bytes) — reused from existing codebase pattern:

```wgsl
struct MaskFlags {
  hasMask : u32,
  _pad    : vec3u,
}
```

---

### Pass 1 — `OUTLINE_DILATE_H_COMPUTE` (`cs_outline_dilate_h`)

Extracts the source alpha channel and applies a 1D horizontal max-filter of radius `thickness`. The first morph pass always reads `.a` from `srcTex` (the composited parent texture), matching the Drop Shadow dilate pattern.

**Bindings (group 0):**

| Binding | Name | Type |
|---|---|---|
| 0 | `srcTex` | `texture_2d<f32>` — reads `.a` |
| 1 | `dstTex` | `texture_storage_2d<rgba8unorm, write>` — writes dilated alpha to `.r` |
| 2 | `params` | `var<uniform> OutlineMorphParams` |

**Algorithm:**

```wgsl
let r = i32(params.radius);
var maxA = 0.0;
for (var dx: i32 = -r; dx <= r; dx++) {
  let sx = clamp(i32(id.x) + dx, 0, i32(dims.x) - 1);
  maxA = max(maxA, textureLoad(srcTex, vec2i(sx, i32(id.y)), 0).a);
}
textureStore(dstTex, vec2i(id.xy), vec4f(maxA, 0.0, 0.0, 1.0));
```

---

### Pass 2 — `OUTLINE_DILATE_V_COMPUTE` (`cs_outline_dilate_v`)

Vertical max-filter on the R channel written by Pass 1. Completes the separable morphological dilation. Reads `.r` from `srcTex` (not `.a`), like the Drop Shadow `DILATE_V` shader.

**Bindings (group 0):** identical layout to Pass 1.

**Algorithm:** same as Pass 1 with `dy` replacing `dx`, reading `.r` instead of `.a`.

---

### Pass 3 — `OUTLINE_ERODE_H_COMPUTE` (`cs_outline_erode_h`)

Extracts the source alpha channel and applies a 1D horizontal min-filter of radius `thickness` (or `erodeR` for center mode). Reads `.a` from `srcTex` — always the original composited parent, same as DilateH.

**Bindings (group 0):** identical layout to Pass 1.

**Algorithm:**

```wgsl
let r = i32(params.radius);
var minA = 1.0;
for (var dx: i32 = -r; dx <= r; dx++) {
  let sx = clamp(i32(id.x) + dx, 0, i32(dims.x) - 1);
  minA = min(minA, textureLoad(srcTex, vec2i(sx, i32(id.y)), 0).a);
}
textureStore(dstTex, vec2i(id.xy), vec4f(minA, 0.0, 0.0, 1.0));
```

---

### Pass 4 — `OUTLINE_ERODE_V_COMPUTE` (`cs_outline_erode_v`)

Vertical min-filter on the R channel written by Pass 3. Reads `.r` from `srcTex`.

**Bindings (group 0):** identical layout to Pass 1.

**Algorithm:** same as Pass 3 with `dy` replacing `dx`, reading `.r` instead of `.a`.

---

### Pass 5 — `OUTLINE_MASK_COMPUTE` (`cs_outline_mask`)

Derives the raw stroke mask from the morphological result textures and, for outside/inside modes, the original source alpha. The mode uniform selects the derivation formula. This pass must run **before** softness blurring so that the blur is applied to the stroke shape itself, not the expanded silhouette.

**Bindings (group 0):**

| Binding | Name | Type |
|---|---|---|
| 0 | `srcTex` | `texture_2d<f32>` — original parent composite (reads `.a`; used by outside/inside modes) |
| 1 | `morphATex` | `texture_2d<f32>` — dilated alpha mask in `.r` (used by outside/center; pass dummy `srcTex` for inside) |
| 2 | `morphBTex` | `texture_2d<f32>` — eroded alpha mask in `.r` (used by inside/center; pass dummy `srcTex` for outside) |
| 3 | `dstTex` | `texture_storage_2d<rgba8unorm, write>` — stroke mask output to `.r` |
| 4 | `params` | `var<uniform> OutlineMaskParams` |

**Algorithm:**

```wgsl
let src_alpha = textureLoad(srcTex,    coord, 0).a;
let morph_a   = textureLoad(morphATex, coord, 0).r;  // dilated
let morph_b   = textureLoad(morphBTex, coord, 0).r;  // eroded

var mask: f32;
if params.mode == 0u {         // outside: stroke = dilated − original
  mask = max(0.0, morph_a - src_alpha);
} else if params.mode == 1u {  // inside: stroke = original − eroded
  mask = max(0.0, src_alpha - morph_b);
} else {                       // center: stroke = dilated − eroded
  mask = max(0.0, morph_a - morph_b);
}
textureStore(dstTex, vec2i(id.xy), vec4f(mask, 0.0, 0.0, 1.0));
```

---

### Passes 6 & 7 — `OUTLINE_BLUR_H_COMPUTE` / `OUTLINE_BLUR_V_COMPUTE`

H and V 1D box blur on the R channel of the stroke mask texture. Dispatched **3× each** (alternating H then V) to approximate Gaussian blur via the Central Limit Theorem. Three box passes of width `2r+1` produce sigma ≈ `r × √3`.

**Bindings (group 0):** same layout as Passes 1–4 (srcTex reads `.r`, dstTex writes `.r`).

**WGSL struct:** `OutlineBlurParams` (16 bytes, same layout as `OutlineMorphParams`).

**Algorithm (H variant):**

```wgsl
let r = i32(params.radius);
let count = f32(2 * r + 1);
var acc = 0.0;
for (var dx: i32 = -r; dx <= r; dx++) {
  let sx = clamp(i32(id.x) + dx, 0, i32(dims.x) - 1);
  acc += textureLoad(srcTex, vec2i(sx, i32(id.y)), 0).r;
}
textureStore(dstTex, vec2i(id.xy), vec4f(acc / count, 0.0, 0.0, 1.0));
```

V variant: identical with `dy`/`sy` replacing `dx`/`sx`.

---

### Pass 8 — `OUTLINE_COMPOSITE_COMPUTE` (`cs_outline_composite`)

Reads the (optionally blurred) stroke mask and the original source texture, colorizes the mask, and composites it behind the source using Porter-Duff Normal "over". No offset, blend mode, or knockout — the stroke is always placed behind the source in Normal mode.

**Bindings (group 0):**

| Binding | Name | Type |
|---|---|---|
| 0 | `srcTex` | `texture_2d<f32>` — original parent composite |
| 1 | `maskTex` | `texture_2d<f32>` — blurred stroke mask in `.r` |
| 2 | `dstTex` | `texture_storage_2d<rgba8unorm, write>` |
| 3 | `params` | `var<uniform> OutlineCompositeParams` |
| 4 | `selMask` | `texture_2d<f32>` — selection mask (may be dummy `srcTex`) |
| 5 | `maskFlags` | `var<uniform> MaskFlags` |

**Algorithm:**

```wgsl
let src     = textureLoad(srcTex,  coord, 0);
let rawMask = textureLoad(maskTex, coord, 0).r;

// Final stroke alpha: mask × color.a × opacity
let strokeA   = rawMask * params.colorA * params.opacity;
let strokeRGB = vec3f(params.colorR, params.colorG, params.colorB);

// Porter-Duff: src OVER stroke (stroke is behind source pixels)
let outA   = src.a + strokeA * (1.0 - src.a);
var outRGB = src.rgb * src.a + strokeRGB * strokeA * (1.0 - src.a);
if (outA > 0.0001) { outRGB /= outA; }
var out = vec4f(outRGB, outA);

// Apply selection mask (blend between original and composited output)
if (maskFlags.hasMask != 0u) {
  let selA = textureLoad(selMask, coord, 0).r;
  out = mix(src, out, selA);
}
textureStore(dstTex, coord, out);
```

---

## WebGPU Dispatch

### `AdjustmentRenderOp` variant

Add to the union in `WebGPURenderer.ts` after the `'glow'` variant:

```ts
| {
    kind:      'outline'
    layerId:   string
    /** Stroke color components pre-normalised to 0..1. */
    colorR:    number
    colorG:    number
    colorB:    number
    colorA:    number    // 0..1 (color.a / 255)
    opacity:   number   // 0..1 (pre-divided by 100)
    thickness: number   // integer 1..100 px
    position:  'outside' | 'inside' | 'center'
    softness:  number   // 0..50 px
    visible:   boolean
    selMaskLayer?: GpuLayer
  }
```

### `outlineTexCache` field

Add alongside `shadowTexCache`:

```ts
private outlineTexCache: { tempA: GPUTexture; tempB: GPUTexture; tempC: GPUTexture } | null = null
```

Three textures are required because center-position passes need to hold both the dilated result (`tempC`) and the eroded result (`tempB`) simultaneously during the mask-derivation step.

### Eight new compute pipeline fields

Add to the class fields in the "Drop Shadow compute pipelines" region:

```ts
// Outline compute pipelines
private readonly outlineDilateHPipeline:   GPUComputePipeline
private readonly outlineDilateVPipeline:   GPUComputePipeline
private readonly outlineErodeHPipeline:    GPUComputePipeline
private readonly outlineErodeVPipeline:    GPUComputePipeline
private readonly outlineMaskPipeline:      GPUComputePipeline
private readonly outlineBlurHPipeline:     GPUComputePipeline
private readonly outlineBlurVPipeline:     GPUComputePipeline
private readonly outlineCompositePipeline: GPUComputePipeline
```

**Binding group layouts:**

The dilate/erode/blur pipelines share a 3-binding layout (same as the Drop Shadow dilate/blur pipelines):
- binding 0: `texture_2d<f32>` (src)
- binding 1: `texture_storage_2d<rgba8unorm, write>` (dst)
- binding 2: `uniform buffer` (params)

The mask pipeline (`outlineMaskPipeline`) has a distinct 5-binding layout:
- binding 0: `texture_2d<f32>` (srcTex — original parent)
- binding 1: `texture_2d<f32>` (morphATex — dilated)
- binding 2: `texture_2d<f32>` (morphBTex — eroded)
- binding 3: `texture_storage_2d<rgba8unorm, write>` (dstTex)
- binding 4: `uniform buffer` (OutlineMaskParams)

The composite pipeline has a 6-binding layout (same as `shadowCompositePipeline`):
- binding 0: `texture_2d<f32>` (srcTex)
- binding 1: `texture_2d<f32>` (maskTex)
- binding 2: `texture_storage_2d<rgba8unorm, write>` (dstTex)
- binding 3: `uniform buffer` (OutlineCompositeParams)
- binding 4: `texture_2d<f32>` (selMask)
- binding 5: `uniform buffer` (MaskFlags)

### `ensureOutlineTextures()` helper

Mirrors `ensureShadowTextures()` but returns three textures:

```ts
private ensureOutlineTextures(): { tempA: GPUTexture; tempB: GPUTexture; tempC: GPUTexture } {
  if (this.outlineTexCache) return this.outlineTexCache
  const { device, pixelWidth: w, pixelHeight: h } = this
  const usage =
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.COPY_DST |
    GPUTextureUsage.COPY_SRC
  const make = (): GPUTexture =>
    device.createTexture({ size: { width: w, height: h }, format: 'rgba8unorm', usage })
  this.outlineTexCache = { tempA: make(), tempB: make(), tempC: make() }
  return this.outlineTexCache
}
```

Destroy and null the cache in the same paths that clear `shadowTexCache`: the canvas resize handler and `destroy()`. Add after the existing shadow cache cleanup:

```ts
this.outlineTexCache?.tempA.destroy()
this.outlineTexCache?.tempB.destroy()
this.outlineTexCache?.tempC.destroy()
this.outlineTexCache = null
```

### `encodeOutlinePass()` method

```ts
private encodeOutlinePass(
  encoder:      GPUCommandEncoder,
  srcTex:       GPUTexture,
  dstTex:       GPUTexture,
  colorR:       number,
  colorG:       number,
  colorB:       number,
  colorA:       number,
  opacity:      number,
  thickness:    number,
  position:     'outside' | 'inside' | 'center',
  softness:     number,
  selMaskLayer: GpuLayer | undefined,
): void
```

#### Dispatch sequence

```ts
const { device, pixelWidth: w, pixelHeight: h } = this
const { tempA, tempB, tempC } = this.ensureOutlineTextures()

const T       = Math.max(1, Math.round(thickness))
const dilateR = position === 'center' ? Math.ceil(T / 2)  : T
const erodeR  = position === 'center' ? Math.floor(T / 2) : T
const blurR   = softness > 0 ? Math.max(1, Math.round(softness * 0.577)) : 0

// Shared morph uniform (radius varies per mode; create separate bufs for dilate/erode when both needed)
const dilateParamsBuf = createUniformBuffer(device, 16)
writeUniformBuffer(device, dilateParamsBuf, new Uint32Array([dilateR, 0, 0, 0]))

// ── Morphological passes ──────────────────────────────────────────────────────

if (position === 'outside') {
  // DilateH: srcTex.a → tempA.r
  // DilateV: tempA.r  → tempB.r   (dilated mask in tempB)
  encodeSimpleMorphPass(dilateHPipeline, srcTex,  tempA, dilateParamsBuf)
  encodeSimpleMorphPass(dilateVPipeline, tempA,   tempB, dilateParamsBuf)

} else if (position === 'inside') {
  // ErodeH:  srcTex.a → tempA.r
  // ErodeV:  tempA.r  → tempB.r   (eroded mask in tempB)
  encodeSimpleMorphPass(erodeHPipeline,  srcTex,  tempA, dilateParamsBuf)
  encodeSimpleMorphPass(erodeVPipeline,  tempA,   tempB, dilateParamsBuf)

} else {
  // center: dilate and erode both from the original srcTex
  // DilateH: srcTex.a → tempA.r
  // DilateV: tempA.r  → tempC.r   (dilated mask in tempC — preserved while erode runs)
  // ErodeH:  srcTex.a → tempA.r   (reuse tempA)
  // ErodeV:  tempA.r  → tempB.r   (eroded mask in tempB)
  const erodeParamsBuf = createUniformBuffer(device, 16)
  writeUniformBuffer(device, erodeParamsBuf, new Uint32Array([erodeR, 0, 0, 0]))

  encodeSimpleMorphPass(dilateHPipeline, srcTex, tempA, dilateParamsBuf)
  encodeSimpleMorphPass(dilateVPipeline, tempA,  tempC, dilateParamsBuf)
  encodeSimpleMorphPass(erodeHPipeline,  srcTex, tempA, erodeParamsBuf)
  encodeSimpleMorphPass(erodeVPipeline,  tempA,  tempB, erodeParamsBuf)

  this.pendingDestroyBuffers.push(erodeParamsBuf)
}

// ── Stroke mask derivation (Pass 5): morphological results → stroke mask in tempA ──

// For outside: morphATex=tempB (dilated), morphBTex=dummy (srcTex, not read)
// For inside:  morphATex=dummy (srcTex, not read), morphBTex=tempB (eroded)
// For center:  morphATex=tempC (dilated), morphBTex=tempB (eroded)
const MODE_MAP = { outside: 0, inside: 1, center: 2 }
const maskParamsBuf = createUniformBuffer(device, 16)
writeUniformBuffer(device, maskParamsBuf, new Uint32Array([MODE_MAP[position], 0, 0, 0]))

const morphATex = position === 'center' ? tempC : (position === 'outside' ? tempB : srcTex)
const morphBTex = position === 'center' ? tempB : (position === 'inside'  ? tempB : srcTex)

const maskBG = device.createBindGroup({
  layout: this.outlineMaskPipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: srcTex.createView()   },
    { binding: 1, resource: morphATex.createView() },
    { binding: 2, resource: morphBTex.createView() },
    { binding: 3, resource: tempA.createView()    },
    { binding: 4, resource: { buffer: maskParamsBuf } },
  ],
})
const maskPass = encoder.beginComputePass()
maskPass.setPipeline(this.outlineMaskPipeline)
maskPass.setBindGroup(0, maskBG)
maskPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
maskPass.end()

// ── Softness blur: 3× H+V box blur on stroke mask in tempA (ping-pong tempA↔tempB) ──

// After mask pass, stroke mask is in tempA.r
// Start of each H pass: src=tempA → dst=tempB, then swap → src=tempB
// Start of each V pass: src=tempB → dst=tempA, then swap → src=tempA
// After 3 complete H+V iterations: workingSrc is back at tempA
let strokeMaskTex: GPUTexture = tempA
if (softness > 0) {
  const blurParamsBuf = createUniformBuffer(device, 16)
  writeUniformBuffer(device, blurParamsBuf, new Uint32Array([blurR, 0, 0, 0]))

  let workingSrc = tempA
  let workingDst = tempB

  for (let i = 0; i < 3; i++) {
    encodeSimpleMorphPass(this.outlineBlurHPipeline, workingSrc, workingDst, blurParamsBuf)
    ;[workingSrc, workingDst] = [workingDst, workingSrc]
    encodeSimpleMorphPass(this.outlineBlurVPipeline, workingSrc, workingDst, blurParamsBuf)
    ;[workingSrc, workingDst] = [workingDst, workingSrc]
  }

  strokeMaskTex = workingSrc  // tempA after 6 even swaps
  this.pendingDestroyBuffers.push(blurParamsBuf)
}

// ── Composite (Pass 8): source + stroke mask → dstTex ────────────────────────

const compBuf = new ArrayBuffer(32)
const cf = new Float32Array(compBuf)
cf[0] = colorR; cf[1] = colorG; cf[2] = colorB; cf[3] = colorA
cf[4] = opacity
// cf[5..7] = 0 (padding, already zeroed)
const compParamsBuf = createUniformBuffer(device, 32)
device.queue.writeBuffer(compParamsBuf, 0, compBuf)

const maskFlagsArr = new Uint32Array(8); maskFlagsArr[0] = selMaskLayer ? 1 : 0
const maskFlagsBuf = createUniformBuffer(device, 32)
writeUniformBuffer(device, maskFlagsBuf, maskFlagsArr)

const dummyMask = selMaskLayer?.texture ?? srcTex

const compBG = device.createBindGroup({
  layout: this.outlineCompositePipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: srcTex.createView()          },
    { binding: 1, resource: strokeMaskTex.createView()   },
    { binding: 2, resource: dstTex.createView()          },
    { binding: 3, resource: { buffer: compParamsBuf }    },
    { binding: 4, resource: dummyMask.createView()       },
    { binding: 5, resource: { buffer: maskFlagsBuf }     },
  ],
})
const compPass = encoder.beginComputePass()
compPass.setPipeline(this.outlineCompositePipeline)
compPass.setBindGroup(0, compBG)
compPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
compPass.end()

this.pendingDestroyBuffers.push(dilateParamsBuf, maskParamsBuf, compParamsBuf, maskFlagsBuf)
```

> **`encodeSimpleMorphPass` helper** — a private inline helper (not a method) used within `encodeOutlinePass` to avoid repeating the bind-group/dispatch boilerplate for the 3-binding morph/blur passes:
> ```ts
> const encodeSimpleMorphPass = (
>   pipeline: GPUComputePipeline,
>   src: GPUTexture, dst: GPUTexture,
>   paramsBuf: GPUBuffer,
> ): void => {
>   const bg = device.createBindGroup({
>     layout: pipeline.getBindGroupLayout(0),
>     entries: [
>       { binding: 0, resource: src.createView() },
>       { binding: 1, resource: dst.createView() },
>       { binding: 2, resource: { buffer: paramsBuf } },
>     ],
>   })
>   const pass = encoder.beginComputePass()
>   pass.setPipeline(pipeline)
>   pass.setBindGroup(0, bg)
>   pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
>   pass.end()
> }
> ```

#### Total compute passes by position

| Position | DilateH | DilateV | ErodeH | ErodeV | Mask | BlurH×3 | BlurV×3 | Composite | Total (softness=0) | Total (softness>0) |
|---|---|---|---|---|---|---|---|---|---|---|
| outside | ✓ | ✓ | — | — | ✓ | — | ✓ | 4 | 10 |
| inside  | — | — | ✓ | ✓ | ✓ | — | ✓ | 4 | 10 |
| center  | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | 6 | 12 |

### `encodeAdjustmentOp()` dispatch branch

Add immediately before the `const _exhaustive: never = entry` guard, after the `'glow'` branch:

```ts
if (entry.kind === 'outline') {
  this.encodeOutlinePass(
    encoder, srcTex, dstTex,
    entry.colorR, entry.colorG, entry.colorB, entry.colorA,
    entry.opacity,
    entry.thickness, entry.position, entry.softness,
    entry.selMaskLayer,
  )
  return
}
```

---

## `canvasPlan.ts` Addition

Add the following branch to `buildAdjustmentEntry()` before the `const _exhaustive: never = ls` guard, after the `'glow'` branch:

```ts
if (ls.adjustmentType === 'outline') {
  const { color, opacity, thickness, position, softness } = ls.params
  return {
    kind:      'outline',
    layerId:   ls.id,
    colorR:    color.r / 255,
    colorG:    color.g / 255,
    colorB:    color.b / 255,
    colorA:    color.a / 255,
    opacity:   opacity / 100,
    thickness: Math.round(thickness),
    position,
    softness,
    visible:      ls.visible,
    selMaskLayer: mask,
  }
}
```

---

## New Components

### `OutlineOptions` panel

- **Category**: panel
- **Responsibility**: renders all five outline controls and dispatches `UPDATE_ADJUSTMENT_LAYER` on change
- **Props**: `{ layer: OutlineAdjustmentLayer; parentLayerName: string }`

**Controls:**

| Control | DOM form | Range | Clamping |
|---|---|---|---|
| **Color** | `ColorSwatch` + hex text input | RGBA | — |
| **Opacity** | slider + number input | 0–100 | `Math.min(100, Math.max(0, v))` |
| **Thickness** | slider + number input | 1–100 | `Math.min(100, Math.max(1, Math.round(v)))` |
| **Position** | `<select>` with Outside / Inside / Center | — | — |
| **Softness** | slider + number input | 0–50 | `Math.min(50, Math.max(0, v))` |

No Blend Mode, Knockout, X Offset, or Y Offset controls.

The Thickness number input enforces integer values via `Math.round()` before dispatch, and the `step={1}` attribute on the slider keeps the value integer during drag. Non-integer input is rounded on blur/change, consistent with the spec.

The component follows the exact `row` / `trackWrap` / `numInput` / `label` / `unitLabel` layout class structure used in `GlowOptions.module.scss`. A new `OutlineOptions.module.scss` file is created — copying and adapting `GlowOptions.module.scss` is appropriate.

The `update` helper pattern matches `GlowOptions`:

```tsx
const update = (patch: Partial<typeof p>): void => {
  dispatch({ type: 'UPDATE_ADJUSTMENT_LAYER', payload: { ...layer, params: { ...p, ...patch } } })
}
```

### `AdjustmentPanel.tsx` changes

**1. Import additions:**

```tsx
import type { ..., GlowAdjustmentLayer, OutlineAdjustmentLayer } from '@/types'
import { OutlineOptions } from '../OutlineOptions/OutlineOptions'
```

**2. `adjustmentTitle()` switch — add case:**

```ts
case 'outline': return 'Outline'
```

**3. New `OutlineHeaderIcon` inline component** (add after `GlowHeaderIcon`):

```tsx
const OutlineHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="3" y="3" width="6" height="6" />
    <rect x="1" y="1" width="10" height="10" />
  </svg>
)
```

**4. `AdjPanelIcon` function — add branch** (after the `'glow'` branch):

```tsx
if (type === 'outline') return <OutlineHeaderIcon />
```

**5. Render block** (add after the `'glow'` block):

```tsx
{adjLayer.adjustmentType === 'outline' && (
  <OutlineOptions
    layer={adjLayer as OutlineAdjustmentLayer}
    parentLayerName={parentLayerName}
  />
)}
```

### `src/components/index.ts`

Export `OutlineOptions` following the same pattern as the `GlowOptions` export.

---

## Implementation Steps

1. **`src/types/index.ts`** — add `'outline'` to `AdjustmentType`; add `OutlineParams` to `AdjustmentParamsMap`; add `OutlineAdjustmentLayer` interface; add `OutlineAdjustmentLayer` to `AdjustmentLayerState`.

2. **`src/adjustments/registry.ts`** — append the `'outline'` entry after `'glow'` with `group: 'real-time-effects'` and the default params listed above.

3. **`src/webgpu/shaders/adjustments/outline.ts`** — create the file; export eight WGSL string constants: `OUTLINE_DILATE_H_COMPUTE`, `OUTLINE_DILATE_V_COMPUTE`, `OUTLINE_ERODE_H_COMPUTE`, `OUTLINE_ERODE_V_COMPUTE`, `OUTLINE_MASK_COMPUTE`, `OUTLINE_BLUR_H_COMPUTE`, `OUTLINE_BLUR_V_COMPUTE`, `OUTLINE_COMPOSITE_COMPUTE`. Use the shader code and struct layouts specified above. Follow the `/* wgsl */` template literal comment convention used in `drop-shadow.ts`.

4. **`src/webgpu/WebGPURenderer.ts`** (a):
   - Add `'outline'` `AdjustmentRenderOp` variant to the union.
   - Add the 8 pipeline fields and `outlineTexCache` field in the class body, grouped with the drop-shadow pipelines.
   - Import the new shader constants.
   - Initialize the 8 pipelines in the constructor, following the same `device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: ... }), entryPoint: '...' } })` pattern used for the shadow pipelines. The dilate/erode/blur pipelines use the 3-binding layout; the mask pipeline uses the 5-binding layout; the composite pipeline uses the 6-binding layout.

5. **`src/webgpu/WebGPURenderer.ts`** (b):
   - Add `ensureOutlineTextures()` after `ensureShadowTextures()`.
   - Add `encodeOutlinePass()` after `encodeDropShadowPass()`.
   - Add the `'outline'` branch in `encodeAdjustmentOp()` before the `_exhaustive` guard.
   - Add outline texture cleanup in the canvas resize handler and `destroy()` method alongside the shadow texture cleanup.

6. **`src/components/window/Canvas/canvasPlan.ts`** — add the `'outline'` branch in `buildAdjustmentEntry()` before the `_exhaustive` guard.

7. **`src/components/panels/OutlineOptions/OutlineOptions.tsx`** — create the panel component with all five controls. Model the file structure on `GlowOptions.tsx`.

8. **`src/components/panels/OutlineOptions/OutlineOptions.module.scss`** — create the stylesheet. Copy `GlowOptions.module.scss` as a starting point; no structural changes are needed since the row layout is identical.

9. **`src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`** — apply all four changes: import, `adjustmentTitle` case, `OutlineHeaderIcon` component, `AdjPanelIcon` branch, and render block.

10. **`src/components/index.ts`** — add `OutlineOptions` export.

11. **Typecheck** — run `npm run typecheck` to confirm no exhaustiveness errors remain in `adjustmentTitle`, `AdjPanelIcon`, `buildAdjustmentEntry`, and `encodeAdjustmentOp`.

---

## Architectural Constraints

- **No reuse of Drop Shadow pipelines**: Outline's dilate/erode/blur shaders are structurally similar to the Drop Shadow dilate/blur shaders, but they are new `GPUComputePipeline` instances created from new `GPUShaderModule` instances. This avoids any implicit coupling between the two effects and keeps the pipeline initialization self-contained.
- **`outlineTexCache` lifecycle**: the cache is invalidated (destroyed and nulled) whenever the canvas is resized, exactly matching the `shadowTexCache` pattern. `ensureOutlineTextures()` recreates them lazily on the next pass.
- **Morph radius 0 edge case**: when `position === 'center'` and `thickness === 1`, `erodeR = floor(0.5) = 0`. The erode passes still execute with `radius = 0`, which degenerates to a single-sample identity copy (the loop runs once with `dx = 0`). This is correct and produces the expected result (only dilation outward by 1 px).
- **Softness blur convergence**: blurR = `Math.round(softness × 0.577)`. At `softness = 0`, `blurR = 0` and the blur passes are skipped entirely. At `softness = 1`, `blurR = 1` (minimum clamped). At `softness = 50`, `blurR = 29`.
- **Rasterization pipeline**: the outline adjustment type participates in the unified rasterization pipeline (`src/rasterization/`) via the standard `encodeAdjustmentOp` dispatch, which is already called by the rasterization entry point. No separate rasterization path is needed.
- **CSS Modules**: `OutlineOptions.module.scss` must use the `.module.scss` extension. A plain `.scss` import would resolve to `undefined` at runtime under Vite.
- **Integer thickness**: the `OutlineOptions` panel rounds thickness values on change. `canvasPlan.ts` also applies `Math.round()` as a belt-and-suspenders guard before passing to the renderer. The renderer itself does not assume integer input.

---

## Open Questions

1. **Anti-aliasing of morphological boundaries**: the separable 1D max/min filters produce rectangular (non-circular) morphological shapes at large radii. For a circular stroke shape, a proper 2D dilation would be needed. The spec does not specify the shape of the dilation kernel, but users may notice that diagonal corners of a thick outside stroke are slightly squared. Consider documenting this as a known approximation or replacing with a circular SDF-based approach in a follow-up.

2. **Center mode with `thickness = 1`**: `erodeR = 0` means the center stroke is effectively identical to outside with `thickness = 1`. The spec notes this as expected ("by design"). No code change needed, but worth surfacing to design if the interaction is surprising.

3. **Parent opacity interaction**: the spec states that a parent layer at 50% opacity attenuates the silhouette mask used for outline derivation. This is handled automatically because `srcTex` in the render plan is the composited parent texture (which has already had opacity applied). No explicit opacity-scaling logic is needed in the outline shaders; verify that the existing compositing pipeline passes the opacity-composited parent texture as `srcTex` for adjustment groups, as it does for Drop Shadow.
