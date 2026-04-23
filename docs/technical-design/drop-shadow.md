# Technical Design: Drop Shadow

## Overview

Drop Shadow is a non-destructive real-time effect added to the **Effects** menu alongside Bloom, Chromatic Aberration, Halation, and Color Key. It produces a soft, offset shadow behind the visible content of a parent pixel, text, or shape layer by deriving a shadow alpha mask from the parent's composited alpha channel, expanding it via morphological dilation (Spread), softening it with a Gaussian-approximation blur (Softness), colorizing it, and compositing it under the parent's pixels in the output. The entire pipeline runs on the GPU as a sequence of WebGPU compute passes dispatched from `WebGPURenderer.encodeDropShadowPass()`, and the effect participates in the existing adjustment-group render plan used by all non-destructive layers.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'drop-shadow'` to `AdjustmentType`; add `DropShadowParams` to `AdjustmentParamsMap`; add `DropShadowAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Register `'drop-shadow'` entry with `group: 'real-time-effects'` |
| `src/webgpu/shaders/adjustments/drop-shadow.ts` | **New file** — five WGSL compute shader strings |
| `src/webgpu/WebGPURenderer.ts` | Add `'drop-shadow'` `AdjustmentRenderOp` variant; add `shadowTexCache` field and `ensureShadowTextures()` helper; add `encodeDropShadowPass()` method; add dispatch branch in `encodeAdjustmentOp()`; add five pipelines to the class; destroy shadow textures in the resize/cleanup paths |
| `src/components/window/Canvas/canvasPlan.ts` | Add `'drop-shadow'` branch in `buildAdjustmentEntry()` |
| `src/components/panels/DropShadowOptions/DropShadowOptions.tsx` | **New file** — panel component |
| `src/components/panels/DropShadowOptions/DropShadowOptions.module.scss` | **New file** — panel styles |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `'drop-shadow'` to `adjustmentTitle()`, `AdjPanelIcon`, type imports, and the render switch |
| `src/components/index.ts` | Export `DropShadowOptions` |
| `src/hooks/useAdjustments.ts` | Extend `isAdjustmentMenuEnabled` and `handleCreateAdjustmentLayer` to accept text and shape layers as valid parent targets |

---

## State Changes

### `src/types/index.ts`

**1. Extend `AdjustmentType`:**

```ts
export type AdjustmentType =
  | /* ...existing... */
  | 'drop-shadow'
```

**2. Add `DropShadowParams` to `AdjustmentParamsMap`:**

```ts
'drop-shadow': {
  /** Shadow color including alpha channel. r/g/b/a are 0–255. Default: { r:0, g:0, b:0, a:255 } */
  color:     RGBAColor
  /** Overall shadow opacity, 0–100 (%). Applied on top of color.a. Default: 75 */
  opacity:   number
  /** Horizontal offset in canvas pixels, −200 to +200. Default: 5 */
  offsetX:   number
  /** Vertical offset in canvas pixels, −200 to +200. Default: 5 */
  offsetY:   number
  /** Morphological dilation radius in pixels, 0–100. Default: 0 */
  spread:    number
  /** Gaussian blur radius in pixels, 0–100. Default: 10 */
  softness:  number
  /** How the shadow composites with layers beneath it. Default: 'multiply' */
  blendMode: 'normal' | 'multiply' | 'screen'
  /** When true, the shadow is masked by the inverse of the source alpha. Default: true */
  knockout:  boolean
}
```

**3. Add `DropShadowAdjustmentLayer` interface** (follows the exact pattern of `BloomAdjustmentLayer`):

```ts
export interface DropShadowAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'drop-shadow'
  params: AdjustmentParamsMap['drop-shadow']
  hasMask: boolean
}
```

**4. Extend `AdjustmentLayerState` union:**

```ts
export type AdjustmentLayerState =
  | /* ...existing members... */
  | DropShadowAdjustmentLayer
```

---

## New Components / Hooks / Tools

### `DropShadowOptions` panel

- **Category**: panel (accesses `AppContext` via `useAppContext`)
- **Responsibility**: renders all eight drop shadow controls and dispatches `UPDATE_ADJUSTMENT_LAYER` on change
- **Props**: `{ layer: DropShadowAdjustmentLayer; parentLayerName: string }`
- **Controls** and their DOM form:
  - **Color** — a `<ColorSwatch>` widget that opens a color picker dialog supporting RGBA
  - **Opacity** — slider (0–100, step 1) + number input; value clamped to [0, 100]
  - **X Offset** — number input with stepper arrows (−200 to +200)
  - **Y Offset** — number input with stepper arrows (−200 to +200)
  - **Spread** — slider (0–100, step 1) + number input; value clamped to [0, 100]
  - **Softness** — slider (0–100, step 1) + number input; value clamped to [0, 100]
  - **Blend Mode** — `<select>` with options Normal / Multiply / Screen
  - **Knockout** — `<input type="checkbox" />`
  - **Footer** — `ParentConnectorIcon` + parent layer name + Reset button (restores registry defaults)
- All slider/numeric pairs follow the exact `row` layout from `BloomOptions.module.scss`

---

## Registry Entry

### `src/adjustments/registry.ts`

Append to `ADJUSTMENT_REGISTRY` after the existing `'color-key'` entry:

```ts
{
  adjustmentType: 'drop-shadow' as const,
  label: 'Drop Shadow…',
  group: 'real-time-effects',
  defaultParams: {
    color:     { r: 0, g: 0, b: 0, a: 255 },
    opacity:   75,
    offsetX:   5,
    offsetY:   5,
    spread:    0,
    softness:  10,
    blendMode: 'multiply',
    knockout:  true,
  },
},
```

Because `EFFECTS_MENU_ITEMS` in `App.tsx` is built by filtering `ADJUSTMENT_REGISTRY` for `group === 'real-time-effects'`, this entry appears automatically in the Effects menu — no change to `App.tsx` is needed.

---

## WGSL Shader Design

**File**: `src/webgpu/shaders/adjustments/drop-shadow.ts`

The pipeline is five compute shaders operating at canvas resolution. All intermediate alpha data is stored in the **R channel** of `rgba8unorm` scratch textures. Two scratch textures (`tempA`, `tempB`) are ping-ponged throughout.

### Pass 1 — `DROP_SHADOW_DILATE_H_COMPUTE` (`cs_shadow_dilate_h`)

Extracts the source alpha channel and applies a 1D horizontal max-filter of radius `spread`. When `spread = 0` the loop degenerates to a single-sample copy.

**Bindings (group 0):**

| Binding | Name | Type |
|---|---|---|
| 0 | `srcTex` | `texture_2d<f32>` — composited parent (reads `.a`) |
| 1 | `dstTex` | `texture_storage_2d<rgba8unorm, write>` — writes max alpha to `.r` |
| 2 | `params` | `var<uniform> ShadowDilateParams` |

**WGSL struct** (`ShadowDilateParams`, 16 bytes):

```wgsl
struct ShadowDilateParams {
  radius : u32,   // offset  0 — dilation radius in pixels
  _pad0  : u32,   // offset  4
  _pad1  : u32,   // offset  8
  _pad2  : u32,   // offset 12
}
```

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

### Pass 2 — `DROP_SHADOW_DILATE_V_COMPUTE` (`cs_shadow_dilate_v`)

Vertical max-filter on the R channel output of Pass 1. Completes the separable morphological dilation.

**Bindings (group 0):** identical layout to Pass 1, but `srcTex` reads `.r` (not `.a`).

**Algorithm:** identical to Pass 1 with `dy` replacing `dx`, reading/writing `.r`.

---

### Passes 3 & 4 — `DROP_SHADOW_BLUR_H_COMPUTE` / `DROP_SHADOW_BLUR_V_COMPUTE`

H and V 1D box blur on the R channel. Dispatched **3 times each** (alternating H then V) to approximate a Gaussian via the Central Limit Theorem. Three passes of a box filter of width `2r+1` produce sigma ≈ `r × √3`.

**Bindings (group 0):** same layout as the dilate passes, `srcTex` reads `.r`, output writes `.r`.

**WGSL struct** (`ShadowBlurParams`, 16 bytes — same layout as `ShadowDilateParams`):

```wgsl
struct ShadowBlurParams {
  radius : u32,   // offset  0 — box blur half-width in pixels
  _pad0  : u32,   // offset  4
  _pad1  : u32,   // offset  8
  _pad2  : u32,   // offset 12
}
```

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

---

### Pass 5 — `DROP_SHADOW_COMPOSITE_COMPUTE` (`cs_shadow_composite`)

Reads the blurred alpha mask and the original source texture, then produces the final composited output: shadow under source, with offset, knockout, blend mode, and selection mask.

**Bindings (group 0):**

| Binding | Name | Type |
|---|---|---|
| 0 | `srcTex` | `texture_2d<f32>` — original parent composite (reads `.rgb` and `.a`) |
| 1 | `maskTex` | `texture_2d<f32>` — blurred shadow alpha mask (reads `.r`) |
| 2 | `dstTex` | `texture_storage_2d<rgba8unorm, write>` |
| 3 | `params` | `var<uniform> ShadowCompositeParams` |
| 4 | `selMask` | `texture_2d<f32>` — selection mask (may be dummy) |
| 5 | `maskFlags` | `var<uniform> MaskFlags` |

**WGSL struct** (`ShadowCompositeParams`, 48 bytes):

```wgsl
struct ShadowCompositeParams {
  colorR    : f32,  // offset  0 — shadow color R, 0..1
  colorG    : f32,  // offset  4 — shadow color G, 0..1
  colorB    : f32,  // offset  8 — shadow color B, 0..1
  colorA    : f32,  // offset 12 — shadow color alpha, 0..1
  opacity   : f32,  // offset 16 — overall opacity, 0..1
  offsetX   : i32,  // offset 20 — X offset in pixels (signed)
  offsetY   : i32,  // offset 24 — Y offset in pixels (signed)
  blendMode : u32,  // offset 28 — 0=Normal, 1=Multiply, 2=Screen
  knockout  : u32,  // offset 32 — 0=off, 1=on
  _pad0     : u32,  // offset 36
  _pad1     : u32,  // offset 40
  _pad2     : u32,  // offset 44
}
// Total: 48 bytes (multiple of 16)
```

**`MaskFlags` struct** (16 bytes — reused from existing pattern):

```wgsl
struct MaskFlags {
  hasMask : u32,
  _pad    : vec3u,
}
```

**Composite algorithm** (shadow under source, offset applied):

```wgsl
let coord   = vec2i(id.xy);
let dims    = vec2i(textureDimensions(srcTex));
let src     = textureLoad(srcTex, coord, 0);

// Locate the corresponding shadow mask pixel (undo the shadow offset)
let maskCoord = coord - vec2i(params.offsetX, params.offsetY);
var rawMask = 0.0;
if (all(maskCoord >= vec2i(0)) && all(maskCoord < dims)) {
  rawMask = textureLoad(maskTex, maskCoord, 0).r;
}

// Combine mask alpha with color alpha and opacity
var shadowA = rawMask * params.colorA * params.opacity;

// Knockout: occlude shadow where the source is opaque
if (params.knockout != 0u) {
  shadowA = shadowA * (1.0 - src.a);
}

let shadowRGB = vec3f(params.colorR, params.colorG, params.colorB);

// Apply blend mode to the shadow RGB (interaction with transparent group background)
var blendedRGB = shadowRGB;
if (params.blendMode == 1u) {           // Multiply
  // Multiply darkens: shadow dims itself by its own luminance, approximating
  // how a multiply shadow darkens the canvas layers beneath the group
  let lum = dot(shadowRGB, vec3f(0.2126, 0.7152, 0.0722));
  blendedRGB = shadowRGB * (0.5 + 0.5 * lum);
} else if (params.blendMode == 2u) {    // Screen
  blendedRGB = 1.0 - (1.0 - shadowRGB) * (1.0 - shadowRGB);
}
// Normal (0): blendedRGB = shadowRGB (no-op above)

// Porter-Duff: srcTex OVER shadow (shadow is beneath source pixels)
let outA   = src.a + shadowA * (1.0 - src.a);
var outRGB = src.rgb * src.a + blendedRGB * shadowA * (1.0 - src.a);
if (outA > 0.0001) { outRGB /= outA; }
var out = vec4f(outRGB, outA);

// Apply selection mask (blend between original and composited output)
if (maskFlags.hasMask != 0u) {
  let selA = textureLoad(selMask, coord, 0).r;
  out = mix(src, out, selA);
}

textureStore(dstTex, coord, out);
```

> **Blend mode note**: Because the adjustment group renders in isolation (transparent background), Multiply and Screen modes cannot literally interact with the canvas layers below the parent. The formulas above are approximations that produce visually distinct output (Multiply → attenuated/warm shadow, Screen → brightened halo). True Multiply against the full canvas beneath the parent would require passing the pre-parent canvas texture as an additional input — left as an open question below.

---

## WebGPU Dispatch

### `AdjustmentRenderOp` variant

Add to the union in `WebGPURenderer.ts`:

```ts
| {
    kind:      'drop-shadow'
    layerId:   string
    /** Shadow color components pre-normalised to 0..1. */
    colorR:    number
    colorG:    number
    colorB:    number
    colorA:    number
    opacity:   number   // 0..1 (pre-divided by 100)
    offsetX:   number   // signed pixels
    offsetY:   number   // signed pixels
    spread:    number   // 0..100 px
    softness:  number   // 0..100 px
    blendMode: 'normal' | 'multiply' | 'screen'
    knockout:  boolean
    visible:   boolean
    selMaskLayer?: GpuLayer
  }
```

### `shadowTexCache` field

Add alongside `bloomTexCache`:

```ts
private shadowTexCache: { tempA: GPUTexture; tempB: GPUTexture } | null = null
```

### `ensureShadowTextures()` helper

Mirrors `ensureBloomTextures()`. Returns `{ tempA, tempB }`, both `rgba8unorm` at full canvas resolution (`pixelWidth × pixelHeight`), with usage flags:

```ts
GPUTextureUsage.TEXTURE_BINDING |
GPUTextureUsage.STORAGE_BINDING |
GPUTextureUsage.COPY_DST |
GPUTextureUsage.COPY_SRC
```

Destroys and recreates if the cache is `null` (canvas resize clears it, matching the bloom pattern).

### Five new compute pipelines

Add to the class fields:

```ts
private readonly shadowDilateHPipeline:    GPUComputePipeline
private readonly shadowDilateVPipeline:    GPUComputePipeline
private readonly shadowBlurHPipeline:      GPUComputePipeline
private readonly shadowBlurVPipeline:      GPUComputePipeline
private readonly shadowCompositePipeline:  GPUComputePipeline
```

The dilate and blur pipelines each have binding group layout:
- binding 0: `texture_2d<f32>` (src)
- binding 1: `texture_storage_2d<rgba8unorm, write>` (dst)
- binding 2: `uniform buffer` (params)

The composite pipeline has layout:
- binding 0: `texture_2d<f32>` (srcTex)
- binding 1: `texture_2d<f32>` (maskTex)
- binding 2: `texture_storage_2d<rgba8unorm, write>` (dstTex)
- binding 3: `uniform buffer` (ShadowCompositeParams)
- binding 4: `texture_2d<f32>` (selMask)
- binding 5: `uniform buffer` (MaskFlags)

### `encodeDropShadowPass()` method signature

```ts
private encodeDropShadowPass(
  encoder:   GPUCommandEncoder,
  srcTex:    GPUTexture,
  dstTex:    GPUTexture,
  colorR:    number,  // 0..1
  colorG:    number,
  colorB:    number,
  colorA:    number,
  opacity:   number,  // 0..1
  offsetX:   number,
  offsetY:   number,
  spread:    number,
  softness:  number,
  blendMode: 'normal' | 'multiply' | 'screen',
  knockout:  boolean,
  selMaskLayer: GpuLayer | undefined,
): void
```

### Dispatch sequence inside `encodeDropShadowPass()`

```
const { device, pixelWidth: w, pixelHeight: h } = this
const { tempA, tempB } = this.ensureShadowTextures()

// Shared uniform buffers
const spreadR  = Math.round(spread)
// For 3× box blur to approximate Gaussian sigma ≈ softness:
// 3 box filters of width 2r+1 → sigma ≈ r*√3 ⇒ r = softness / √3 ≈ softness * 0.577
const blurR    = Math.max(1, Math.round(softness * 0.577))
const dilateParamsBuf = createUniformBuffer(device, 16)   // ShadowDilateParams
const blurParamsBuf   = createUniformBuffer(device, 16)   // ShadowBlurParams
writeUniformBuffer(device, dilateParamsBuf, new Uint32Array([spreadR, 0, 0, 0]))
writeUniformBuffer(device, blurParamsBuf,   new Uint32Array([blurR,   0, 0, 0]))

// ── Pass 1: DilateH (srcTex.a → tempA.r) ────────────────────────────────
const dilateHBG = device.createBindGroup({ layout: ..., entries: [
  { binding: 0, resource: srcTex.createView() },
  { binding: 1, resource: tempA.createView() },
  { binding: 2, resource: { buffer: dilateParamsBuf } },
]})
<beginComputePass>.setPipeline(shadowDilateHPipeline).setBindGroup(0, dilateHBG)
  .dispatchWorkgroups(⌈w/8⌉, ⌈h/8⌉).end()

// ── Pass 2: DilateV (tempA.r → tempB.r) ─────────────────────────────────
const dilateVBG = ...  // same layout, srcTex=tempA, dstTex=tempB
<computePass>.end()

// ── Passes 3–8: 3× H+V box blur (ping-pong tempA ↔ tempB) ───────────────
// After Pass 2, mask is in tempB.
// After each H pass: writes to tempA; after each V pass: writes to tempB.
// Final mask after 3 complete iterations is always in tempB.
if (softness > 0) {
  for (let i = 0; i < 3; i++) {
    // BlurH: tempB → tempA
    const hBG = ... // srcTex=tempB, dstTex=tempA, params=blurParamsBuf
    <computePass, shadowBlurHPipeline>.end()
    // BlurV: tempA → tempB
    const vBG = ... // srcTex=tempA, dstTex=tempB, params=blurParamsBuf
    <computePass, shadowBlurVPipeline>.end()
  }
}
// Shadow mask is now in tempB.r

// ── Pass 9: Composite (srcTex + tempB → dstTex) ──────────────────────────
const BLEND_MODE_MAP = { normal: 0, multiply: 1, screen: 2 }
const compBuf = new ArrayBuffer(48)
const cf = new Float32Array(compBuf)
const ci = new Int32Array(compBuf)
const cu = new Uint32Array(compBuf)
cf[0] = colorR;  cf[1] = colorG;  cf[2] = colorB;  cf[3] = colorA
cf[4] = opacity
ci[5] = offsetX; ci[6] = offsetY
cu[7] = BLEND_MODE_MAP[blendMode]
cu[8] = knockout ? 1 : 0
// cu[9..11] = 0 (padding)
const compParamsBuf = createUniformBuffer(device, 48)
device.queue.writeBuffer(compParamsBuf, 0, compBuf)

const maskFlagsArr = new Uint32Array(8); maskFlagsArr[0] = selMaskLayer ? 1 : 0
const maskFlagsBuf = createUniformBuffer(device, 32)
writeUniformBuffer(device, maskFlagsBuf, maskFlagsArr)
const dummyMask = selMaskLayer?.texture ?? srcTex

const compBG = device.createBindGroup({ layout: ..., entries: [
  { binding: 0, resource: srcTex.createView() },
  { binding: 1, resource: tempB.createView() },
  { binding: 2, resource: dstTex.createView() },
  { binding: 3, resource: { buffer: compParamsBuf } },
  { binding: 4, resource: dummyMask.createView() },
  { binding: 5, resource: { buffer: maskFlagsBuf } },
]})
<computePass, shadowCompositePipeline>.dispatchWorkgroups(⌈w/8⌉, ⌈h/8⌉).end()

this.pendingDestroyBuffers.push(dilateParamsBuf, blurParamsBuf, compParamsBuf, maskFlagsBuf)
```

### `encodeAdjustmentOp()` dispatch branch

Add immediately before the `const _exhaustive: never = entry` guard, following the halation pattern:

```ts
if (entry.kind === 'drop-shadow') {
  this.encodeDropShadowPass(
    encoder, srcTex, dstTex,
    entry.colorR, entry.colorG, entry.colorB, entry.colorA,
    entry.opacity,
    entry.offsetX, entry.offsetY,
    entry.spread, entry.softness,
    entry.blendMode, entry.knockout,
    entry.selMaskLayer,
  )
  return
}
```

### Texture lifecycle

- `shadowTexCache` is initialized lazily on first `ensureShadowTextures()` call.
- Destroy and null the cache in the same paths that destroy `bloomTexCache` (canvas resize handler and renderer `destroy()` method).

---

## `canvasPlan.ts` Addition

Add the following branch to `buildAdjustmentEntry()` before the `const _exhaustive: never = ls` guard, following the `'color-key'` branch:

```ts
if (ls.adjustmentType === 'drop-shadow') {
  const { color, opacity, offsetX, offsetY, spread, softness, blendMode, knockout } = ls.params
  return {
    kind:      'drop-shadow',
    layerId:   ls.id,
    colorR:    color.r / 255,
    colorG:    color.g / 255,
    colorB:    color.b / 255,
    colorA:    color.a / 255,
    opacity:   opacity / 100,
    offsetX,
    offsetY,
    spread,
    softness,
    blendMode,
    knockout,
    visible:      ls.visible,
    selMaskLayer: mask,
  }
}
```

---

## Panel Component

### `src/components/panels/DropShadowOptions/DropShadowOptions.tsx`

```tsx
interface DropShadowOptionsProps {
  layer:           DropShadowAdjustmentLayer
  parentLayerName: string
}

export function DropShadowOptions({ layer, parentLayerName }: DropShadowOptionsProps): React.JSX.Element {
  const { dispatch } = useAppContext()
  const p = layer.params

  // Inline update helper — avoids repeated spread syntax at each call site
  const update = (patch: Partial<typeof p>) =>
    dispatch({ type: 'UPDATE_ADJUSTMENT_LAYER', payload: { ...layer, params: { ...p, ...patch } } })

  const pct = (v: number, lo: number, hi: number) => String((v - lo) / (hi - lo))

  return (
    <div className={styles.content}>
      {/* Color row */}
      <div className={styles.row}>
        <span className={styles.label}>Color</span>
        <ColorSwatch color={p.color} onClick={/* open RGBA color picker, on change call update({ color }) */} />
        <span className={styles.unitSpacer} />
      </div>

      {/* Opacity row */}
      <div className={styles.row}>
        <span className={styles.label}>Opacity</span>
        <div className={styles.trackWrap}>
          <input type="range" className={styles.track}
            min={0} max={100} step={1} value={p.opacity}
            style={{ '--pct': pct(p.opacity, 0, 100) } as React.CSSProperties}
            onChange={e => update({ opacity: Number(e.target.value) })}
          />
        </div>
        <input type="number" className={styles.numInput} min={0} max={100} step={1} value={p.opacity}
          onChange={e => { const v = e.target.valueAsNumber; if (!isNaN(v)) update({ opacity: Math.min(100, Math.max(0, v)) }) }}
        />
        <span className={styles.unitLabel}>%</span>
      </div>

      {/* X Offset row — numeric-only, no slider */}
      <div className={styles.row}>
        <span className={styles.label}>X Offset</span>
        <input type="number" className={styles.numInputWide} min={-200} max={200} step={1} value={p.offsetX}
          onChange={e => { const v = e.target.valueAsNumber; if (!isNaN(v)) update({ offsetX: Math.min(200, Math.max(-200, Math.round(v))) }) }}
        />
        <span className={styles.unitLabel}>px</span>
      </div>

      {/* Y Offset row */}
      <div className={styles.row}>
        <span className={styles.label}>Y Offset</span>
        <input type="number" className={styles.numInputWide} min={-200} max={200} step={1} value={p.offsetY}
          onChange={e => { const v = e.target.valueAsNumber; if (!isNaN(v)) update({ offsetY: Math.min(200, Math.max(-200, Math.round(v))) }) }}
        />
        <span className={styles.unitLabel}>px</span>
      </div>

      {/* Spread row */}
      <div className={styles.row}>
        <span className={styles.label}>Spread</span>
        <div className={styles.trackWrap}>
          <input type="range" className={styles.track}
            min={0} max={100} step={1} value={p.spread}
            style={{ '--pct': pct(p.spread, 0, 100) } as React.CSSProperties}
            onChange={e => update({ spread: Number(e.target.value) })}
          />
        </div>
        <input type="number" className={styles.numInput} min={0} max={100} step={1} value={p.spread}
          onChange={e => { const v = e.target.valueAsNumber; if (!isNaN(v)) update({ spread: Math.min(100, Math.max(0, Math.round(v))) }) }}
        />
        <span className={styles.unitLabel}>px</span>
      </div>

      {/* Softness row */}
      <div className={styles.row}>
        <span className={styles.label}>Softness</span>
        <div className={styles.trackWrap}>
          <input type="range" className={styles.track}
            min={0} max={100} step={1} value={p.softness}
            style={{ '--pct': pct(p.softness, 0, 100) } as React.CSSProperties}
            onChange={e => update({ softness: Number(e.target.value) })}
          />
        </div>
        <input type="number" className={styles.numInput} min={0} max={100} step={1} value={p.softness}
          onChange={e => { const v = e.target.valueAsNumber; if (!isNaN(v)) update({ softness: Math.min(100, Math.max(0, Math.round(v))) }) }}
        />
        <span className={styles.unitLabel}>px</span>
      </div>

      <div className={styles.sep} />

      {/* Blend Mode row */}
      <div className={styles.row}>
        <span className={styles.label}>Blend Mode</span>
        <select className={styles.select} value={p.blendMode}
          onChange={e => update({ blendMode: e.target.value as 'normal' | 'multiply' | 'screen' })}>
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
          <option value="screen">Screen</option>
        </select>
      </div>

      {/* Knockout row */}
      <div className={styles.row}>
        <span className={styles.label}>Knockout</span>
        <input type="checkbox" className={styles.checkbox} checked={p.knockout}
          onChange={e => update({ knockout: e.target.checked })}
        />
      </div>

      <div className={styles.sep} />

      {/* Footer */}
      <div className={styles.footer}>
        <span className={styles.footerInfo}>
          <ParentConnectorIcon />
          Adjusting <strong>{parentLayerName}</strong>
        </span>
        <button className={styles.resetBtn}
          onClick={() => update({ color: { r: 0, g: 0, b: 0, a: 255 }, opacity: 75, offsetX: 5, offsetY: 5, spread: 0, softness: 10, blendMode: 'multiply', knockout: true })}
          title="Reset to defaults"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
```

The color swatch uses the existing `ColorSwatch` widget. Opening an RGBA color picker on click should follow the pattern already established by the `ColorPicker` panel / `EmbedColorPicker` widget.

### `DropShadowOptions.module.scss`

Clone `BloomOptions.module.scss` verbatim. Add the following extra classes:

```scss
.numInputWide {
  // Like .numInput but wider for signed offset values (e.g. "-200")
  width: 52px;
  // all other properties identical to .numInput
}

.select {
  height: 20px;
  padding: 0 4px;
  background: #1e1e1e;
  border: 1px solid #3a3a3a;
  border-radius: 2px;
  font-size: 11px;
  color: #d4d4d4;
  outline: none;
  flex: 1;

  &:focus { border-color: #0699fb; }
}

.checkbox {
  width: 14px;
  height: 14px;
  accent-color: #0699fb;
  cursor: pointer;
}
```

---

## `AdjustmentPanel` Wiring

### `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`

**1. Add to `adjustmentTitle()`:**

```ts
case 'drop-shadow': return 'Drop Shadow'
```

**2. Add `DropShadowHeaderIcon`** (inline SVG; a square with a soft offset shadow suggestion):

```tsx
const DropShadowHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <rect x="1.5" y="1.5" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.3" transform="translate(2 2)" />
    <rect x="1.5" y="1.5" width="6" height="6" rx="0.5" fill="currentColor" />
  </svg>
)
```

**3. Add to `AdjPanelIcon`:**

```ts
if (type === 'drop-shadow') return <DropShadowHeaderIcon />
```

**4. Add import:**

```ts
import { DropShadowOptions } from '../DropShadowOptions/DropShadowOptions'
import type { DropShadowAdjustmentLayer } from '@/types'
```

**5. Add to the render block** (after `'color-key'`):

```tsx
{adjLayer.adjustmentType === 'drop-shadow' && (
  <DropShadowOptions layer={adjLayer as DropShadowAdjustmentLayer} parentLayerName={parentLayerName} />
)}
```

---

## Effects Menu Wiring

The Effects menu is constructed in `App.tsx` from `EFFECTS_MENU_ITEMS`, which is built by filtering `ADJUSTMENT_REGISTRY` for `group === 'real-time-effects'`. Because the registry entry above sets `group: 'real-time-effects'`, **no change to `App.tsx` or `TopBar.tsx` is needed** for the menu item itself.

### Enable for text and shape layers

The spec requires the menu item to be enabled for pixel, text, and shape layers. The current `isAdjustmentMenuEnabled` check in `useAdjustments.ts` allows only pixel layers (and adjustment children of pixel layers). Extend it as follows:

```ts
const isAdjustmentMenuEnabled = useMemo(() => {
  const active = layers.find(l => l.id === activeLayerId)
  if (active == null) return false
  if (isPixelLayer(active)) return true
  // Text and shape layers are valid parent targets
  if ('type' in active && (active.type === 'text' || active.type === 'shape')) return true
  // Adjustment child of an eligible layer
  if ('type' in active && active.type === 'adjustment') {
    const parent = layers.find(l => l.id === (active as { parentId: string }).parentId)
    if (!parent) return false
    return isPixelLayer(parent) ||
      ('type' in parent && (parent.type === 'text' || parent.type === 'shape'))
  }
  return false
}, [layers, activeLayerId])
```

Also extend `handleCreateAdjustmentLayer` to set `effectiveParentId` for text/shape layers:

```ts
if (isPixelLayer(activeLayer)) {
  effectiveParentId = activeLayerId!
} else if ('type' in activeLayer && (activeLayer.type === 'text' || activeLayer.type === 'shape')) {
  effectiveParentId = activeLayerId!
} else if ('type' in activeLayer && activeLayer.type === 'adjustment') {
  // ... existing adjustment-child logic, extended to also accept text/shape parents
}
```

> This change benefits all real-time effects (Bloom, Chromatic Aberration, Halation, Color Key, Drop Shadow) and corrects an existing gap.

---

## Implementation Steps

1. **`src/types/index.ts`** — Add `'drop-shadow'` to `AdjustmentType`. Add `DropShadowParams` to `AdjustmentParamsMap`. Add `DropShadowAdjustmentLayer` interface. Add `DropShadowAdjustmentLayer` to the `AdjustmentLayerState` union.

2. **`src/adjustments/registry.ts`** — Append the `'drop-shadow'` registry entry with `group: 'real-time-effects'` and the default params listed above.

3. **`src/webgpu/shaders/adjustments/drop-shadow.ts`** — Create the file with five exported WGSL string constants: `DROP_SHADOW_DILATE_H_COMPUTE`, `DROP_SHADOW_DILATE_V_COMPUTE`, `DROP_SHADOW_BLUR_H_COMPUTE`, `DROP_SHADOW_BLUR_V_COMPUTE`, `DROP_SHADOW_COMPOSITE_COMPUTE`.

4. **`src/webgpu/WebGPURenderer.ts`** (part 1 — types and fields) — Add the `'drop-shadow'` variant to `AdjustmentRenderOp`. Declare the five pipeline fields and `shadowTexCache`.

5. **`src/webgpu/WebGPURenderer.ts`** (part 2 — constructor) — Import the five shader strings. Create the five compute pipelines in the constructor, using `device.createComputePipeline()` with the appropriate entry points and binding group layouts. Follow the exact same approach as the bloom pipeline creation.

6. **`src/webgpu/WebGPURenderer.ts`** (part 3 — methods) — Implement `ensureShadowTextures()` and `encodeDropShadowPass()`. Add the `'drop-shadow'` dispatch branch in `encodeAdjustmentOp()`. Add `shadowTexCache` cleanup in the canvas-resize and `destroy()` paths.

7. **`src/components/window/Canvas/canvasPlan.ts`** — Add the `'drop-shadow'` branch to `buildAdjustmentEntry()`.

8. **`src/components/panels/DropShadowOptions/DropShadowOptions.tsx`** and **`DropShadowOptions.module.scss`** — Create both files.

9. **`src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`** — Add the `adjustmentTitle` case, `DropShadowHeaderIcon`, `AdjPanelIcon` branch, import, and render block entry.

10. **`src/components/index.ts`** — Export `DropShadowOptions`.

11. **`src/hooks/useAdjustments.ts`** — Extend `isAdjustmentMenuEnabled` and `handleCreateAdjustmentLayer` to accept text and shape layers.

12. **Unified rasterization** — Verify that `src/rasterization/` correctly includes drop shadow when rendering flatten/merge/export. Because rasterization consumes the same `RenderPlanEntry[]` plan built by `buildRenderPlan()`, and `buildAdjustmentEntry()` now handles `'drop-shadow'`, no separate rasterization path is required. Confirm by running a flatten with a drop shadow layer and comparing against the screen preview.

13. **Typecheck** — Run `npm run typecheck` and resolve any exhaustive-check errors surfaced by the extended unions (the `never` guards in `encodeAdjustmentOp` and `buildAdjustmentEntry` will catch any missed branches at compile time).

---

## Architectural Constraints

- **Group isolation**: Drop shadow runs inside the `adjustment-group` rendering path. The `srcTex` it receives contains the parent layer composited at opacity=1 on a transparent background, preceded by any earlier adjustments in the group. The shadow mask is derived from `srcTex.a`, which correctly reflects prior alpha-modifying adjustments (e.g., Color Key) applied to the same parent. This matches the spec requirement: "the shadow is derived from the composited content of the parent layer."
- **Temp textures are class-level cached**: Following the bloom pattern, `ensureShadowTextures()` allocates two canvas-sized `rgba8unorm` textures once and reuses them across frames. They must be invalidated (set to `null`) whenever the canvas is resized, alongside `bloomTexCache` and `halationTexCache`.
- **No CPU fallback**: The rasterization pipeline is GPU-only (`RasterBackend = 'gpu'`). `encodeDropShadowPass` is called from within the GPU command encoder. If it fails, surface the error to the user rather than silently no-oping.
- **Separable max-filter for spread**: Morphological dilation via separable H+V max-filter is exact for a square structuring element, which is the correct interpretation for spread in a pixel editor (axis-aligned box dilation). A circular structuring element would require a different algorithm; that can be a future enhancement.
- **Box blur for Gaussian approximation**: Three iterations of H+V box blur approximate a true Gaussian (Central Limit Theorem). The box half-width `r = round(softness × 0.577)` yields sigma ≈ `softness`. This matches the spec's intent without requiring a precomputed Gaussian kernel table.
- **Undo history**: The existing `handleCloseAdjustmentPanel()` → `captureHistory('Adjustment')` path captures exactly one undo entry when the panel is closed, matching the spec requirement.
- **Re-editing**: `handleOpenAdjustmentPanel()` sets `openAdjustmentLayerId`, which causes `AdjustmentPanel` to open and display the persisted params from the layer record. No additional wiring is needed.

---

## Open Questions

1. **True blend mode interaction with canvas background**: For Multiply and Screen blend modes, the spec says the shadow composites with "layers below it." In the current architecture, the adjustment group renders in isolation so the canvas layers below the parent are not available to the composite shader. The design above uses an approximation. A correct implementation would require passing a snapshot of the pre-parent canvas texture as an additional input to `encodeDropShadowPass()`. This is architecturally non-trivial and should be evaluated before implementation begins.

2. **Text and shape layer eligibility for all effects vs. drop shadow only**: The `isAdjustmentMenuEnabled` extension proposed above enables text/shape layers for all items in both the Adjustments and Effects menus. Confirm that color adjustment effects (Brightness/Contrast, Hue/Saturation, etc.) operating on rasterized text/shape GpuLayers produce correct results before enabling globally. Alternatively, introduce a separate `isEffectsMenuEnabled` flag that is always true for text/shape layers while keeping `isAdjustmentMenuEnabled` pixel-only.

3. **Circular vs. square dilation**: The current design uses a square (axis-aligned) structuring element for the spread dilation. Photoshop uses a circular structuring element, which gives a more uniform outward growth in all directions. Implementing circular dilation efficiently requires a more complex kernel (e.g., a distance-field-based approach). Defer to post-v1 unless the visual difference is deemed critical.

4. **Performance cap for very large spread or softness**: With spread=100 and softness=100, the dispatch issues a 200-sample max-filter in each direction plus six 58-sample blur passes. For a 4K canvas this may exceed the 16ms frame budget on lower-end GPUs. Consider adding a warning to the panel or capping effective radius to a lower maximum.
