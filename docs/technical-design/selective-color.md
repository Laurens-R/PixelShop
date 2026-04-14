# Technical Design: Selective Color

## Overview

The Selective Color adjustment is a non-destructive child layer that adjusts the CMYK channel composition of nine individual color ranges within a parent pixel layer. The nine ranges are: Reds, Yellows, Greens, Cyans, Blues, Magentas (chromatic, keyed to hue angle using triangular weights from `BW_FRAG`), Whites (high-luminance), Blacks (low-luminance), and Neutrals (low-saturation). A mode toggle switches between Relative (proportional to existing channel value) and Absolute (fixed additive) methods. When the user triggers **Image → Selective Color…**, a `SelectiveColorAdjustmentLayer` record is inserted into `state.layers` immediately after the active pixel layer (same positional contract as all prior adjustment layers), `openAdjustmentLayerId` is set to the new layer's ID, and `AdjustmentPanel` opens showing `SelectiveColorPanel`. Slider and mode-toggle changes dispatch `UPDATE_ADJUSTMENT_LAYER` updates; on every update `useCanvas` re-runs its render via the WebGL compositing pipeline. No WASM is needed — all math is GLSL. One undo entry is recorded when the panel closes.

This design builds directly on the infrastructure established by `adjustment-menu.md`, `brightness-contrast.md`, `hue-saturation.md`, `color-vibrance.md`, `color-balance.md`, `black-and-white.md`, `color-temperature.md`, and `color-invert.md`. Anything defined in those documents (type system, `AdjustmentPanel` shell, `useAdjustments`, `renderPlan` / `readFlattenedPlan` methods, `UPDATE_ADJUSTMENT_LAYER` action, `adjustmentMaskMap` ref, `BC_VERT` vertex shader, RGB ↔ HSL GLSL helpers, triangular hue-range weight logic from `BW_FRAG`) is **already in place** — this document only specifies what is new or extended.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'selective-color'` to `AdjustmentType`; add `'selective-color'` entry to `AdjustmentParamsMap`; add `SelectiveColorAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Add `'selective-color'` entry to `ADJUSTMENT_REGISTRY` |
| `src/webgl/shaders.ts` | Add `SEL_COLOR_FRAG` constant; vertex stage reuses existing `BC_VERT` |
| `src/webgl/WebGLRenderer.ts` | Add local `SelectiveColorPassParams` type; extend `AdjustmentRenderOp` union; add `selColorProgram`; add `applySelectiveColorPass`; extend `renderPlan` / `readFlattenedPlan` loop; extend `destroy()` |
| `src/hooks/useCanvas.ts` | Extend render-plan builder to emit `kind: 'selective-color'` entries |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `case 'selective-color'` to adjustment-type switch |
| `src/components/panels/AdjustmentPanel/SelectiveColorPanel.tsx` | **New file.** Nine-range dropdown + four-slider sub-panel UI |
| `src/components/panels/AdjustmentPanel/SelectiveColorPanel.module.scss` | **New file.** Scoped styles |

No changes are required to `src/store/AppContext.tsx`, `src/hooks/useAdjustments.ts`, or `src/App.tsx`.

---

## State Changes

### New entries in `src/types/index.ts`

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
  | 'selective-color'    // ← new
```

#### Extend `AdjustmentParamsMap`

Each of the nine color ranges stores four independent CMYK slider values (−100..+100, default 0). A mode field controls how the adjustments are applied:

```ts
export interface AdjustmentParamsMap {
  // …existing entries…
  'selective-color': {
    reds:     { cyan: number; magenta: number; yellow: number; black: number }
    yellows:  { cyan: number; magenta: number; yellow: number; black: number }
    greens:   { cyan: number; magenta: number; yellow: number; black: number }
    cyans:    { cyan: number; magenta: number; yellow: number; black: number }
    blues:    { cyan: number; magenta: number; yellow: number; black: number }
    magentas: { cyan: number; magenta: number; yellow: number; black: number }
    whites:   { cyan: number; magenta: number; yellow: number; black: number }
    neutrals: { cyan: number; magenta: number; yellow: number; black: number }
    blacks:   { cyan: number; magenta: number; yellow: number; black: number }
    mode:     'relative' | 'absolute'
  }
}
```

All CMYK sliders default to 0; `mode` defaults to `'relative'`.

#### New layer interface

```ts
export interface SelectiveColorAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'selective-color'
  params: AdjustmentParamsMap['selective-color']
  /** True when a selection was active at creation time; the baked mask pixels
   *  live in useCanvas.adjustmentMaskMap (not in React state). */
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
  | SelectiveColorAdjustmentLayer   // ← new
```

---

## Pixel Math

**No WASM function is required.** All math runs entirely on the GPU via a new GLSL program.

### Algorithm

The adjustment is a per-pixel five-step operation: convert RGB to HSL and to CMYK, compute nine range weights, accumulate weighted CMYK deltas, apply in Relative or Absolute mode, then convert back to RGB.

---

### Step 1 — Convert RGB → HSL

Using the same `rgb2hsl` helper defined verbatim in `HS_FRAG`, `VIB_FRAG`, and `BW_FRAG`:

$$
(H, S, L) = \text{rgb2hsl}(R, G, B)
$$

where $H \in [0, 1)$, $S \in [0, 1]$, $L \in [0, 1]$.

---

### Step 2 — Convert RGB → CMYK

The standard RGB→CMYK conversion with single black-channel extraction:

$$
K = 1 - \max(R, G, B)
$$

$$
\text{if } K < 1: \quad C = \frac{1 - R - K}{1 - K}, \quad M = \frac{1 - G - K}{1 - K}, \quad Y = \frac{1 - B - K}{1 - K}
$$

$$
\text{if } K = 1 \text{ (pure black)}: \quad C = M = Y = 0
$$

The `K = 1` branch guards against division by zero for pure-black pixels.

---

### Step 3 — Compute nine range weights

**Chromatic ranges (index 0–5: Reds, Yellows, Greens, Cyans, Blues, Magentas):**

Triangular hue weights — identical in formula to `BW_FRAG`. Each center is at an even sixth of the hue circle:

| Index | Range    | Center (normalized) |
|-------|----------|---------------------|
| 0     | Reds     | 0/6 = 0.000         |
| 1     | Yellows  | 1/6 ≈ 0.167         |
| 2     | Greens   | 2/6 ≈ 0.333         |
| 3     | Cyans    | 3/6 = 0.500         |
| 4     | Blues    | 4/6 ≈ 0.667         |
| 5     | Magentas | 5/6 ≈ 0.833         |

$$
w_i = \max(0,\; 1 - 6 \cdot \min(|H - c_i|,\; 1 - |H - c_i|))
$$

**Achromatic guard:** identical to `BW_FRAG` — blend toward uniform weights when $S \approx 0$:

$$
\text{satBlend} = \operatorname{clamp}(S \times 10,\; 0,\; 1)
$$

$$
w_i \leftarrow \operatorname{mix}(1/6,\; w_i,\; \text{satBlend}) \quad \text{for } i \in [0, 5]
$$

This prevents all weight falling on Reds (index 0) when $H$ is undefined at $S = 0$.

**Achromatic ranges (index 6–8: Whites, Neutrals, Blacks):**

These three ranges are luminance- and saturation-based soft masks that operate independently of the chromatic weights. They do **not** form a partition with the chromatic weights; a dark saturated red pixel can simultaneously attract weight from both the Reds range and the Blacks range (matching Photoshop behavior).

$$
w_{\text{whites}}  = \operatorname{clamp}((L - 0.8) \times 5,\; 0,\; 1)
$$

$$
w_{\text{blacks}}  = \operatorname{clamp}((0.2 - L) \times 5,\; 0,\; 1)
$$

$$
w_{\text{neutrals}} = \operatorname{clamp}(1 - \text{satBlend},\; 0,\; 1)
$$

Properties:
- $w_{\text{whites}}$ reaches 1 at $L = 1.0$ and 0 at $L \leq 0.8$; ramps linearly across $L \in [0.8, 1.0]$. ✓
- $w_{\text{blacks}}$ reaches 1 at $L = 0$ and 0 at $L \geq 0.2$; ramps linearly across $L \in [0, 0.2]$. ✓
- $w_{\text{neutrals}}$ reaches 1 at $S = 0$ (fully achromatic) and 0 at $S \geq 0.1$. ✓
- A pure white pixel ($L=1$, $S=0$): $w_W=1$, $w_N=1$, $w_B=0$, chromatic each = 1/6. Both Whites and Neutrals sliders apply. ✓
- A mid-gray pixel ($L=0.5$, $S=0$): $w_W=0$, $w_B=0$, $w_N=1$, chromatic each = 1/6. Only Neutrals applies among the achromatic ranges. ✓
- A saturated red pixel ($S > 0.1$): $w_N \approx 0$; Reds gets the dominant chromatic weight. ✓

---

### Step 4 — Accumulate and apply CMYK deltas

**Uniform array layout** (index order: Reds=0, Yellows=1, Greens=2, Cyans=3, Blues=4, Magentas=5, Whites=6, Neutrals=7, Blacks=8):

```glsl
uniform float u_cyan[9];
uniform float u_magenta[9];
uniform float u_yellow[9];
uniform float u_black[9];
uniform bool  u_relative;
```

**Compute total delta for each CMYK channel:**

$$
\Delta C = \sum_{i=0}^{8} w_i \cdot f(u\_\text{cyan}[i],\; C)
$$

$$
\Delta M = \sum_{i=0}^{8} w_i \cdot f(u\_\text{magenta}[i],\; M)
$$

$$
\Delta Y = \sum_{i=0}^{8} w_i \cdot f(u\_\text{yellow}[i],\; Y)
$$

$$
\Delta K = \sum_{i=0}^{8} w_i \cdot f(u\_\text{black}[i],\; K)
$$

Where $f$ differs by mode:

$$
f_{\text{relative}}(\text{slider},\; \text{existing}) = \frac{\text{slider}}{100} \times \text{existing}
$$

$$
f_{\text{absolute}}(\text{slider},\; \text{existing}) = \frac{\text{slider}}{100}
$$

Relative mode: delta scales with the existing channel value. A pixel with zero Cyan is unaffected by any Cyan slider in Relative mode (multiplied by 0). ✓  
Absolute mode: delta is fixed at `slider/100`, independent of existing value. A pixel with zero Cyan is still affected. ✓

**Apply and clamp:**

$$
C' = \operatorname{clamp}(C + \Delta C,\; 0,\; 1) \quad M' = \operatorname{clamp}(M + \Delta M,\; 0,\; 1)
$$

$$
Y' = \operatorname{clamp}(Y + \Delta Y,\; 0,\; 1) \quad K' = \operatorname{clamp}(K + \Delta K,\; 0,\; 1)
$$

---

### Step 5 — Convert CMYK → RGB

$$
R' = (1 - C') \cdot (1 - K') \quad G' = (1 - M') \cdot (1 - K') \quad B' = (1 - Y') \cdot (1 - K')
$$

Final RGB values are already in [0, 1] because all CMYK components were clamped.

---

### Boundary checks

| Condition | Expected result |
|---|---|
| All sliders at 0, either mode | Identity ✓ |
| Reds → Cyan = +100, Absolute, pure red pixel (H≈0, S=1) | wR≈1 → ΔC = 1.0 → C raised by 1.0 (clamped) → red shifted toward black-red ✓ |
| Reds → Cyan = +100, Relative, pixel with C=0 | ΔC = w * 1.0 * 0 = 0 → no effect ✓ |
| Reds → Cyan = +100, Absolute, pixel with C=0 | ΔC = w * 1.0 → cyan added ✓ |
| Blacks → Black = +100, Absolute, pixel at L=0 | wB=1 → ΔK = 1.0 → K raised → darker ✓ |
| Blacks → Black = +100, Absolute, pixel at L=1 | wB=0 → no effect ✓ |
| Whites → Cyan = +100, Absolute, pixel at L=0.9 | wW=0.5 → ΔC=0.5 ✓ |
| Neutrals → Magenta = +100, Relative, saturated pixel S=1 | satBlend=1 → wN=0 → no effect ✓ |
| Neutrals → Magenta = +100, Relative, achromatic pixel S=0 | wN=1 → ΔM = M_existing → M doubles (clamped) ✓ |
| mode switches Relative↔Absolute with non-zero sliders | Visibly different result ✓ |
| α = 0 | Early exit, pixel unchanged ✓ |
| Channel result would exceed [0,1] | Clamped ✓ |

---

### New GLSL — `SEL_COLOR_FRAG` in `src/webgl/shaders.ts`

The vertex stage is identical to `BC_VERT`. Add only the fragment shader constant after `INVERT_FRAG`:

```ts
export const SEL_COLOR_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;

  // Per-range CMYK adjustment values (−100 … +100).
  // Index: 0=Reds 1=Yellows 2=Greens 3=Cyans 4=Blues 5=Magentas 6=Whites 7=Neutrals 8=Blacks
  uniform float u_cyan[9];
  uniform float u_magenta[9];
  uniform float u_yellow[9];
  uniform float u_black[9];

  // true = Relative mode; false = Absolute mode
  uniform bool u_relative;

  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  // ── RGB → HSL (identical to HS_FRAG / VIB_FRAG / BW_FRAG) ───────────
  vec3 rgb2hsl(vec3 c) {
    float maxC  = max(c.r, max(c.g, c.b));
    float minC  = min(c.r, min(c.g, c.b));
    float delta = maxC - minC;
    float L = (maxC + minC) * 0.5;
    float S = 0.0;
    float H = 0.0;
    if (delta > 0.00001) {
      S = delta / (1.0 - abs(2.0 * L - 1.0));
      if (maxC == c.r)      H = mod((c.g - c.b) / delta, 6.0) / 6.0;
      else if (maxC == c.g) H = ((c.b - c.r) / delta + 2.0)   / 6.0;
      else                  H = ((c.r - c.g) / delta + 4.0)   / 6.0;
    }
    return vec3(H, S, L);
  }

  // ── Hue circular distance (identical to BW_FRAG) ─────────────────────
  float hueDist(float h, float center) {
    float d = abs(h - center);
    return min(d, 1.0 - d);
  }

  // ── Main ─────────────────────────────────────────────────────────────
  void main() {
    vec4 src = texture(u_src, v_texCoord);
    if (src.a < 0.0001) { fragColor = src; return; }

    vec3 rgb = src.rgb;

    // ── Step 1: RGB → HSL ─────────────────────────────────────────────
    vec3 hsl = rgb2hsl(rgb);
    float H = hsl.x;
    float S = hsl.y;
    float L = hsl.z;

    // ── Step 2: RGB → CMYK ────────────────────────────────────────────
    float maxRGB = max(rgb.r, max(rgb.g, rgb.b));
    float K = 1.0 - maxRGB;
    float C = 0.0, M = 0.0, Y = 0.0;
    if (K < 0.9999) {
      float denom = 1.0 - K;
      C = (1.0 - rgb.r - K) / denom;
      M = (1.0 - rgb.g - K) / denom;
      Y = (1.0 - rgb.b - K) / denom;
    }

    // ── Step 3: Compute nine range weights ────────────────────────────
    // Chromatic ranges: triangular hue weights (same as BW_FRAG).
    // Achromatism guard: blend toward uniform when S ≈ 0.
    float satBlend = clamp(S * 10.0, 0.0, 1.0);

    float wR = max(0.0, 1.0 - 6.0 * hueDist(H, 0.0 / 6.0));
    float wY = max(0.0, 1.0 - 6.0 * hueDist(H, 1.0 / 6.0));
    float wG = max(0.0, 1.0 - 6.0 * hueDist(H, 2.0 / 6.0));
    float wC = max(0.0, 1.0 - 6.0 * hueDist(H, 3.0 / 6.0));
    float wB = max(0.0, 1.0 - 6.0 * hueDist(H, 4.0 / 6.0));
    float wM = max(0.0, 1.0 - 6.0 * hueDist(H, 5.0 / 6.0));

    // Blend toward equal (1/6) weight per range for achromatic pixels
    const float UNIFORM_W = 1.0 / 6.0;
    wR = mix(UNIFORM_W, wR, satBlend);
    wY = mix(UNIFORM_W, wY, satBlend);
    wG = mix(UNIFORM_W, wG, satBlend);
    wC = mix(UNIFORM_W, wC, satBlend);
    wB = mix(UNIFORM_W, wB, satBlend);
    wM = mix(UNIFORM_W, wM, satBlend);

    // Achromatic ranges: luminance-based (Whites, Blacks) and saturation-based (Neutrals).
    // These are independent of chromatic weights and can overlap simultaneously.
    float wWhite   = clamp((L - 0.8) * 5.0, 0.0, 1.0);
    float wBlack   = clamp((0.2 - L) * 5.0, 0.0, 1.0);
    float wNeutral = clamp(1.0 - satBlend, 0.0, 1.0);

    // Pack into array (index matches u_* array order)
    float weights[9];
    weights[0] = wR;
    weights[1] = wY;
    weights[2] = wG;
    weights[3] = wC;
    weights[4] = wB;
    weights[5] = wM;
    weights[6] = wWhite;
    weights[7] = wNeutral;
    weights[8] = wBlack;

    // ── Step 4: Accumulate weighted CMYK deltas ───────────────────────
    float dC = 0.0, dM = 0.0, dY = 0.0, dK = 0.0;
    for (int i = 0; i < 9; i++) {
      float w = weights[i];
      if (u_relative) {
        dC += w * (u_cyan[i]    / 100.0) * C;
        dM += w * (u_magenta[i] / 100.0) * M;
        dY += w * (u_yellow[i]  / 100.0) * Y;
        dK += w * (u_black[i]   / 100.0) * K;
      } else {
        dC += w * (u_cyan[i]    / 100.0);
        dM += w * (u_magenta[i] / 100.0);
        dY += w * (u_yellow[i]  / 100.0);
        dK += w * (u_black[i]   / 100.0);
      }
    }

    // Apply deltas and clamp
    C = clamp(C + dC, 0.0, 1.0);
    M = clamp(M + dM, 0.0, 1.0);
    Y = clamp(Y + dY, 0.0, 1.0);
    K = clamp(K + dK, 0.0, 1.0);

    // ── Step 5: CMYK → RGB ────────────────────────────────────────────
    float kComp = 1.0 - K;
    vec3 adjusted = vec3((1.0 - C) * kComp, (1.0 - M) * kComp, (1.0 - Y) * kComp);

    // ── Step 6: Selection mask blend ──────────────────────────────────
    vec4 result = vec4(adjusted, src.a);
    float mask  = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor   = mix(src, result, mask);
  }
` as const
```

**Design notes:**

- **Local array `weights[9]`** — GLSL ES 3.0 supports fixed-size local arrays initialized per-element. This is idiomatic and compiles without issues on WebGL2 hardware.
- **Loop `for (int i = 0; i < 9; i++)`** — GLSL ES 3.0 supports dynamic loops over uniform arrays (including indexing `u_cyan[i]` with a loop variable). This replaces 36 separate lines of arithmetic.
- **`const float UNIFORM_W = 1.0 / 6.0`** — GLSL ES 3.0 `const` float is evaluated at compile time; no runtime division.
- **`rgb2hsl` and `hueDist` are copied verbatim from `BW_FRAG`** — `hsl2rgb` is not needed (no HSL→RGB conversion occurs; the output path goes through CMYK→RGB).
- **Achromatic weight overlap** — `wWhite + wNeutral + wBlack` can exceed 1; `wChromatic + wAchromatic` can also sum above 1 for light or dark achromatic pixels. This is intentional and matches Photoshop selective color behavior. Channel values are clamped after delta application, so overflow cannot escape the [0, 1] range.
- **Straight-alpha note:** identical to all prior adjustment shaders — context uses `premultipliedAlpha: false`; no pre/de-multiply needed.

---

## WebGL Renderer Changes (`src/webgl/WebGLRenderer.ts`)

### New local type alias (before the class)

`WebGLRenderer.ts` must not import from `@/types`. Define a local structural alias:

```ts
interface SelectiveColorRangeParams {
  cyan:    number
  magenta: number
  yellow:  number
  black:   number
}

interface SelectiveColorPassParams {
  reds:     SelectiveColorRangeParams
  yellows:  SelectiveColorRangeParams
  greens:   SelectiveColorRangeParams
  cyans:    SelectiveColorRangeParams
  blues:    SelectiveColorRangeParams
  magentas: SelectiveColorRangeParams
  whites:   SelectiveColorRangeParams
  neutrals: SelectiveColorRangeParams
  blacks:   SelectiveColorRangeParams
  mode:     'relative' | 'absolute'
}
```

TypeScript structural typing ensures this is assignment-compatible with `AdjustmentParamsMap['selective-color']` without any import coupling.

### Extend `AdjustmentRenderOp`

```ts
export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-vibrance'; vibrance: number; saturation: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-balance'; params: ColorBalancePassParams; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'black-and-white'; params: BlackAndWhitePassParams; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-temperature'; temperature: number; tint: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-invert'; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'selective-color'; params: SelectiveColorPassParams; visible: boolean; selMaskLayer?: WebGLLayer }  // ← new
```

### New private field

```ts
private readonly selColorProgram: WebGLProgram
```

Import `SEL_COLOR_FRAG` from `./shaders` alongside the existing imports. Compile and link in the constructor after `this.invertProgram`:

```ts
this.selColorProgram = linkProgram(
  gl,
  compileShader(gl, gl.VERTEX_SHADER,   BC_VERT),
  compileShader(gl, gl.FRAGMENT_SHADER, SEL_COLOR_FRAG)
)
```

### New public method: `applySelectiveColorPass`

```ts
applySelectiveColorPass(
  srcTex:       WebGLTexture,
  dstFb:        WebGLFramebuffer,
  params:       SelectiveColorPassParams,
  selMaskLayer?: WebGLLayer
): void {
  const { gl } = this
  const w = this.pixelWidth, h = this.pixelHeight
  const prog = this.selColorProgram

  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFb)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)

  gl.useProgram(prog)
  gl.uniform2f(gl.getUniformLocation(prog, 'u_resolution'), w, h)

  // Build Float32Arrays in range order: reds, yellows, greens, cyans, blues, magentas, whites, neutrals, blacks
  const RANGE_ORDER = [
    params.reds, params.yellows, params.greens,
    params.cyans, params.blues, params.magentas,
    params.whites, params.neutrals, params.blacks,
  ] as const

  gl.uniform1fv(gl.getUniformLocation(prog, 'u_cyan'),    Float32Array.from(RANGE_ORDER.map(r => r.cyan)))
  gl.uniform1fv(gl.getUniformLocation(prog, 'u_magenta'), Float32Array.from(RANGE_ORDER.map(r => r.magenta)))
  gl.uniform1fv(gl.getUniformLocation(prog, 'u_yellow'),  Float32Array.from(RANGE_ORDER.map(r => r.yellow)))
  gl.uniform1fv(gl.getUniformLocation(prog, 'u_black'),   Float32Array.from(RANGE_ORDER.map(r => r.black)))

  gl.uniform1i(gl.getUniformLocation(prog, 'u_relative'), params.mode === 'relative' ? 1 : 0)

  const posLoc = gl.getAttribLocation(prog, 'a_position')
  gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
  fillRectBuffer(gl, 0, 0, w, h)
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, srcTex)
  gl.uniform1i(gl.getUniformLocation(prog, 'u_src'), 0)

  if (selMaskLayer) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, selMaskLayer.texture)
    gl.uniform1i(gl.getUniformLocation(prog, 'u_selMask'), 1)
    gl.uniform1i(gl.getUniformLocation(prog, 'u_hasSelMask'), 1)
  } else {
    gl.uniform1i(gl.getUniformLocation(prog, 'u_hasSelMask'), 0)
  }

  gl.drawArrays(gl.TRIANGLES, 0, 6)
}
```

**`uniform1fv` for array uniforms:** `gl.uniform1fv(loc, Float32Array)` sets a `uniform float arr[N]` in GLSL ES 3.0. The `Float32Array.from(...)` call builds a typed array at dispatch time; it allocates a small 9-element buffer per frame, which is acceptable for an adjustment that runs once per compositing pass. If this becomes a hot path, pre-allocating four reusable `Float32Array(9)` buffers on the renderer is a straightforward optimization to defer.

### Extend `renderPlan` (and `readFlattenedPlan`) inner loop

Add the `selective-color` case immediately after the `color-invert` case:

```ts
} else if (entry.kind === 'selective-color') {
  if (!entry.visible) continue
  this.applySelectiveColorPass(srcTex, dstFb, entry.params, entry.selMaskLayer)
  ;[srcFb, dstFb] = [dstFb, srcFb]
  ;[srcTex, dstTex] = [dstTex, srcTex]
}
```

### `destroy()` extension

Add `gl.deleteProgram(this.selColorProgram)` alongside the existing `deleteProgram` calls.

---

## `useCanvas.ts` Render Plan Builder

Add the `selective-color` branch after the `color-invert` branch:

```ts
} else if (l.type === 'adjustment' && l.adjustmentType === 'selective-color') {
  plan.push({
    kind:         'selective-color',
    params:       l.params,
    visible:      l.visible,
    selMaskLayer: adjustmentMaskMap.current.get(l.id),
  })
}
```

---

## `SelectiveColorPanel` Component

**File:** `src/components/panels/AdjustmentPanel/SelectiveColorPanel.tsx`  
**Category:** panel sub-component (same folder as `AdjustmentPanel`; **not** re-exported from `src/components/index.ts`)  
**Single responsibility:** render the range dropdown + four-slider body + mode toggle of the floating Selective Color panel and dispatch param updates in real time.

### Props

```ts
interface SelectiveColorPanelProps {
  layer: SelectiveColorAdjustmentLayer
}
```

### Local state

```ts
const [activeRange, setActiveRange] = useState<keyof SelectiveColorParams>('reds')
```

where `SelectiveColorParams` is the params type (all nine range keys). This is **purely UI state** — which range the user is inspecting in the dropdown. It is not persisted to `AppContext` or `AppState`. When the panel mounts (i.e., when it opens or reopens), `activeRange` always initializes to `'reds'`, per spec.

### Internals

- Reads `dispatch` from `useContext(AppContext)`.
- Renders in order:
  1. **Color range dropdown** — options: Reds, Yellows, Greens, Cyans, Blues, Magentas, Whites, Neutrals, Blacks. Value = `activeRange`. `onChange` → `setActiveRange`.
  2. **Four `SliderInput` rows** for the current range's CMYK values, read from `layer.params[activeRange]`:
     - **Cyan** — `min={-100}` `max={100}`
     - **Magenta** — `min={-100}` `max={100}`
     - **Yellow** — `min={-100}` `max={100}`
     - **Black** — `min={-100}` `max={100}`
  3. **Method toggle** — two-option segmented control: **Relative** (selected when `layer.params.mode === 'relative'`) and **Absolute**. Rendered below the sliders.
- On every slider `onChange` (while dragging), dispatches:
  ```ts
  dispatch({
    type: 'UPDATE_ADJUSTMENT_LAYER',
    payload: {
      ...layer,
      params: {
        ...layer.params,
        [activeRange]: {
          ...layer.params[activeRange],
          [changedKey]: newValue,
        },
      },
    },
  })
  ```
  Where `changedKey` is one of `'cyan' | 'magenta' | 'yellow' | 'black'`.
- On mode toggle change:
  ```ts
  dispatch({
    type: 'UPDATE_ADJUSTMENT_LAYER',
    payload: { ...layer, params: { ...layer.params, mode: newMode } },
  })
  ```
- Numeric inputs clamp to `[−100, 100]` on `onBlur` / Enter before dispatch.
- All slider values are read from `layer.params[activeRange]` (fully controlled — no local slider state).

### Registration in `AdjustmentPanel.tsx`

```tsx
case 'selective-color':
  return <SelectiveColorPanel layer={layer as SelectiveColorAdjustmentLayer} />
```

---

## Adjustment Registry Changes

### `src/adjustments/registry.ts`

Append an entry to `ADJUSTMENT_REGISTRY`:

```ts
{
  adjustmentType: 'selective-color' as const,
  label: 'Selective Color…',
  defaultParams: {
    reds:     { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    yellows:  { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    greens:   { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    cyans:    { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    blues:    { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    magentas: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    whites:   { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    neutrals: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    blacks:   { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    mode: 'relative',
  },
},
```

---

## Architectural Constraints

- **No business logic in `App.tsx`** — `useAdjustments` handles layer creation; no new hooks needed.
- **`WebGLRenderer.ts` must not import from `@/types`** — local `SelectiveColorPassParams` and `SelectiveColorRangeParams` aliases satisfy the structural constraint without coupling.
- **`SelectiveColorPanel` is a panel sub-component**, not re-exported from `src/components/index.ts`.
- **`activeRange` is local panel state** — it is never stored in `AppContext`. The spec explicitly states the dropdown resets to Reds on every reopen, which is what a fresh `useState('reds')` on mount produces.
- **CSS must use `.module.scss`** — `SelectiveColorPanel.module.scss` is the scoped stylesheet.
- **GLSL uniform arrays** — `uniform float u_cyan[9]` with `gl.uniform1fv` is the canonical WebGL2 approach. Do not pass 36 separate scalar uniforms — GLSL `getUniformLocation` with array-name strings (`'u_cyan'`) retrieves the base address; `uniform1fv` uploads all 9 elements in a single GL call.
- **Straight RGBA** — no pre/de-multiply; context is `premultipliedAlpha: false`.

---

## Open Questions

1. **Chromatic + achromatic weight interaction** — the design intentionally allows Whites, Blacks, and Neutrals weights to operate simultaneously with the chromatic hue weights (they are not normalized against each other). For a highly saturated bright-red pixel, both Reds weight (~1) and Whites weight (if $L > 0.8$) can be non-zero simultaneously. This matches Photoshop behavior but may be surprising to users who expect the nine ranges to be mutually exclusive. No spec change is warranted, but it should be noted in QA.
2. **Performance on large canvases** — `SEL_COLOR_FRAG` performs an RGB→HSL conversion, six hue-distance calculations, a 9-iteration loop, and a CMYK round-trip per pixel. This is more expensive than prior adjustment shaders. For a 4000×4000 canvas at 60 fps, this is still well within WebGL2 fragment throughput. If profiling reveals issues, the `rgb2hsl` conversion can be eliminated for pixels where the CMYK conversion provides sufficient information (but current design keeps it for correctness of the saturation-based achromatic guard).
3. **`Float32Array.from` per dispatch** — four 9-element `Float32Array` allocations per render pass are minor. A future optimization can pre-allocate fixed buffers on the renderer instance; defer until profiling shows it matters.
