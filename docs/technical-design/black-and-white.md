# Technical Design: Black and White

## Overview

The Black and White adjustment is a non-destructive child layer that converts the parent pixel layer to grayscale by allowing the user to control how each of six hue ranges — Reds, Yellows, Greens, Cyans, Blues, Magentas — contributes to the output brightness. Rather than using a fixed luminosity formula, the user can make specific hues appear lighter or darker in the gray output, enabling precise tonal control. The output is always fully desaturated regardless of slider positions. When the user triggers **Image → Black and White…**, a `BlackAndWhiteAdjustmentLayer` record is inserted into `state.layers` immediately after the active pixel layer (same positional contract as mask and all prior adjustment layers), `openAdjustmentLayerId` is set to the new layer's ID, and `AdjustmentPanel` opens showing `BlackAndWhitePanel`. Slider changes dispatch `UPDATE_ADJUSTMENT_LAYER` updates; on every update `useCanvas` re-runs its render via the WebGL compositing pipeline, which now includes a GPU-side black-and-white pass. No WASM is needed — all math is GLSL. One undo entry is recorded when the panel closes.

This design builds directly on the infrastructure established by `adjustment-menu.md`, `brightness-contrast.md`, `hue-saturation.md`, `color-vibrance.md`, and `color-balance.md`. Anything defined in those documents (type system, `AdjustmentPanel` shell, `useAdjustments`, `renderPlan` / `readFlattenedPlan` methods, `UPDATE_ADJUSTMENT_LAYER` action, `adjustmentMaskMap` ref, `BC_VERT` vertex shader, RGB ↔ HSL GLSL helpers) is **already in place** — this document only specifies what is new or extended.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'black-and-white'` to `AdjustmentType`; add `'black-and-white'` entry to `AdjustmentParamsMap`; add `BlackAndWhiteAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Add `'black-and-white'` entry to `ADJUSTMENT_REGISTRY` |
| `src/webgl/shaders.ts` | Add `BW_FRAG` constant; vertex stage reuses existing `BC_VERT` |
| `src/webgl/WebGLRenderer.ts` | Add local `BlackAndWhitePassParams` type; extend `AdjustmentRenderOp` union; add `bwProgram`; add `applyBlackAndWhitePass`; extend `renderPlan` / `readFlattenedPlan` loop; extend `destroy()` |
| `src/hooks/useCanvas.ts` | Extend render-plan builder to emit `kind: 'black-and-white'` entries |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `case 'black-and-white'` to adjustment-type switch |
| `src/components/panels/AdjustmentPanel/BlackAndWhitePanel.tsx` | **New file.** Six-slider sub-panel UI |
| `src/components/panels/AdjustmentPanel/BlackAndWhitePanel.module.scss` | **New file.** Scoped styles |

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
  | 'black-and-white'    // ← new
```

#### Extend `AdjustmentParamsMap`

```ts
export interface AdjustmentParamsMap {
  // …existing entries…
  'black-and-white': {
    reds:     number   // −200 … +300, default 40
    yellows:  number   // −200 … +300, default 60
    greens:   number   // −200 … +300, default 40
    cyans:    number   // −200 … +300, default 60
    blues:    number   // −200 … +300, default 20
    magentas: number   // −200 … +300, default 80
  }
}
```

The default values (40, 60, 40, 60, 20, 80) average to 50. This is significant: the grayscale formula uses `2 × L_HSL × weightedSlider / 100`, and at an average weight of 50 achromatic pixels are rendered at their original brightness (identity for grayscale). See Pixel Math below.

#### New layer interface

```ts
export interface BlackAndWhiteAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'black-and-white'
  params: AdjustmentParamsMap['black-and-white']
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
  | BlackAndWhiteAdjustmentLayer   // ← new
```

---

## Pixel Math

**No WASM function is required.** All math runs entirely on the GPU via a new GLSL program.

### Algorithm

The adjustment is a per-pixel two-step operation: compute a hue-weighted grayscale value, then write it to all three RGB channels.

**Step 1 — Convert to HSL:**

Using the same `rgb2hsl` helper defined in `HS_FRAG` (and copied verbatim into `BW_FRAG`):

$$
(H,\, S,\, L) = \text{rgb2hsl}(R, G, B)
$$

where $H \in [0, 1)$ maps to $[0°, 360°)$, $S \in [0, 1]$, and $L \in [0, 1]$.

**Step 2 — Compute triangular hue-range weights:**

The six hue ranges are centered at evenly-spaced hue angles:

| Range    | Center (normalized) | Center (degrees) |
|----------|---------------------|------------------|
| Reds     | 0/6 = 0.000         | 0°               |
| Yellows  | 1/6 ≈ 0.167         | 60°              |
| Greens   | 2/6 ≈ 0.333         | 120°             |
| Cyans    | 3/6 = 0.500         | 180°             |
| Blues    | 4/6 ≈ 0.667         | 240°             |
| Magentas | 5/6 ≈ 0.833         | 300°             |

For each range $i$ with center $c_i$, the circular distance from the current hue $H$ to that center is:

$$
d_i = \min\!\left(|H - c_i|,\; 1 - |H - c_i|\right)
$$

The triangular (tent) weight is then:

$$
w_i = \max(0,\; 1 - 6 \cdot d_i)
$$

Properties:
- $w_i = 1$ when $H = c_i$ (pixel is squarely in that range). ✓
- $w_i = 0$ when $d_i \geq 1/6$ (pixel is outside the range's ±30° window). ✓
- Exactly two adjacent weights are non-zero (and sum to 1) for any hue at a range boundary, and all six weights sum to exactly 1 for every $H$. ✓
- Reds uses `min(H, 1 − H)` as its circular distance, correctly wrapping around where $H \approx 0$ and $H \approx 1$ are adjacent on the hue wheel. ✓
- Magentas (center 5/6) wraps similarly — at $H \approx 0$ (next to Reds), the circular distance from 5/6 is only $1/6$, giving $w_M = 0$ (correctly zero at the Reds center). ✓

**Step 3 — Blend toward uniform weights for achromatic pixels:**

When $S \approx 0$ (achromatic, no dominant hue), the HSL hue $H$ is mathematically undefined and conventionally set to 0 in `rgb2hsl`. Naively applying the weight formula would assign all weight to Reds, which is incorrect — the spec requires an equal blend across all sliders for achromatic pixels.

A saturation-driven blend smoothly transitions from uniform (achromatic) to hue-based (chromatic):

$$
\text{satBlend} = \operatorname{clamp}(S \times 10,\; 0,\; 1)
$$

$$
\text{uniformSlider} = \frac{\text{reds} + \text{yellows} + \text{greens} + \text{cyans} + \text{blues} + \text{magentas}}{6}
$$

$$
\text{hueBased} = w_R \cdot \text{reds} + w_Y \cdot \text{yellows} + w_G \cdot \text{greens} + w_C \cdot \text{cyans} + w_B \cdot \text{blues} + w_M \cdot \text{magentas}
$$

$$
\text{weightedSlider} = \operatorname{mix}(\text{uniformSlider},\; \text{hueBased},\; \text{satBlend})
$$

The `clamp(S × 10, 0, 1)` factor fully transitions to hue-based weighting by $S = 0.1$, meaning only pixels with very low saturation (effectively achromatic) use the uniform blend. Above that threshold the hue-based weights dominate entirely.

**Step 4 — Compute grayscale output:**

$$
\text{gray} = \operatorname{clamp}\!\left(\frac{2 \cdot L \cdot \text{weightedSlider}}{100},\; 0,\; 1\right)
$$

The factor $2L$ (twice the HSL lightness) is the key scaling term. Its derivation:

- For any achromatic pixel $R = G = B = v$: $L_{HSL} = v$ (since $\max = \min = v$), so $2L = 2v$.
- With default sliders (average = 50): $\text{gray} = 2v \times 50/100 = v$. This is an **identity** for achromatic pixels — they render at their original brightness. ✓
- For a fully saturated primary color (e.g., pure red $(1, 0, 0)$): $L_{HSL} = 0.5$, so $2L = 1.0$. $\text{gray} = 1.0 \times \text{Reds}/100 = \text{Reds}/100$. The slider value directly maps to the output brightness (at default Reds=40: gray = 0.40). ✓
- A dark red $(0.25, 0, 0)$: $L_{HSL} = 0.125$, $2L = 0.25$. $\text{gray} = 0.25 \times 0.40 = 0.10$ — darker than the bright red, preserving relative tonal differences within the same hue. ✓

**"Setting all sliders to the same value V"** gives:

$$
\text{weightedSlider} = V \quad (\text{since weights sum to 1 for all } H)
$$

$$
\text{gray} = 2L \cdot V / 100
$$

- At $V = 50$: $\text{gray} = L_{HSL}$, which is standard HSL-based desaturation (setting $S = 0$ while preserving $L$). This is "simple desaturation at weight 50". ✓
- At $V = 100$: $\text{gray} = 2L$ (doubled, clamped). ✓
- At $V = 25$: $\text{gray} = L/2$ (halved). ✓

This satisfies the spec criterion: "Setting all sliders to the same value produces a flat-luminance grayscale result (equivalent to a simple desaturation at that weight)."

**Output:** Set $R' = G' = B' = \text{gray}$. This guarantees the output is always fully grayscale regardless of any slider combination. ✓ Output values are clamped to $[0, 1]$, preventing any slider configuration from producing below-black or above-white output. ✓

**Boundary checks:**

| Condition | Expected result |
|---|---|
| Default sliders, achromatic pixel R=G=B=v | gray = v (original brightness preserved) ✓ |
| Default sliders, fully saturated red | gray = 40/100 = 0.40 (reds treated at 40% weight) ✓ |
| Reds = +300, pure red pixel | gray = clamp(1.0 × 300/100, 0, 1) = 1.0 (white) ✓ |
| Blues = −200, pure blue pixel (L=0.5) | gray = clamp(2×0.5 × (−200)/100, 0, 1) = clamp(−2, 0, 1) = 0.0 (black) ✓ |
| Orange pixel (H between Reds and Yellows) | wR > 0, wY > 0, both blend smoothly ✓ |
| Achromatic pixel, S=0 | satBlend=0 → uniform weights → gray = avg(sliders)/100 × L_adj ✓ |
| All sliders = 50 | gray = L_HSL → standard desaturation ✓ |
| α = 0 | Early exit, pixel unchanged ✓ |

### RGB ↔ HSL helpers in `BW_FRAG`

`BW_FRAG` copies the `rgb2hsl` function verbatim from `HS_FRAG` and `VIB_FRAG`. The `hsl2rgb` function is **not** needed (no HSL→RGB conversion is required — the output is gray). This is documented as an intentional omission; if a developer adds `hsl2rgb` for future use, it must remain identical to the version in the other shaders.

### New GLSL — `BW_FRAG` in `src/webgl/shaders.ts`

Add the constant after `CB_FRAG`:

```ts
export const BW_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;
  uniform float u_reds;       // −200 … +300, default 40
  uniform float u_yellows;    // −200 … +300, default 60
  uniform float u_greens;     // −200 … +300, default 40
  uniform float u_cyans;      // −200 … +300, default 60
  uniform float u_blues;      // −200 … +300, default 20
  uniform float u_magentas;   // −200 … +300, default 80
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  // ── RGB → HSL (identical to HS_FRAG / VIB_FRAG) ──────────────────────
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

  // ── Hue circular distance ────────────────────────────────────────────
  float hueDist(float h, float center) {
    float d = abs(h - center);
    return min(d, 1.0 - d);
  }

  // ── Main ─────────────────────────────────────────────────────────────
  void main() {
    vec4 src = texture(u_src, v_texCoord);
    if (src.a < 0.0001) { fragColor = src; return; }

    // 1. Convert to HSL
    vec3 hsl = rgb2hsl(src.rgb);
    float H = hsl.x;
    float S = hsl.y;
    float L = hsl.z;

    // 2. Triangular hue-range weights
    //    Centers: Reds=0, Yellows=1/6, Greens=2/6, Cyans=3/6, Blues=4/6, Magentas=5/6
    //    Each weight is 1 at its center and falls to 0 at ±1/6 (the midpoint to adjacent ranges).
    //    Weights sum to exactly 1 for any H.
    float wR = max(0.0, 1.0 - 6.0 * hueDist(H, 0.0 / 6.0));
    float wY = max(0.0, 1.0 - 6.0 * hueDist(H, 1.0 / 6.0));
    float wG = max(0.0, 1.0 - 6.0 * hueDist(H, 2.0 / 6.0));
    float wC = max(0.0, 1.0 - 6.0 * hueDist(H, 3.0 / 6.0));
    float wB = max(0.0, 1.0 - 6.0 * hueDist(H, 4.0 / 6.0));
    float wM = max(0.0, 1.0 - 6.0 * hueDist(H, 5.0 / 6.0));

    // 3. Achromatism guard: blend toward uniform (equal) weights when S ≈ 0.
    //    For achromatic pixels (S=0), H is undefined (defaults to 0) — without
    //    this blend all weight would go to Reds, which is incorrect.
    //    satBlend reaches 1.0 at S = 0.1, so only near-achromatic pixels are affected.
    float uniformSlider = (u_reds + u_yellows + u_greens + u_cyans + u_blues + u_magentas) / 6.0;
    float hueBased      = wR * u_reds + wY * u_yellows + wG * u_greens
                        + wC * u_cyans + wB * u_blues  + wM * u_magentas;
    float satBlend      = clamp(S * 10.0, 0.0, 1.0);
    float weightedSlider = mix(uniformSlider, hueBased, satBlend);

    // 4. Compute grayscale output.
    //    2*L scales such that HSL L = 0.5 (all fully-saturated primaries) maps
    //    directly to weightedSlider/100. At default avg=50, achromatic pixels
    //    are reproduced at their exact original brightness (identity). See § Pixel Math.
    float gray = clamp(2.0 * L * weightedSlider / 100.0, 0.0, 1.0);

    // 5. Output as fully desaturated (R=G=B=gray); preserve original alpha.
    vec4 adjusted = vec4(gray, gray, gray, src.a);

    // 6. Selection mask blend
    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor   = mix(src, adjusted, mask);
  }
` as const
```

**Straight-alpha note:** Identical to all prior adjustment shaders — context uses `premultipliedAlpha: false`; no pre/de-multiply needed.

**`hueDist` inlining note:** The `hueDist` helper function is a two-line utility called six times. GLSL compilers will inline it automatically; it is written as a named function for readability only and there is no performance concern.

---

## WebGL Renderer Changes (`src/webgl/WebGLRenderer.ts`)

### New local type alias (before the class)

```ts
interface BlackAndWhitePassParams {
  reds:     number
  yellows:  number
  greens:   number
  cyans:    number
  blues:    number
  magentas: number
}
```

Structurally matches `AdjustmentParamsMap['black-and-white']` without requiring a cross-module import.

### Extend `AdjustmentRenderOp`

```ts
export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-vibrance'; vibrance: number; saturation: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-balance'; params: ColorBalancePassParams; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'black-and-white'; params: BlackAndWhitePassParams; visible: boolean; selMaskLayer?: WebGLLayer }  // ← new
```

### New private field

```ts
private readonly bwProgram: WebGLProgram
```

Import `BW_FRAG` from `./shaders` alongside the existing imports. Compile and link in the constructor after `this.cbProgram`:

```ts
this.bwProgram = linkProgram(
  gl,
  compileShader(gl, gl.VERTEX_SHADER,   BC_VERT),
  compileShader(gl, gl.FRAGMENT_SHADER, BW_FRAG)
)
```

### New public method: `applyBlackAndWhitePass`

```ts
applyBlackAndWhitePass(
  srcTex:       WebGLTexture,
  dstFb:        WebGLFramebuffer,
  params:       BlackAndWhitePassParams,
  selMaskLayer?: WebGLLayer
): void {
  const { gl } = this
  const w = this.pixelWidth, h = this.pixelHeight

  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFb)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)

  gl.useProgram(this.bwProgram)
  gl.uniform2f(gl.getUniformLocation(this.bwProgram, 'u_resolution'), w, h)
  gl.uniform1f(gl.getUniformLocation(this.bwProgram, 'u_reds'),     params.reds)
  gl.uniform1f(gl.getUniformLocation(this.bwProgram, 'u_yellows'),  params.yellows)
  gl.uniform1f(gl.getUniformLocation(this.bwProgram, 'u_greens'),   params.greens)
  gl.uniform1f(gl.getUniformLocation(this.bwProgram, 'u_cyans'),    params.cyans)
  gl.uniform1f(gl.getUniformLocation(this.bwProgram, 'u_blues'),    params.blues)
  gl.uniform1f(gl.getUniformLocation(this.bwProgram, 'u_magentas'), params.magentas)

  const posLoc = gl.getAttribLocation(this.bwProgram, 'a_position')
  gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
  fillRectBuffer(gl, 0, 0, w, h)
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, srcTex)
  gl.uniform1i(gl.getUniformLocation(this.bwProgram, 'u_src'), 0)

  if (selMaskLayer) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, selMaskLayer.texture)
    gl.uniform1i(gl.getUniformLocation(this.bwProgram, 'u_selMask'), 1)
    gl.uniform1i(gl.getUniformLocation(this.bwProgram, 'u_hasSelMask'), 1)
  } else {
    gl.uniform1i(gl.getUniformLocation(this.bwProgram, 'u_hasSelMask'), 0)
  }

  gl.drawArrays(gl.TRIANGLES, 0, 6)
}
```

### Extend `renderPlan` (and `readFlattenedPlan`) inner loop

Add the `black-and-white` case immediately after the `color-balance` case:

```ts
} else if (entry.kind === 'black-and-white') {
  if (!entry.visible) continue
  this.applyBlackAndWhitePass(srcTex, dstFb, entry.params, entry.selMaskLayer)
  ;[srcFb, dstFb] = [dstFb, srcFb]
  ;[srcTex, dstTex] = [dstTex, srcTex]
}
```

**Ping-pong swap:** mirrors all prior adjustment cases. An invisible black-and-white layer is skipped with no buffer swap.

### `destroy()` extension

Add `gl.deleteProgram(this.bwProgram)` alongside the existing `deleteProgram` calls.

---

## `useCanvas.ts` Render Plan Builder

Add the `black-and-white` branch after the `color-balance` branch:

```ts
} else if (l.type === 'adjustment' && l.adjustmentType === 'black-and-white') {
  plan.push({
    kind:         'black-and-white',
    params:       l.params,
    visible:      l.visible,
    selMaskLayer: adjustmentMaskMap.current.get(l.id),
  })
}
```

---

## `BlackAndWhitePanel` Component

**File:** `src/components/panels/AdjustmentPanel/BlackAndWhitePanel.tsx`  
**Category:** panel sub-component (same folder as `AdjustmentPanel`; **not** re-exported from `src/components/index.ts`)  
**Single responsibility:** render the six-slider body of the floating Black and White panel and dispatch param updates in real time.

### Props

```ts
interface BlackAndWhitePanelProps {
  layer: BlackAndWhiteAdjustmentLayer
}
```

No tonal range tabs. No local state. Fully controlled.

### Internals

- Reads `dispatch` from `useContext(AppContext)`.
- Renders six `SliderInput` widget rows listed in spec order:
  - **Reds** — `min={-200}` `max={300}` `default={40}`
  - **Yellows** — `min={-200}` `max={300}` `default={60}`
  - **Greens** — `min={-200}` `max={300}` `default={40}`
  - **Cyans** — `min={-200}` `max={300}` `default={60}`
  - **Blues** — `min={-200}` `max={300}` `default={20}`
  - **Magentas** — `min={-200}` `max={300}` `default={80}`
- On every slider `onChange` (while dragging), dispatches:
  ```ts
  dispatch({
    type: 'UPDATE_ADJUSTMENT_LAYER',
    payload: { ...layer, params: { ...layer.params, [changedKey]: newValue } },
  })
  ```
  Where `changedKey` is one of `'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas'`.
- Numeric inputs clamp to `[−200, 300]` on `onBlur` / Enter before dispatch. Values are never stored unclamped in state.
- All displayed values are read from `layer.params` (fully controlled).
- No tabs, no checkbox, no additional controls beyond the six sliders.

### Registration in `AdjustmentPanel.tsx`

```tsx
case 'black-and-white':
  return <BlackAndWhitePanel layer={layer as BlackAndWhiteAdjustmentLayer} />
```

---

## Adjustment Registry Changes

### `src/adjustments/registry.ts`

Add an entry to `ADJUSTMENT_REGISTRY` (append at the end):

```ts
{
  adjustmentType: 'black-and-white' as const,
  label: 'Black and White…',
  defaultParams: {
    reds:     40,
    yellows:  60,
    greens:   40,
    cyans:    60,
    blues:    20,
    magentas: 80,
  },
},
```

---

## Selection Masking

Identical to all prior adjustment types — no new code required in `useAdjustments.ts`. In `BW_FRAG`:

```glsl
float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
fragColor   = mix(src, adjusted, mask);
```

- `mask = 0` → original colored pixel (outside selection, unaffected). ✓
- `mask = 1` → grayscale output (inside selection). ✓
- Feathered selections produce smooth per-pixel blending between color and grayscale. ✓

`adjustmentMaskMap` cleanup is handled by the existing `useEffect` in `useCanvas` — no new code needed.

---

## Rendering Pipeline — Data Flow

1. **Slider drag** dispatches `UPDATE_ADJUSTMENT_LAYER` with updated `params`.
2. React re-renders; `useReducer` produces new `state.layers`.
3. **`useCanvas` render effect** fires. Builds `RenderPlanEntry[]`. The black-and-white layer maps to:
   ```ts
   { kind: 'black-and-white', params: l.params, visible: l.visible, selMaskLayer: … }
   ```
4. Calls `renderer.renderPlan(plan)`.
5. Ping-pong loop encounters the `kind: 'black-and-white'` entry and calls `applyBlackAndWhitePass(srcTex, dstFb, params, selMaskLayer)`, then swaps buffers.
6. Canvas pixels update on screen — fully grayscale in the affected region.

---

## Architectural Constraints

- **Output is always fully grayscale.** Setting $R' = G' = B' = \text{gray}$ in the shader is the sole enforcement mechanism — no TypeScript-side validation is needed since the constraint is purely in the GPU shader.
- **`rgb2hsl` in `BW_FRAG` must remain identical to `HS_FRAG` and `VIB_FRAG`.** If the HSL helper is ever updated for precision, all three shaders must be updated in the same commit. `hsl2rgb` is intentionally omitted from `BW_FRAG` since no HSL→RGB conversion is performed.
- **`WebGLRenderer.ts` does not import from `@/types`.** The local `BlackAndWhitePassParams` alias mirrors the params shape without creating a cross-layer import.
- **`BlackAndWhitePanel` is never re-exported from `src/components/index.ts`.** It is an internal sub-component of `AdjustmentPanel`.
- **No color toning.** The output is strictly neutral gray ($R' = G' = B'$). Sepia or duotone is out of scope for this adjustment.

---

## Open Questions

1. **`2 × L_HSL` vs BT.709 luminance as the base brightness.** The current formula uses HSL lightness $L$ as the per-pixel brightness axis. An alternative is BT.709 perceptual luminance (`dot(rgb, vec3(0.2126, 0.7152, 0.0722))`). For achromatic pixels both formulas give identical results. For chromatic pixels they diverge: with BT.709, fully saturated green $(0, 1, 0)$ at the same slider value would be almost twice as bright as red $(1, 0, 0)$, because BT.709 weights green heavily. With HSL $L$, both have $L = 0.5$ so their slider values map directly to equal base brightness. The HSL approach gives more "slider-literal" behavior and is the design choice here. If BT.709-based behavior is preferred after user testing, swap the luminance basis — it is a single-line GLSL change.
2. **Saturation blend ramp rate.** The `clamp(S × 10, 0, 1)` transitions to hue-based weights at $S = 0.1$. For very low-saturation (but slightly chromatic) pixels near $S = 0.05$, the behavior is roughly half-way between uniform and hue-based. If this transition is too abrupt or too gradual after visual testing, adjust the multiplier (e.g., `S × 5` for a slower ramp, `S × 20` for a faster one).
