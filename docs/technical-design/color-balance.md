# Technical Design: Color Balance

## Overview

The Color Balance adjustment is a non-destructive child layer that shifts the color distribution of a parent pixel layer by independently altering the Cyan↔Red, Magenta↔Green, and Yellow↔Blue balance across three luminance-defined tonal ranges (Shadows, Midtones, Highlights), with an optional Preserve Luminosity mode. When the user triggers **Image → Color Balance…**, a `ColorBalanceAdjustmentLayer` record is inserted into `state.layers` immediately after the active pixel layer (same positional contract as mask and all prior adjustment layers), `openAdjustmentLayerId` is set to the new layer's ID, and `AdjustmentPanel` opens showing `ColorBalancePanel`. Slider and checkbox changes dispatch `UPDATE_ADJUSTMENT_LAYER` updates; on every update `useCanvas` re-runs its render via the WebGL compositing pipeline, which now includes a GPU-side color-balance pass applied inline in the ping-pong loop. No WASM is needed — all math is GLSL. One undo entry is recorded when the panel closes.

This design builds directly on the infrastructure established by `adjustment-menu.md`, `brightness-contrast.md`, `hue-saturation.md`, and `color-vibrance.md`. Anything defined in those documents (type system, `AdjustmentPanel` shell, `useAdjustments`, `renderPlan` / `readFlattenedPlan` methods, `UPDATE_ADJUSTMENT_LAYER` action, `adjustmentMaskMap` ref, `BC_VERT` vertex shader) is **already in place** — this document only specifies what is new or extended.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'color-balance'` to `AdjustmentType`; add `'color-balance'` entry to `AdjustmentParamsMap`; add `ColorBalanceAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Add `'color-balance'` entry to `ADJUSTMENT_REGISTRY` |
| `src/webgl/shaders.ts` | Add `CB_FRAG` constant; vertex stage reuses existing `BC_VERT` |
| `src/webgl/WebGLRenderer.ts` | Add local `ColorBalancePassParams` type; extend `AdjustmentRenderOp` union; add `cbProgram`; add `applyColorBalancePass`; extend `renderPlan` / `readFlattenedPlan` loop; extend `destroy()` |
| `src/hooks/useCanvas.ts` | Extend render-plan builder to emit `kind: 'color-balance'` entries |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `case 'color-balance'` to adjustment-type switch |
| `src/components/panels/AdjustmentPanel/ColorBalancePanel.tsx` | **New file.** Three-range tab sub-panel UI |
| `src/components/panels/AdjustmentPanel/ColorBalancePanel.module.scss` | **New file.** Scoped styles |

No changes are required to `src/store/AppContext.tsx`, `src/hooks/useAdjustments.ts`, or `src/App.tsx` — the `UPDATE_ADJUSTMENT_LAYER` action, selection-mask registration flow, and `AdjustmentPanel` shell are fully generic and require no modification.

---

## State Changes

### New entries in `src/types/index.ts`

#### Extend `AdjustmentType`

```ts
export type AdjustmentType =
  | 'brightness-contrast'
  | 'hue-saturation'
  | 'color-vibrance'
  | 'color-balance'        // ← new
```

#### Extend `AdjustmentParamsMap`

Each tonal range stores three independent sliders — `cr` (Cyan↔Red), `mg` (Magenta↔Green), `yb` (Yellow↔Blue) — all in the range −100 to +100, where positive values push toward Red / Green / Blue and negative values push toward Cyan / Magenta / Yellow respectively. `preserveLuminosity` defaults to `true`.

```ts
export interface AdjustmentParamsMap {
  'brightness-contrast': { brightness: number; contrast: number }
  'hue-saturation':      { hue: number; saturation: number; lightness: number }
  'color-vibrance':      { vibrance: number; saturation: number }
  'color-balance': {
    shadows:    { cr: number; mg: number; yb: number }
    midtones:   { cr: number; mg: number; yb: number }
    highlights: { cr: number; mg: number; yb: number }
    preserveLuminosity: boolean
  }
}
```

#### New layer interface

```ts
export interface ColorBalanceAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'color-balance'
  params: AdjustmentParamsMap['color-balance']
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
  | ColorBalanceAdjustmentLayer   // ← new
```

No other type changes are needed — `UPDATE_ADJUSTMENT_LAYER` and the reducer are already generic and accept any `AdjustmentLayerState`.

---

## Pixel Math

**No WASM function is required.** All math runs entirely on the GPU via a new GLSL program.

### Algorithm

The adjustment is a per-pixel operation applied entirely in RGB space.

**Step 1 — Compute luminance and tonal masks:**

$$
\text{lum} = 0.2126 \cdot R + 0.7152 \cdot G + 0.0722 \cdot B \quad \text{(ITU-R BT.709)}
$$

$$
\text{shadowMask}    = 1 - \text{lum}
$$

$$
\text{highlightMask} = \text{lum}
$$

$$
\text{midtoneMask}   = 1 - |2 \cdot \text{lum} - 1|
$$

These three masks overlap by design. At $\text{lum} = 0$: shadow=1, midtone=0, highlight=0. At $\text{lum} = 0.5$: shadow=0.5, midtone=1, highlight=0.5. At $\text{lum} = 1$: shadow=0, midtone=0, highlight=1. Pixels in the midrange participate in blended proportions from adjacent ranges simultaneously.

**Step 2 — Compute weighted RGB shifts:**

$$
\Delta R = \frac{\text{sha.cr} \cdot \text{shadowMask} + \text{mid.cr} \cdot \text{midtoneMask} + \text{hil.cr} \cdot \text{highlightMask}}{100}
$$

$$
\Delta G = \frac{\text{sha.mg} \cdot \text{shadowMask} + \text{mid.mg} \cdot \text{midtoneMask} + \text{hil.mg} \cdot \text{highlightMask}}{100}
$$

$$
\Delta B = \frac{\text{sha.yb} \cdot \text{shadowMask} + \text{mid.yb} \cdot \text{midtoneMask} + \text{hil.yb} \cdot \text{highlightMask}}{100}
$$

$$
\text{adjusted} = \operatorname{clamp}(\text{rgb} + (\Delta R, \Delta G, \Delta B),\; 0,\; 1)
$$

**Step 3 — Conditionally restore original luminance (Preserve Luminosity):**

When `u_preserveLuminosity` is true:

$$
\text{newLum} = 0.2126 \cdot R' + 0.7152 \cdot G' + 0.0722 \cdot B'
$$

$$
\text{adjusted} = \operatorname{clamp}\!\left(\text{adjusted} \cdot \frac{\text{lum}}{\text{newLum}},\; 0,\; 1\right) \quad \text{if } \text{newLum} > 0.0001
$$

When $\text{lum} = 0$ (original black): the scale $\text{lum}/\text{newLum} = 0$ forces adjusted to $\mathbf{0}$, i.e., any color shift on a pure black pixel is reversed by preserveLuminosity — the pixel stays black. When $\text{newLum} \leq 0.0001$ (adjusted is effectively black after clamping): no scale is applied and adjusted is kept as-is (already near-black).

**Boundary checks:**

| Condition | Expected result |
|---|---|
| All sliders at 0, preserveLuminosity either | Identity — no change ✓ |
| Midtones `cr = +100`, pixel at lum=0.5 | `midtoneMask = 1.0`, `ΔR = 1.0` → strong red push to mid-tones ✓ |
| Shadows `yb = +100`, pixel at lum=0 | `shadowMask = 1.0`, `ΔB = 1.0` → blue push to shadows; highlights unaffected ✓ |
| Highlights `yb = +100`, pixel at lum=1 | `highlightMask = 1.0`, `ΔB = 1.0` → blue push to highlights only ✓ |
| `preserveLuminosity = true`, any extreme sliders | Luminance of adjusted output = original `lum` ✓ |
| `preserveLuminosity = false` | Luminance may shift as side-effect of color change ✓ |
| `α = 0` | Early exit, pixel unchanged ✓ |
| Achromatic pixel (R=G=B) | Color shift adds color even to grays (spec-required behavior) ✓ |
| Pixel fully transparent | Unchanged ✓ |

### New GLSL — `CB_FRAG` in `src/webgl/shaders.ts`

The vertex stage is identical to `BC_VERT`. Add only the fragment shader constant after `VIB_FRAG`:

```ts
export const CB_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;

  // Shadows tonal range (lum bias toward dark pixels)
  uniform float u_sha_cr;   // Cyan↔Red:      −100 … +100
  uniform float u_sha_mg;   // Magenta↔Green: −100 … +100
  uniform float u_sha_yb;   // Yellow↔Blue:   −100 … +100

  // Midtones tonal range (lum bias toward mid-gray pixels)
  uniform float u_mid_cr;
  uniform float u_mid_mg;
  uniform float u_mid_yb;

  // Highlights tonal range (lum bias toward bright pixels)
  uniform float u_hil_cr;
  uniform float u_hil_mg;
  uniform float u_hil_yb;

  uniform bool u_preserveLuminosity;
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  void main() {
    vec4 src = texture(u_src, v_texCoord);
    if (src.a < 0.0001) { fragColor = src; return; }

    vec3 rgb = src.rgb;

    // ── Step 1: luminance-based tonal masks ──────────────────────────────
    // BT.709 perceptual luminance
    float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

    float shadowMask    = 1.0 - lum;
    float highlightMask = lum;
    float midtoneMask   = 1.0 - abs(lum * 2.0 - 1.0);

    // ── Step 2: weighted per-channel shifts ──────────────────────────────
    // Positive cr → push toward Red (ΔR > 0); negative → push toward Cyan
    // Positive mg → push toward Green (ΔG > 0); negative → push toward Magenta
    // Positive yb → push toward Blue (ΔB > 0); negative → push toward Yellow
    float rShift = (u_sha_cr * shadowMask + u_mid_cr * midtoneMask + u_hil_cr * highlightMask) / 100.0;
    float gShift = (u_sha_mg * shadowMask + u_mid_mg * midtoneMask + u_hil_mg * highlightMask) / 100.0;
    float bShift = (u_sha_yb * shadowMask + u_mid_yb * midtoneMask + u_hil_yb * highlightMask) / 100.0;

    vec3 adjusted = clamp(rgb + vec3(rShift, gShift, bShift), 0.0, 1.0);

    // ── Step 3: preserve luminosity ──────────────────────────────────────
    if (u_preserveLuminosity) {
      float newLum = dot(adjusted, vec3(0.2126, 0.7152, 0.0722));
      // Scale adjusted back to original luminance.
      // Guard prevents division by near-zero (adjusted already ≈ black in that case).
      if (newLum > 0.0001) {
        adjusted = clamp(adjusted * (lum / newLum), 0.0, 1.0);
      }
      // When lum = 0 the numerator is 0: adjusted → vec3(0), preserving black. ✓
    }

    // ── Step 4: selection mask blend ─────────────────────────────────────
    vec4 result = vec4(adjusted, src.a);
    float mask  = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor   = mix(src, result, mask);
  }
` as const
```

**Straight-alpha note:** The WebGL context uses `premultipliedAlpha: false`; all FBO textures store straight RGBA. The shader reads and writes straight RGBA and must not premultiply or un-premultiply — identical to `BC_FRAG`, `HS_FRAG`, and `VIB_FRAG`.

---

## WebGL Renderer Changes (`src/webgl/WebGLRenderer.ts`)

### New local type alias (before the class)

`WebGLRenderer.ts` must not import from `@/types`. Define a local structural alias that mirrors `AdjustmentParamsMap['color-balance']` exactly:

```ts
interface ColorBalancePassParams {
  shadows:    { cr: number; mg: number; yb: number }
  midtones:   { cr: number; mg: number; yb: number }
  highlights: { cr: number; mg: number; yb: number }
  preserveLuminosity: boolean
}
```

TypeScript structural typing ensures this is assignment-compatible with `AdjustmentParamsMap['color-balance']` without any import coupling.

### Extend `AdjustmentRenderOp`

```ts
export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-vibrance'; vibrance: number; saturation: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-balance'; params: ColorBalancePassParams; visible: boolean; selMaskLayer?: WebGLLayer }  // ← new
```

`RenderPlanEntry` is unchanged — it already accepts any `AdjustmentRenderOp`.

### New private field

```ts
private readonly cbProgram: WebGLProgram
```

Import `CB_FRAG` from `./shaders` alongside the existing imports. Compile and link in the constructor after `this.vibProgram`:

```ts
this.cbProgram = linkProgram(
  gl,
  compileShader(gl, gl.VERTEX_SHADER,   BC_VERT),   // full-screen quad — same vertex stage
  compileShader(gl, gl.FRAGMENT_SHADER, CB_FRAG)
)
```

### New public method: `applyColorBalancePass`

```ts
applyColorBalancePass(
  srcTex:       WebGLTexture,
  dstFb:        WebGLFramebuffer,
  params:       ColorBalancePassParams,
  selMaskLayer?: WebGLLayer
): void {
  const { gl } = this
  const w = this.pixelWidth, h = this.pixelHeight

  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFb)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)

  gl.useProgram(this.cbProgram)
  gl.uniform2f(gl.getUniformLocation(this.cbProgram, 'u_resolution'), w, h)

  // Shadows
  gl.uniform1f(gl.getUniformLocation(this.cbProgram, 'u_sha_cr'), params.shadows.cr)
  gl.uniform1f(gl.getUniformLocation(this.cbProgram, 'u_sha_mg'), params.shadows.mg)
  gl.uniform1f(gl.getUniformLocation(this.cbProgram, 'u_sha_yb'), params.shadows.yb)
  // Midtones
  gl.uniform1f(gl.getUniformLocation(this.cbProgram, 'u_mid_cr'), params.midtones.cr)
  gl.uniform1f(gl.getUniformLocation(this.cbProgram, 'u_mid_mg'), params.midtones.mg)
  gl.uniform1f(gl.getUniformLocation(this.cbProgram, 'u_mid_yb'), params.midtones.yb)
  // Highlights
  gl.uniform1f(gl.getUniformLocation(this.cbProgram, 'u_hil_cr'), params.highlights.cr)
  gl.uniform1f(gl.getUniformLocation(this.cbProgram, 'u_hil_mg'), params.highlights.mg)
  gl.uniform1f(gl.getUniformLocation(this.cbProgram, 'u_hil_yb'), params.highlights.yb)
  // Preserve luminosity
  gl.uniform1i(gl.getUniformLocation(this.cbProgram, 'u_preserveLuminosity'), params.preserveLuminosity ? 1 : 0)

  const posLoc = gl.getAttribLocation(this.cbProgram, 'a_position')
  gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
  fillRectBuffer(gl, 0, 0, w, h)
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, srcTex)
  gl.uniform1i(gl.getUniformLocation(this.cbProgram, 'u_src'), 0)

  if (selMaskLayer) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, selMaskLayer.texture)
    gl.uniform1i(gl.getUniformLocation(this.cbProgram, 'u_selMask'), 1)
    gl.uniform1i(gl.getUniformLocation(this.cbProgram, 'u_hasSelMask'), 1)
  } else {
    gl.uniform1i(gl.getUniformLocation(this.cbProgram, 'u_hasSelMask'), 0)
  }

  gl.drawArrays(gl.TRIANGLES, 0, 6)
}
```

### Extend `renderPlan` (and `readFlattenedPlan`) inner loop

Add the `color-balance` case immediately after the `color-vibrance` case:

```ts
} else if (entry.kind === 'color-balance') {
  if (!entry.visible) continue
  this.applyColorBalancePass(srcTex, dstFb, entry.params, entry.selMaskLayer)
  ;[srcFb, dstFb] = [dstFb, srcFb]
  ;[srcTex, dstTex] = [dstTex, srcTex]
}
```

**Ping-pong swap:** the swap mirrors all prior adjustment cases. An invisible color-balance layer is skipped entirely with no buffer swap, leaving ping-pong state unchanged.

### `destroy()` extension

Add `gl.deleteProgram(this.cbProgram)` alongside the existing `deleteProgram` calls.

---

## `useCanvas.ts` Render Plan Builder

In the render-plan building loop (inside `useCanvas`), add the `color-balance` branch after the `color-vibrance` branch:

```ts
} else if (l.type === 'adjustment' && l.adjustmentType === 'color-balance') {
  plan.push({
    kind:         'color-balance',
    params:       l.params,
    visible:      l.visible,
    selMaskLayer: adjustmentMaskMap.current.get(l.id),
  })
}
```

The `params` object is passed by reference directly from state — no destructuring required due to the nested `ColorBalancePassParams` shape in the RenderOp.

---

## `ColorBalancePanel` Component

**File:** `src/components/panels/AdjustmentPanel/ColorBalancePanel.tsx`  
**Category:** panel sub-component (same folder as `AdjustmentPanel`; **not** re-exported from `src/components/index.ts` — only `AdjustmentPanel` is)  
**Single responsibility:** render the tonal-range tabs and three-slider body of the floating Color Balance panel; dispatch param updates in real time.

### Props

```ts
interface ColorBalancePanelProps {
  layer: ColorBalanceAdjustmentLayer
}
```

`onClose` is **not** a prop — `AdjustmentPanel` owns the close button and Escape handler.

### Local state

```ts
const [activeRange, setActiveRange] = useState<'shadows' | 'midtones' | 'highlights'>('midtones')
```

This is purely UI state: which tab is shown. It does not affect the stored params or the render pipeline.

### Internals

- Reads `dispatch` from `useContext(AppContext)`.
- Renders three tab buttons: **Shadows**, **Midtones**, **Highlights**. `activeRange` controls which is visually active; `setActiveRange` on click. Midtones is the default.
- Under the active tab, renders three `SliderInput` widget rows. The sliders read from `layer.params[activeRange]`:
  - **Cyan ↔ Red** — `min={-100}` `max={100}` `default={0}` — label endpoints "Cyan" / "Red"
  - **Magenta ↔ Green** — `min={-100}` `max={100}` `default={0}` — label endpoints "Magenta" / "Green"
  - **Yellow ↔ Blue** — `min={-100}` `max={100}` `default={0}` — label endpoints "Yellow" / "Blue"
- Beneath the sliders, renders a **Preserve Luminosity** checkbox that reads `layer.params.preserveLuminosity`.
- On every slider `onChange` (while dragging), dispatches:
  ```ts
  dispatch({
    type: 'UPDATE_ADJUSTMENT_LAYER',
    payload: {
      ...layer,
      params: {
        ...layer.params,
        [activeRange]: { cr, mg, yb },   // only the active range changes
      },
    },
  })
  ```
- On checkbox `onChange`, dispatches:
  ```ts
  dispatch({
    type: 'UPDATE_ADJUSTMENT_LAYER',
    payload: { ...layer, params: { ...layer.params, preserveLuminosity: checked } },
  })
  ```
- Numeric inputs clamp to `[−100, 100]` on `onBlur` / Enter before dispatch. Values are never stored unclamped in state.
- All three tonal ranges retain their values independently; switching tabs does not alter stored params for the inactive ranges.
- No Reset button is required by the spec; implementation may choose to add one (dispatching all ranges to `{cr:0, mg:0, yb:0}` with `preserveLuminosity: true`).
- Fully controlled panel: all displayed values come from `layer.params`, never local state.

### Registration in `AdjustmentPanel.tsx`

```tsx
case 'color-balance':
  return <ColorBalancePanel layer={layer as ColorBalanceAdjustmentLayer} />
```

---

## Adjustment Registry Changes

### `src/adjustments/registry.ts`

Add an entry to `ADJUSTMENT_REGISTRY` (append at the end of the array):

```ts
{
  adjustmentType: 'color-balance' as const,
  label: 'Color Balance…',
  defaultParams: {
    shadows:    { cr: 0, mg: 0, yb: 0 },
    midtones:   { cr: 0, mg: 0, yb: 0 },
    highlights: { cr: 0, mg: 0, yb: 0 },
    preserveLuminosity: true,
  },
},
```

The `label` controls the menu item text in the TopBar Image menu. `defaultParams` matches `AdjustmentParamsMap['color-balance']` exactly — TypeScript will verify this via `satisfies`.

---

## Selection Masking

The selection masking pattern is **identical to all prior adjustment types**. The existing generic `handleCreateAdjustmentLayer` in `useAdjustments.ts` already:

1. Calls `getSelectionPixels()` to obtain the full-canvas selection `Uint8Array | null`.
2. Sets `hasMask = selPixels !== null` on the dispatched `ADD_ADJUSTMENT_LAYER` payload.
3. Calls `registerAdjMask(newLayerId, selPixels)` if a selection was active.

In `CB_FRAG`:

```glsl
float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
fragColor   = mix(src, result, mask);
```

- `mask = 0` (outside selection) → `fragColor = src` (original pixel, unaffected). ✓
- `mask = 1` (inside selection) → `fragColor = result` (color-balanced pixel). ✓
- Feathered / anti-aliased selections produce smooth per-pixel blending. ✓

No new cleanup code is required for mask teardown — the existing `useEffect` in `useCanvas` that monitors `state.layers` for removed layers handles `adjustmentMaskMap` cleanup automatically.

---

## Rendering Pipeline — Data Flow

1. **Slider drag or checkbox change** dispatches `UPDATE_ADJUSTMENT_LAYER` with updated `params`.
2. React re-renders; `useReducer` produces a new `state.layers` containing the updated `ColorBalanceAdjustmentLayer`.
3. **`useCanvas` render effect** fires. Builds `RenderPlanEntry[]` from `state.layers`. The color-balance layer maps to:
   ```ts
   { kind: 'color-balance', params: l.params, visible: l.visible, selMaskLayer: adjustmentMaskMap.current.get(l.id) }
   ```
4. Calls `renderer.renderPlan(plan)`.
5. Ping-pong loop encounters the `kind: 'color-balance'` entry and calls `applyColorBalancePass(srcTex, dstFb, params, selMaskLayer)`, then swaps buffers.
6. Canvas pixels update on screen.

**GPU work per slider tick:** one compositing pass per underlying pixel layer + one full-screen color-balance quad draw. No WASM, no debouncing. The entire path is synchronous GPU work within a single React render cycle.

---

## Architectural Constraints

- **No pixel data in React state.** The selection mask is stored in `adjustmentMaskMap` (a `useRef` inside `useCanvas`), not in the layer state object. `hasMask: boolean` is the only flag stored in state.
- **Straight-alpha everywhere.** `premultipliedAlpha: false` on the WebGL context. The shader reads and writes un-premultiplied RGBA — no pre/de-multiply step.
- **`WebGLRenderer.ts` does not import from `@/types`.** The local `ColorBalancePassParams` alias mirrors the params shape without creating a cross-layer import.
- **`CB_FRAG` is the single GPU-side source of truth** for the color balance formula. Any changes to the tonal mask shapes (e.g., switching from linear to cosine falloff) must be done only in `CB_FRAG` — there is no TypeScript CPU-side mirror required (unlike blend modes, which must match `compositeLayers`).
- **`ColorBalancePanel` is never re-exported from `src/components/index.ts`.** It is an internal sub-component of `AdjustmentPanel`.

---

## Open Questions

1. **Tonal mask overlap vs. normalization.** The three masks (1−lum, lum, 1−|2lum−1|) do not sum to 1 for all luminance values (e.g., at lum=0.5, sum=2). This is intentional and matches Photoshop behavior — pixels in the midrange are more strongly affected than pixels at the extremes. If future audits determine that normalized masks are preferred, the shader can divide each mask by the sum; this is a one-line GLSL change with no architectural impact.
2. **Preserve Luminosity scaling vs. HSL round-trip.** The current design uses a BT.709 luminance-ratio scale (`adjusted * lum / newLum`). An alternative is a full HSL round-trip (adjust RGB, convert to HSL, substitute original L, convert back). The scaling approach is cheaper (no HSL) but may shift hue/saturation slightly for extreme inputs. If pixel-perfect Photoshop parity is required, revisit with the HSL round-trip.
