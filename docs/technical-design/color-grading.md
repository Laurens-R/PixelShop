# Technical Design: Color Grading

## Overview

The Color Grading adjustment is a non-destructive child layer that applies a professional primary color-correction stack — four tonal-range color wheels (Lift, Gamma, Gain, Offset) plus eleven global controls — to a parent pixel layer at render time without touching its pixel data. When the user triggers **Image → Color Grading…**, a `ColorGradingAdjustmentLayer` record is inserted into `state.layers` immediately after the active pixel layer (same positional contract as all other adjustment children), `openAdjustmentLayerId` is set to the new layer's ID, and `AdjustmentPanel` opens showing `ColorGradingPanel`. Parameter changes dispatch `UPDATE_ADJUSTMENT_LAYER` updates; on every such update `useCanvas` re-renders via the WebGL compositing pipeline, which now includes a GPU-side color-grading pass applied inline in the adjustment-group loop. No WASM is needed. One undo entry is recorded when the panel closes.

This design builds directly on top of the infrastructure established by `brightness-contrast.md`, `hue-saturation.md`, and `curves.md`. The `UPDATE_ADJUSTMENT_LAYER` action, `AdjustmentPanel` shell, `useAdjustments`, `buildRenderPlan` / `buildAdjustmentEntry`, `adjustment-group` compositing model, `adjustmentMaskMap`, and the `hasMask` serialization pattern are **already in place** — this document only specifies what is new or extended.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'color-grading'` to `AdjustmentType`; add `ColorGradingWheelParams` and `ColorGradingAdjustmentParams` to `AdjustmentParamsMap`; add `ColorGradingAdjustmentLayer`; extend `AdjustmentLayerState` |
| `src/adjustments/registry.ts` | Add `'color-grading'` entry to `ADJUSTMENT_REGISTRY` with default params |
| `src/webgl/shaders.ts` | Add `CG_FRAG` constant; vertex stage reuses existing `BC_VERT` |
| `src/webgl/WebGLRenderer.ts` | Extend `AdjustmentRenderOp` union with `color-grading` variant; add `cgProgram` private field; add `applyColorGradingPass`; extend `executePlanToComposite` dispatch |
| `src/components/window/Canvas/canvasPlan.ts` | Add `'color-grading'` case to `buildAdjustmentEntry` |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `case 'color-grading'` to title/icon switch and panel switch |
| `src/components/panels/ColorGradingPanel/ColorGradingPanel.tsx` | **New file.** Panel sub-component with four color wheels and three slider rows |
| `src/components/panels/ColorGradingPanel/ColorGradingPanel.module.scss` | **New file.** Scoped styles |
| `src/components/widgets/ColorWheelWidget/ColorWheelWidget.tsx` | **New file.** Canvas-based color wheel widget (props-only, no AppContext) |
| `src/components/widgets/ColorWheelWidget/ColorWheelWidget.module.scss` | **New file.** Scoped styles |
| `src/components/index.ts` | Export `ColorWheelWidget` if reuse by other panels is anticipated; otherwise no barrel export is required |

No changes are required to `src/store/AppContext.tsx`, `src/hooks/useAdjustments.ts`, `src/App.tsx`, or the rasterization pipeline entry point — the generic `UPDATE_ADJUSTMENT_LAYER` action, the `buildRenderPlan` grouping logic, the `GpuRasterPipeline`, and `readFlattenedPlan` will handle the new op variant automatically once the renderer dispatch is extended.

---

## State Changes

### New types in `src/types/index.ts`

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
  | 'color-grading'   // ← new
```

#### New shared wheel-params type

```ts
/**
 * Per-wheel parameters for one tonal range of the Color Grading adjustment.
 * r/g/b encode the per-channel color offset; master encodes the independent
 * brightness (luma) offset for that tonal range. All values are in [−1, 1],
 * default 0.  The puck position on the color wheel encodes r/g/b; the luma
 * ring encodes master.
 */
export interface ColorGradingWheelParams {
  r:      number  // −1..1
  g:      number  // −1..1
  b:      number  // −1..1
  master: number  // −1..1
}
```

#### Extend `AdjustmentParamsMap`

```ts
export interface AdjustmentParamsMap {
  // ...existing entries...
  'color-grading': {
    /** Tonal-range color wheels */
    lift:   ColorGradingWheelParams   // shadows
    gamma:  ColorGradingWheelParams   // midtones
    gain:   ColorGradingWheelParams   // highlights
    offset: ColorGradingWheelParams   // global (all luminance levels)
    /** Top row */
    temp:      number   // −100..100, default 0
    tint:      number   // −100..100, default 0
    contrast:  number   // 0..2,      default 1.0
    pivot:     number   // 0..1,      default 0.435
    midDetail: number   // −100..100, default 0
    /** Bottom row */
    colorBoost:  number // 0..100,    default 0
    shadows:     number // −100..100, default 0
    highlights:  number // −100..100, default 0
    saturation:  number // 0..100,    default 50 (50 = no change)
    hue:         number // 0..100,    default 50 (50 = no rotation)
    lumMix:      number // 0..100,    default 100
  }
}
```

#### New layer interface

```ts
export interface ColorGradingAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'color-grading'
  params: AdjustmentParamsMap['color-grading']
  /** True when a selection was active at creation time; baked mask pixels live
   *  in Canvas adjustmentMaskMap, not in React state. */
  hasMask: boolean
}
```

#### Extend `AdjustmentLayerState`

```ts
export type AdjustmentLayerState =
  | BrightnessContrastAdjustmentLayer
  | HueSaturationAdjustmentLayer
  | ColorVibranceAdjustmentLayer
  | ColorBalanceAdjustmentLayer
  | BlackAndWhiteAdjustmentLayer
  | ColorTemperatureAdjustmentLayer
  | ColorInvertAdjustmentLayer
  | SelectiveColorAdjustmentLayer
  | CurvesAdjustmentLayer
  | ColorGradingAdjustmentLayer   // ← new
```

---

## Registry Entry (`src/adjustments/registry.ts`)

Add after the `'curves'` entry:

```ts
{
  adjustmentType: 'color-grading' as const,
  label: 'Color Grading…',
  defaultParams: {
    lift:   { r: 0, g: 0, b: 0, master: 0 },
    gamma:  { r: 0, g: 0, b: 0, master: 0 },
    gain:   { r: 0, g: 0, b: 0, master: 0 },
    offset: { r: 0, g: 0, b: 0, master: 0 },
    temp:      0,
    tint:      0,
    contrast:  1.0,
    pivot:     0.435,
    midDetail: 0,
    colorBoost:  0,
    shadows:     0,
    highlights:  0,
    saturation:  50,
    hue:         50,
    lumMix:      100,
  },
},
```

**Default identity check:** With all params at these defaults the shader must produce output identical to the unmodified parent layer. The shader satisfies this because:
- All wheel R/G/B/master values are 0 → wheel ops are no-ops.
- `temp = 0`, `tint = 0` → no channel shift.
- `contrast = 1.0`, `pivot = 0.435` → identity (pivot cancels out at scale 1).
- `midDetail = 0` → no midtone curve.
- `shadows = 0`, `highlights = 0` → no toe/shoulder.
- `saturation = 50` → multiplier 1.0 (50/50) → no saturation change.
- `hue = 50` → rotation 0° → no hue shift.
- `colorBoost = 0` → no vibrance boost.
- `lumMix = 100` → luminosity-preserve at max → no net luma change when all other ops are identity.

---

## Pixel Processing Algorithm

All processing runs in the GPU fragment shader `CG_FRAG`. **No WASM is needed.** The shader operates on straight-RGBA float values ∈ [0, 1] and is structured as a sequential series of per-pixel operations. Each stage reads its input from the previous stage's output.

### Stage 1 — Temp / Tint

Shift the three channels by a temperature and tint offset.

$$
R \mathrel{+}= \frac{u\_temp}{100} \cdot 0.1
\qquad
G \mathrel{-}= \frac{u\_tint}{100} \cdot 0.05
\qquad
B \mathrel{-}= \frac{u\_temp}{100} \cdot 0.1
$$

Warm temperatures push R up and B down; cool temperatures do the inverse. Tint pushes G up (green) at negative values and pulls it down (magenta) at positive values.

### Stage 2 — Tonal-Range Color Wheels

Compute three luminance-based tonal masks from the **original luminance** $L_0 = 0.2126 R + 0.7152 G + 0.0722 B$ (Rec. 709, computed once before any wheel corrections).

$$
w_{shadow}    = 1 - L_0
\qquad
w_{mid}       = 4 \cdot L_0 \cdot (1 - L_0)
\qquad
w_{highlight} = L_0
$$

Each wheel applies its color offset and its luma (master) offset, weighted by its mask. The four wheels are applied in the canonical CDL order: **Lift → Gamma → Gain → Offset**.

**Lift** (shadows):
$$
R \mathrel{+}= (\mathit{lift.r} + \mathit{lift.master}) \cdot w_{shadow}
\qquad
G \mathrel{+}= (\mathit{lift.g} + \mathit{lift.master}) \cdot w_{shadow}
\qquad
B \mathrel{+}= (\mathit{lift.b} + \mathit{lift.master}) \cdot w_{shadow}
$$

The `master` term adds uniformly to all three channels (brightness), while the per-channel terms add the color offset.

**Gamma** (midtones):
$$
R \mathrel{+}= (\mathit{gamma.r} + \mathit{gamma.master}) \cdot w_{mid}
\qquad
G \mathrel{+}= (\mathit{gamma.g} + \mathit{gamma.master}) \cdot w_{mid}
\qquad
B \mathrel{+}= (\mathit{gamma.b} + \mathit{gamma.master}) \cdot w_{mid}
$$

**Gain** (highlights):
$$
R \mathrel{+}= (\mathit{gain.r} + \mathit{gain.master}) \cdot w_{highlight}
\qquad
G \mathrel{+}= (\mathit{gain.g} + \mathit{gain.master}) \cdot w_{highlight}
\qquad
B \mathrel{+}= (\mathit{gain.b} + \mathit{gain.master}) \cdot w_{highlight}
$$

**Offset** (global, no mask):
$$
R \mathrel{+}= \mathit{offset.r} + \mathit{offset.master}
\qquad
G \mathrel{+}= \mathit{offset.g} + \mathit{offset.master}
\qquad
B \mathrel{+}= \mathit{offset.b} + \mathit{offset.master}
$$

Clamp to [0, 1] after all four wheels.

### Stage 3 — Contrast

$$
R = \operatorname{clamp}\!\bigl((R - u\_pivot) \cdot u\_contrast + u\_pivot,\; 0,\; 1\bigr)
$$

Apply identically to G and B. At `contrast = 1.0` this is a pure identity: $(R - p) \cdot 1 + p = R$.

### Stage 4 — Mid/Detail

This is a per-pixel S-curve blend on the midtone luminance region, not a convolution. Compute the post-contrast luminance $L_1$.

$$
w_{mid1} = 4 \cdot L_1 \cdot (1 - L_1)
\qquad
\delta = \frac{u\_midDetail}{100} \cdot (L_1 - 0.5) \cdot w_{mid1}
$$

Add $\delta$ equally to each channel (luminance-only shift; no color introduced):

$$
R \mathrel{+}= \delta, \quad G \mathrel{+}= \delta, \quad B \mathrel{+}= \delta
$$

Positive `midDetail` expands the midtone contrast (clarity style). Negative values compress it. Clamp each channel after.

### Stage 5 — Shadows / Highlights

Compute $L_2$ from the current RGB. Use smooth masks to localize the effect:

$$
w_{sh} = 1 - \operatorname{smoothstep}(0.0,\; 0.5,\; L_2)
\qquad
w_{hl} = \operatorname{smoothstep}(0.5,\; 1.0,\; L_2)
$$

$$
\delta_{sh} = \frac{u\_shadows}{100} \cdot 0.5 \cdot w_{sh}
\qquad
\delta_{hl} = \frac{u\_highlights}{100} \cdot 0.5 \cdot w_{hl}
$$

Apply both offsets uniformly to all three channels. Clamp after.

### Stage 6 — Saturation

Convert RGB → HSL, apply the saturation multiplier, convert back.

$$
S_{out} = \operatorname{clamp}\!\left(S_{in} \cdot \frac{u\_saturation}{50},\; 0,\; 1\right)
$$

At `saturation = 50` the multiplier is 1.0 (identity). `saturation = 0` desaturates fully. `saturation = 100` doubles saturation.

### Stage 7 — Hue

Still in HSL:

$$
H_{out} = \operatorname{fract}\!\left(H_{in} + \frac{(u\_hue - 50) \cdot 3.6}{360}\right)
$$

At `hue = 50` the delta is 0° (identity). The range −50..+50 maps to −180°..+180° of rotation.

### Stage 8 — Color Boost (vibrance)

Convert back to RGB after Stages 6–7. Re-compute HSL saturation $S$ of the current pixel.

$$
\mathit{boost} = \frac{u\_colorBoost}{100} \cdot (1 - S)
\qquad
S_{out} = \operatorname{clamp}(S + \mathit{boost},\; 0,\; 1)
$$

Pixels with low existing saturation receive a proportionally larger boost (vibrance behaviour). At `colorBoost = 0` this is a no-op. Convert back to RGB.

### Stage 9 — Lum Mix

Blends the fully-corrected result with a luminosity-preserving version of it.

- `lumMix = 100` → output preserves the original luminance; only hue/chroma changes are visible.
- `lumMix = 0` → output uses the corrected RGB directly (all luminance shifts included).

```glsl
float origLum   = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
float corrLum   = dot(adjusted.rgb, vec3(0.2126, 0.7152, 0.0722));
vec3 lumPreserved = (corrLum > 0.0001)
    ? adjusted.rgb * (origLum / corrLum)
    : adjusted.rgb;
float lumMixFactor = u_lumMix / 100.0;
vec3 finalRgb = mix(adjusted.rgb, lumPreserved, lumMixFactor);
```

### Stage 10 — Selection mask blend

```glsl
float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
fragColor   = vec4(mix(src.rgb, finalRgb, mask), src.a);
```

Alpha is never altered. Fully-transparent pixels (`src.a < 0.0001`) exit early unchanged.

---

## GLSL Shader — `CG_FRAG` in `src/webgl/shaders.ts`

The vertex stage is identical to `BC_VERT` (already in `shaders.ts`). Only a fragment shader constant is added.

### Uniforms

Wheel params are passed as `vec4` (x=r, y=g, z=b, w=master) to keep the uniform count manageable.

```glsl
// Wheel uniforms (each component: −1..1)
uniform vec4 u_lift;      // .xyzw = r, g, b, master
uniform vec4 u_gamma;
uniform vec4 u_gain;
uniform vec4 u_offset;

// Top-row uniforms
uniform float u_temp;       // −100..100
uniform float u_tint;       // −100..100
uniform float u_contrast;   // 0..2
uniform float u_pivot;      // 0..1
uniform float u_midDetail;  // −100..100

// Bottom-row uniforms
uniform float u_colorBoost;  // 0..100
uniform float u_shadows;     // −100..100
uniform float u_highlights;  // −100..100
uniform float u_saturation;  // 0..100
uniform float u_hue;         // 0..100
uniform float u_lumMix;      // 0..100

// Mask
uniform sampler2D u_src;
uniform sampler2D u_selMask;
uniform bool u_hasSelMask;
```

### Fragment shader skeleton

```ts
export const CG_FRAG = /* glsl */ `#version 300 es
  precision highp float;

  // ── Uniforms ──────────────────────────────────────────────────────────────
  uniform sampler2D u_src;
  uniform vec4  u_lift;
  uniform vec4  u_gamma;
  uniform vec4  u_gain;
  uniform vec4  u_offset;
  uniform float u_temp;
  uniform float u_tint;
  uniform float u_contrast;
  uniform float u_pivot;
  uniform float u_midDetail;
  uniform float u_colorBoost;
  uniform float u_shadows;
  uniform float u_highlights;
  uniform float u_saturation;
  uniform float u_hue;
  uniform float u_lumMix;
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in  vec2 v_texCoord;
  out vec4 fragColor;

  // ── RGB ↔ HSL helpers ────────────────────────────────────────────────────
  // (identical implementations to HS_FRAG — see hue-saturation shader)
  vec3 rgb2hsl(vec3 c) { /* ... */ }
  vec3 hsl2rgb(vec3 hsl) { /* ... */ }

  // ── Main ─────────────────────────────────────────────────────────────────
  void main() {
    vec4 src = texture(u_src, v_texCoord);
    if (src.a < 0.0001) { fragColor = src; return; }

    vec3 rgb = src.rgb;

    // ── Stage 1: Temp / Tint ─────────────────────────────────────────────
    rgb.r += (u_temp / 100.0) * 0.1;
    rgb.g -= (u_tint / 100.0) * 0.05;
    rgb.b -= (u_temp / 100.0) * 0.1;
    rgb = clamp(rgb, 0.0, 1.0);

    // ── Stage 2: Wheels ───────────────────────────────────────────────────
    float origLum = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
    float wShadow    = 1.0 - origLum;
    float wMid       = 4.0 * origLum * (1.0 - origLum);
    float wHighlight = origLum;

    // Lift
    rgb += vec3(u_lift.x + u_lift.w,
                u_lift.y + u_lift.w,
                u_lift.z + u_lift.w) * wShadow;
    rgb = clamp(rgb, 0.0, 1.0);

    // Gamma
    rgb += vec3(u_gamma.x + u_gamma.w,
                u_gamma.y + u_gamma.w,
                u_gamma.z + u_gamma.w) * wMid;
    rgb = clamp(rgb, 0.0, 1.0);

    // Gain
    rgb += vec3(u_gain.x + u_gain.w,
                u_gain.y + u_gain.w,
                u_gain.z + u_gain.w) * wHighlight;
    rgb = clamp(rgb, 0.0, 1.0);

    // Offset (global, no mask)
    rgb += vec3(u_offset.x + u_offset.w,
                u_offset.y + u_offset.w,
                u_offset.z + u_offset.w);
    rgb = clamp(rgb, 0.0, 1.0);

    // ── Stage 3: Contrast ─────────────────────────────────────────────────
    rgb = clamp((rgb - u_pivot) * u_contrast + u_pivot, 0.0, 1.0);

    // ── Stage 4: Mid/Detail ───────────────────────────────────────────────
    float lum1  = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float wMid1 = 4.0 * lum1 * (1.0 - lum1);
    float delta = (u_midDetail / 100.0) * (lum1 - 0.5) * wMid1;
    rgb = clamp(rgb + delta, 0.0, 1.0);

    // ── Stage 5: Shadows / Highlights ────────────────────────────────────
    float lum2  = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float wSh   = 1.0 - smoothstep(0.0, 0.5, lum2);
    float wHl   = smoothstep(0.5, 1.0, lum2);
    float dsh   = (u_shadows    / 100.0) * 0.5 * wSh;
    float dhl   = (u_highlights / 100.0) * 0.5 * wHl;
    rgb = clamp(rgb + dsh + dhl, 0.0, 1.0);

    // ── Stages 6–7: Saturation + Hue (in HSL space) ──────────────────────
    vec3 hsl = rgb2hsl(rgb);
    hsl.y = clamp(hsl.y * (u_saturation / 50.0), 0.0, 1.0);
    hsl.x = fract(hsl.x + (u_hue - 50.0) * 3.6 / 360.0);
    rgb = hsl2rgb(hsl);

    // ── Stage 8: Color Boost (vibrance) ──────────────────────────────────
    vec3 hsl2  = rgb2hsl(rgb);
    float boost = (u_colorBoost / 100.0) * (1.0 - hsl2.y);
    hsl2.y = clamp(hsl2.y + boost, 0.0, 1.0);
    rgb = hsl2rgb(hsl2);

    // ── Stage 9: Lum Mix ─────────────────────────────────────────────────
    float corrLum     = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 lumPreserved = (corrLum > 0.0001) ? rgb * (origLum / corrLum) : rgb;
    rgb = clamp(mix(rgb, lumPreserved, u_lumMix / 100.0), 0.0, 1.0);

    // ── Stage 10: Selection mask blend ───────────────────────────────────
    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor  = vec4(mix(src.rgb, rgb, mask), src.a);
  }
`
```

**Precision:** The shader uses `highp float` (unlike the other adjustment shaders that use `mediump`) because the wheel parameters accumulate across four sequential additions. Using `mediump` here risks banding artefacts at the 4-bit mantissa boundary when near-zero params compound. `highp` is universally available in WebGL 2.

---

## WebGLRenderer Changes (`src/webgl/WebGLRenderer.ts`)

### Extend `AdjustmentRenderOp`

```ts
type ColorGradingPassParams = AdjustmentParamsMap['color-grading']

export type AdjustmentRenderOp =
  // ...existing variants...
  | {
      kind: 'color-grading'
      layerId: string
      params: ColorGradingPassParams
      visible: boolean
      selMaskLayer?: WebGLLayer
    }
```

### New private field

```ts
private readonly cgProgram: WebGLProgram
```

Initialized in the constructor alongside the other adjustment programs:

```ts
this.cgProgram = linkProgram(
  gl,
  compileShader(gl, gl.VERTEX_SHADER, BC_VERT),
  compileShader(gl, gl.FRAGMENT_SHADER, CG_FRAG)
)
```

Import `CG_FRAG` from `./shaders` in the existing import line.

### New public method `applyColorGradingPass`

```ts
applyColorGradingPass(
  srcTex: WebGLTexture,
  dstFb: WebGLFramebuffer,
  params: ColorGradingPassParams,
  selMaskLayer?: WebGLLayer
): void
```

Binds `cgProgram`, uploads all uniforms from `params` (four `vec4` wheel uniforms + eleven scalar uniforms + selMask bool), draws the full-screen quad from `srcTex` to `dstFb`.

Uniform-upload pattern for wheels (avoids 16 separate `uniform1f` calls):

```ts
const gl = this.gl
gl.useProgram(this.cgProgram)
const { lift, gamma, gain, offset } = params
gl.uniform4f(gl.getUniformLocation(cg, 'u_lift'),   lift.r,   lift.g,   lift.b,   lift.master)
gl.uniform4f(gl.getUniformLocation(cg, 'u_gamma'),  gamma.r,  gamma.g,  gamma.b,  gamma.master)
gl.uniform4f(gl.getUniformLocation(cg, 'u_gain'),   gain.r,   gain.g,   gain.b,   gain.master)
gl.uniform4f(gl.getUniformLocation(cg, 'u_offset'), offset.r, offset.g, offset.b, offset.master)
gl.uniform1f(gl.getUniformLocation(cg, 'u_temp'),       params.temp)
gl.uniform1f(gl.getUniformLocation(cg, 'u_tint'),       params.tint)
gl.uniform1f(gl.getUniformLocation(cg, 'u_contrast'),   params.contrast)
gl.uniform1f(gl.getUniformLocation(cg, 'u_pivot'),      params.pivot)
gl.uniform1f(gl.getUniformLocation(cg, 'u_midDetail'),  params.midDetail)
gl.uniform1f(gl.getUniformLocation(cg, 'u_colorBoost'), params.colorBoost)
gl.uniform1f(gl.getUniformLocation(cg, 'u_shadows'),    params.shadows)
gl.uniform1f(gl.getUniformLocation(cg, 'u_highlights'), params.highlights)
gl.uniform1f(gl.getUniformLocation(cg, 'u_saturation'), params.saturation)
gl.uniform1f(gl.getUniformLocation(cg, 'u_hue'),        params.hue)
gl.uniform1f(gl.getUniformLocation(cg, 'u_lumMix'),     params.lumMix)
// bind src texture to unit 0, selMask to unit 1 (same pattern as other passes)
```

Uniform locations should be cached in a private map (matching the pattern already used for `curvesLutTextures`) to avoid `getUniformLocation` calls on every frame.

### Extend adjustment dispatch in `executePlanToComposite`

In the `renderScopedAdjustmentGroup` method (and the fallback flat-op dispatch path), add the `'color-grading'` branch alongside `'curves'`, `'selective-color'`, etc.:

```ts
} else if (op.kind === 'color-grading') {
  if (op.visible) {
    this.applyColorGradingPass(srcTex, dstFb, op.params, op.selMaskLayer)
    // swap ping-pong buffers
  }
}
```

This branch is identical in structure to every other adjustment op dispatch — no special handling is required.

---

## `canvasPlan.ts` Changes

Add the `'color-grading'` case inside `buildAdjustmentEntry` before the exhaustive-check line:

```ts
if (ls.adjustmentType === 'color-grading') {
  return {
    kind: 'color-grading',
    layerId: ls.id,
    params: ls.params,
    visible: ls.visible,
    selMaskLayer: adjustmentMaskMap.get(ls.id),
  }
}
```

The TypeScript exhaustive-check `const _exhaustive: never = ls` at the bottom of the function will enforce that this case is added — the code will not compile until it is present.

---

## `AdjustmentPanel.tsx` Changes

### Add to the `adjustmentTitle` switch

```ts
case 'color-grading': return 'Color Grading'
```

### Add header icon

```tsx
const ColorGradingHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
       stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    {/* Four small circles representing the four color wheels */}
    <circle cx="3"  cy="6" r="1.8" />
    <circle cx="9"  cy="6" r="1.8" />
    <circle cx="6"  cy="3" r="1.8" />
    <circle cx="6"  cy="9" r="1.8" />
  </svg>
)
```

### Add to the panel switch

```tsx
case 'color-grading':
  return (
    <ColorGradingPanel
      layer={layer as ColorGradingAdjustmentLayer}
      canvasHandleRef={canvasHandleRef}
    />
  )
```

Import `ColorGradingPanel` from `'../ColorGradingPanel/ColorGradingPanel'` and `ColorGradingAdjustmentLayer` from `'@/types'`.

---

## `ColorGradingPanel` Component

**File:** `src/components/panels/ColorGradingPanel/ColorGradingPanel.tsx`  
**Category:** Panel — reads `AppContext`, dispatches `UPDATE_ADJUSTMENT_LAYER`.

### Responsibility

Renders the full Color Grading UI: four `ColorWheelWidget` instances in the wheels row, five labeled sliders in the top row, and six labeled sliders in the bottom row. Owns no business logic — directly maps slider/wheel changes to `UPDATE_ADJUSTMENT_LAYER` dispatches.

### Props

```ts
interface ColorGradingPanelProps {
  layer: ColorGradingAdjustmentLayer
  canvasHandleRef?: { readonly current: CanvasHandle | null }
}
```

`layer` comes from `AdjustmentPanel` which already resolves the active adjustment layer from `AppContext`. The panel does **not** read `AppContext` itself for the layer — it receives it as a prop, following the pattern of `BrightnessContrastPanel`, `HueSaturationPanel`, etc.

### State

No local React state is needed. All parameters are stored in `layer.params` (already in `AppContext`). Every control calls `dispatch({ type: 'UPDATE_ADJUSTMENT_LAYER', payload: { ...layer, params: { ...layer.params, [field]: newValue } } })` on change.

For the color wheels, the `ColorWheelValue` (r, g, b, master) maps to a `ColorGradingWheelParams` directly.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Color Grading                                         [×]  │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  Lift ↺  │ │ Gamma ↺  │ │  Gain ↺  │ │ Offset ↺ │       │
│  │ [wheel]  │ │ [wheel]  │ │ [wheel]  │ │ [wheel]  │       │
│  │ M  R  G  B│ │ M  R  G  B│ │ M  R  G  B│ │ M  R  G  B│       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│  Temp   [slider][input]   Tint    [slider][input]           │
│  Contrast[slider][input]  Pivot   [slider][input]           │
│  Mid/Detail[slider][input]                                  │
├─────────────────────────────────────────────────────────────┤
│  Color Boost[slider][input]  Shadows  [slider][input]       │
│  Highlights [slider][input]  Saturation[slider][input]      │
│  Hue        [slider][input]  Lum Mix  [slider][input]       │
└─────────────────────────────────────────────────────────────┘
```

Sliders use the existing `AdjustmentSlider` widget (or equivalent from `src/components/widgets/`) already used in `BrightnessContrastPanel`, `HueSaturationPanel`, etc.

### `renderWheelRow` helper (local to the component file)

Renders one `ColorWheelWidget` with its label, reset button, and four numeric fields (M, R, G, B) below. The reset button dispatches `UPDATE_ADJUSTMENT_LAYER` with the wheel set to `{ r: 0, g: 0, b: 0, master: 0 }`.

---

## `ColorWheelWidget` Component

**File:** `src/components/widgets/ColorWheelWidget/ColorWheelWidget.tsx`  
**Category:** Widget — props-only, no `AppContext` access.

### Props

```ts
export interface ColorWheelValue {
  r:      number  // −1..1
  g:      number  // −1..1
  b:      number  // −1..1
  master: number  // −1..1
}

export interface ColorWheelWidgetProps {
  value:    ColorWheelValue
  onChange: (v: ColorWheelValue) => void
  /**
   * Diameter of the color disk in CSS pixels.
   * The luma ring adds (ringWidth * 2) on each side.
   * Defaults to 100.
   */
  size?: number
  /** Width of the outer luma ring arc in CSS pixels. Defaults to 8. */
  ringWidth?: number
  disabled?: boolean
}
```

### Canvas layout

The widget renders into a single `<canvas>` element. The canvas logical size is `size + 2 * ringGap + 2 * ringWidth` square, where `ringGap` is a 3 px gap between the disk edge and the ring arc.

At `size = 100`, `ringWidth = 8`, `ringGap = 3`: canvas = 122 × 122 px.

The canvas is drawn at 2× device pixel ratio for sharp rendering on HiDPI displays.

### Disk rendering

The hue/saturation disk is drawn using `ImageData` or an offscreen `OffscreenCanvas` computed once on mount (or when `size` changes). Each pixel at position `(x, y)` relative to disk center is:

1. Compute polar: `ρ = sqrt(x² + y²) / diskRadius`, `θ = atan2(y, x)`
2. Fill the disk only where `ρ ≤ 1`; outside pixels are transparent.
3. The color at position: convert the polar coords to an HSL color:
   - At `ρ = 0` → pure white (center = neutral)
   - At `ρ = 1` → fully saturated hue at angle `θ`
   - Use: `H = (θ + π) / (2π)`, `S = ρ`, `L = 0.5` → `hsl2rgb`
   - This produces the standard rainbow wheel with white at center.
4. Anti-alias the disk edge with a 1-px smooth falloff (`alpha = smoothstep(1, 0.97, ρ)`).

The disk image is cached in a `useRef<ImageData>` and only redrawn when `size` changes.

### Puck rendering

The puck center `(px, py)` is computed from `(value.r, value.g, value.b)` using the iso-luminant chroma projection:

$$
p_x = \frac{3}{2} \cdot R \cdot \frac{\mathit{diskRadius}}{\mathit{maxChroma}}
\qquad
p_y = \frac{\sqrt{3}}{2} \cdot (G - B) \cdot \frac{\mathit{diskRadius}}{\mathit{maxChroma}}
$$

where `maxChroma = 1.0`. This projection preserves `R + G + B = 0` — the puck encodes only the color direction and chroma, not the overall brightness (that is the luma ring's job).

Clamped so `||puck|| ≤ diskRadius`.

The puck is drawn as a small white-filled circle (radius 5 px) with a dark `box-shadow`-style stroke — a white circle with a 1.5 px dark outline for visibility on both light and dark disk regions. Use standard `canvas.arc()` with two fill passes (dark at radius+1, white at radius).

### Inverse puck → R/G/B mapping

Given puck position `(px, py)` in disk-relative coordinates (center = 0, edge = `diskRadius`):

$$
u = p_x / \mathit{diskRadius}
\qquad
v = p_y / \mathit{diskRadius}
$$

$$
R = \tfrac{2}{3} u
\qquad
G = -\tfrac{1}{3} u + \tfrac{1}{\sqrt{3}} v
\qquad
B = -\tfrac{1}{3} u - \tfrac{1}{\sqrt{3}} v
$$

All three values will naturally lie in [`−2/3`, `2/3`] when `||(u, v)|| ≤ 1`. The `master` field from the luma ring is unchanged when the puck moves.

### Luma ring rendering

The luma ring is an arc drawn at radius `diskRadius + ringGap + ringWidth/2`. It is coloured as a gradient from dark grey (low end) to white (high end), with the neutral position (master = 0) at the 12-o'clock position on the arc.

The ring spans the full 360°. The arc fill uses a `createConicGradient` or a series of short `lineTo` strokes coloured by a gradient from dark to white (full circle). A neutral marker line is drawn at the 12-o'clock position.

The current master position is shown by a short **indicator tick**: a white line at the angle corresponding to `master`, where neutral = 90° (top), CW = positive, CCW = negative.

```
master → angle:  angle = π/2 − (master * π)
// master = 0   → top (90°)
// master = 1   → bottom CW (−90°)
// master = −1  → bottom CCW (270°)
```

### Luma ring interaction

The ring responds to two drag types:

1. **Rotational drag** — pointer lands within `(diskRadius + ringGap) ≤ r ≤ (diskRadius + ringGap + ringWidth * 2)` of the disk center. As the pointer moves, compute the new angle from disk center and map it to a `master` value:

   ```
   let angle = atan2(dy, dx)
   let master = clamp((π/2 - angle) / π, -1, 1)
   ```

2. **Vertical drag on ring** — when `pointermove` is detected with the ring captured, the vertical delta `dy` also adjusts master:

   ```
   let newMaster = clamp(master_at_dragstart - dy / (ringRadius * π), -1, 1)
   ```

   Both mechanisms update `master` simultaneously based on whichever gives a larger delta; it is cleaner to just use the rotational transform exclusively.

### Puck drag interaction

On `pointerdown` inside the disk circle (hit-test `||pos − center|| ≤ diskRadius`):

1. `canvas.setPointerCapture(e.pointerId)`
2. On `pointermove`: compute new puck position, clamp to disk boundary, derive (r, g, b) via inverse mapping, call `onChange({ r, g, b, master: value.master })`.
3. On `pointerup`/`pointercancel`: release capture.

Double-click on the puck (or anywhere inside the disk): reset to `{ r: 0, g: 0, b: 0, master: value.master }`.

Double-click on the luma ring: reset to `{ ...value, master: 0 }`.

### Numeric fields below the wheel

The four numeric fields (M, R, G, B) are plain `<input type="number">` elements rendered by `ColorGradingPanel` (not by `ColorWheelWidget`). `ColorWheelWidget` is a pure canvas widget; the numeric fields are wired separately in the panel:

```tsx
<input
  value={formatWheelParam(value.r)}
  onChange={e => {
    const v = clamp(parseFloat(e.target.value), -1, 1)
    onChange({ ...value, r: v })
  }}
  onDoubleClick={() => onChange({ ...value, r: 0 })}
/>
```

`formatWheelParam` formats to 2 decimal places. Scroll-to-increment is handled via `onWheel` with `e.preventDefault()` and a ±0.01 step.

---

## Parameter Flow

```
ColorGradingPanel
  ↓ slider/wheel onChange
dispatch(UPDATE_ADJUSTMENT_LAYER)
  ↓
AppContext.state.layers  (ColorGradingAdjustmentLayer.params updated)
  ↓
Canvas.tsx buildRenderPlan()
  ↓
canvasPlan.buildAdjustmentEntry()  → AdjustmentRenderOp { kind: 'color-grading', params }
  ↓
RenderPlanEntry { kind: 'adjustment-group', adjustments: [color-grading op] }
  ↓
WebGLRenderer.renderPlan()
  ↓
renderScopedAdjustmentGroup()
  ↓
applyColorGradingPass(srcTex, dstFb, params, selMaskLayer?)
  ↓
CG_FRAG uniform upload + drawArrays
  ↓
Canvas display updated
```

For **flatten / export / merge**, the same `RenderPlanEntry[]` is passed to `renderer.readFlattenedPlan()` via `GpuRasterPipeline.rasterizeWithGpu()`. The `color-grading` op is handled identically because `readFlattenedPlan` reuses `executePlanToComposite` internally.

---

## Architectural Constraints

- **Widget vs Panel boundary** — `ColorWheelWidget` must not access `AppContext`. All dispatch logic lives in `ColorGradingPanel`. The widget receives `value` + `onChange` only.
- **No raw DOM pointer listeners in tools** — the pointer interaction on the canvas widget goes through standard React `onPointerDown`/`onPointerMove`/`onPointerUp` on the `<canvas>` element, not `addEventListener`. This is correct because `ColorWheelWidget` is not a tool handler; it is a UI component.
- **CSS Modules** — `ColorGradingPanel.module.scss` and `ColorWheelWidget.module.scss` are mandatory. No plain `.scss` imports.
- **No canvas re-initialization in effects that list `rendererRef.current` as a dependency** — not applicable here, but the general rule applies to any future Canvas-level wiring.
- **Unified rasterization pipeline** — flatten, export, and merge must all produce the same result. Because `GpuRasterPipeline` delegates directly to `renderer.readFlattenedPlan()` which reuses `executePlanToComposite`, no separate compositing path is needed.
- **Straight-alpha** — `CG_FRAG` operates on straight RGBA (not premultiplied). The context is created with `premultipliedAlpha: false`; no un-multiply step is required.
- **`AdjustmentPanel` is the floating panel shell** — Color Grading uses the same `AdjustmentPanel` shell as all other adjustments. The panel is **not** placed in `src/components/dialogs/`; it is a sub-panel component rendered within the `AdjustmentPanel` switch, following the identical pattern to `HueSaturationPanel`, `CurvesPanel`, etc.
- **`hasMask` field** — follows the established convention: baked selection mask pixels live in `Canvas.adjustmentMaskMap`, not in React state. `ColorGradingAdjustmentLayer.hasMask` is set by `useAdjustments` at creation time, exactly as for all other adjustment types.

---

## Open Questions

1. **Mid/Detail implementation depth** — The current design implements Mid/Detail as a pure per-pixel luminance-local S-curve. This departs from the "unsharp-mask style" description in the spec, which implies a convolution (requires neighbor sampling). A multi-pass bilateral or blur-based approach would require two additional FBO passes per Color Grading layer. If the per-pixel approximation is not accepted in acceptance testing, the feature should be deferred to a second pass that adds a preparatory Gaussian blur pass feeding the mid-detail stage.

2. **Wheel puck chroma clamping at disk edge** — When a numeric value typed directly into the R/G/B fields produces an (r, g, b) triplet whose chroma projection places the puck outside the unit disk, the puck should be clamped to the disk edge visually but the original typed values kept internally. Alternatively, clamp the typed value to the reachable range. The spec says out-of-range field values are clamped on commit; a developer should decide whether to clamp the individual channel value (−1 to 1) or clamp the `||puck||` derived from the three channels. Recommend clamping per-channel at ±1 on commit, which will naturally keep `||puck|| ≤ sqrt(2/3)` ≈ 0.816 — within the disk.

3. **`lumMix` default interaction with identity defaults** — At all defaults, `lumMix = 100` (luminosity-preserve). Since all other operations are identity and produce `corrLum = origLum`, the `lumPreserved` fallback branch `(corrLum > 0.0001) ? rgb * (origLum / corrLum) : rgb` resolves to `rgb * 1.0 = rgb`. This is correct at defaults but should be validated in tests where `corrLum` can be very small (very dark pixels) to ensure the branch does not introduce a division artifact.

4. **ring gradient rendering** — `CanvasRenderingContext2D.createConicGradient` is broadly supported but was only standardised in mid-2023. If a compatibility target requires older Chromium versions (pre-103), the ring gradient should be drawn as a series of short arc segments with `strokeStyle` computed per-segment using an HSL hue sweep. Developer should verify the Electron Chromium version bundled in the project before deciding.
