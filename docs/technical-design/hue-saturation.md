# Technical Design: Hue/Saturation

## Overview

The Hue/Saturation adjustment is a non-destructive child layer that rotates pixel hues, scales color saturation, and shifts overall lightness on a parent pixel layer at render time — never touching the parent's pixel data. When the user triggers **Image → Hue/Saturation…**, a `HueSaturationAdjustmentLayer` record is inserted into `state.layers` immediately after the active pixel layer (same positional contract as mask and brightness-contrast adjustment layers), `openAdjustmentLayerId` is set to the new layer's ID, and `AdjustmentPanel` opens showing `HueSaturationPanel`. Slider changes dispatch `UPDATE_ADJUSTMENT_LAYER` updates; on every such update `useCanvas` re-runs its render via the WebGL compositing pipeline, which now includes a GPU-side HSL pass applied inline in the ping-pong loop. No WASM is needed. One undo entry is recorded when the panel closes.

This design builds directly on top of the infrastructure established by `adjustment-menu.md` and `brightness-contrast.md`. Anything defined in those documents (type system, `AdjustmentPanel` shell, `useAdjustments`, `renderPlan` / `readFlattenedPlan` methods, `UPDATE_ADJUSTMENT_LAYER` action, `adjustmentMaskMap` ref) is **already in place** — this document only specifies what is new or extended.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `hasMask: boolean` to `HueSaturationAdjustmentLayer` |
| `src/webgl/shaders.ts` | Add `HS_FRAG` constant; vertex stage reuses existing `BC_VERT` |
| `src/webgl/WebGLRenderer.ts` | Extend `AdjustmentRenderOp` union; add `hsProgram`; add `applyHueSaturationPass`; extend `renderPlan` / `readFlattenedPlan` loop |
| `src/hooks/useCanvas.ts` | Extend render-plan builder to emit `kind: 'hue-saturation'` entries |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `case 'hue-saturation'` to adjustment-type switch |
| `src/components/panels/AdjustmentPanel/HueSaturationPanel.tsx` | **New file.** Three-slider sub-panel UI |
| `src/components/panels/AdjustmentPanel/HueSaturationPanel.module.scss` | **New file.** Scoped styles |

No changes are required to `src/store/AppContext.tsx`, `src/hooks/useAdjustments.ts`, or `src/App.tsx` — the `UPDATE_ADJUSTMENT_LAYER` action, selection-mask registration flow, and `AdjustmentPanel` shell are fully generic and were designed to accommodate this feature without modification.

---

## State Changes

### Extend `HueSaturationAdjustmentLayer` in `src/types/index.ts`

The adjustment-menu design defined:

```ts
export interface HueSaturationAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'hue-saturation'
  params: AdjustmentParamsMap['hue-saturation']  // { hue: number; saturation: number; lightness: number }
}
```

Add one field:

```ts
export interface HueSaturationAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'hue-saturation'
  params: AdjustmentParamsMap['hue-saturation']
  /** True when a selection was active at creation time; the baked mask pixels
   *  live in useCanvas.adjustmentMaskMap (not in React state). */
  hasMask: boolean
}
```

This mirrors the identical addition on `BrightnessContrastAdjustmentLayer` and keeps pixel data out of React state for the same reasons.

---

## Pixel Math

**No WASM function is required.** The HSL conversion and all three parameter applications run entirely on the GPU via a new GLSL program.

### Algorithm

The adjustment is a three-step transform applied per-pixel in HSL color space:

$$
H_{out} = \operatorname{fract}\!\left(H_{in} + \frac{u\_hue}{360}\right)
$$

$$
S_{out} = \operatorname{clamp}\!\left(S_{in} + \frac{u\_saturation}{100},\; 0,\; 1\right)
$$

$$
L_{out} = \operatorname{clamp}\!\left(L_{in} + \frac{u\_lightness}{100},\; 0,\; 1\right)
$$

**Boundary checks:**
- $u\_hue = \pm 180$: $H_{out} = \operatorname{fract}(H_{in} \pm 0.5)$ — rotates to the complementary hue. ✓  
- $u\_saturation = -100$: $S_{out} = 0$ for all pixels → fully desaturated (grayscale). ✓  
- $u\_saturation = +100$: $S_{out} = \operatorname{clamp}(S_{in} + 1, 0, 1) = 1$ for all chromatic pixels → maximally saturated. ✓  
- $u\_lightness = +100$: $L_{out} = 1$ (white) for all pixels. ✓  
- $u\_lightness = -100$: $L_{out} = 0$ (black) for all pixels. ✓  
- All three at 0: identity — pixel is unchanged. ✓  
- $\alpha = 0$: shader returns `src` unchanged (early exit). ✓  
- Achromatic pixel ($R = G = B$): chroma C = 0 → $H_{in} = 0$ (stored as undefined, defaults to 0) and $S_{in} = 0$. Hue rotation has no effect (applying rotation to H=0 is still H=0.5 after fract when hue=180, but at S_out=0 that H value is irrelevant — HSL→RGB with S=0 always yields $L$ mapped through all three channels identically). Saturation and Lightness changes apply normally. ✓

**Achromatic + saturation note:** A pixel with $R=G=B$ and $S_{in}=0$ will, after saturation increase, have $S_{out} > 0$ with $H_{in} = 0$. HSL→RGB at H=0 places the chroma on the red channel, producing a reddish tint. This is Photoshop-compatible behavior and is intentional (see Open Questions §1).

### RGB ↔ HSL in GLSL

The HSL model used here is the standard Wikipedia/W3C definition where H ∈ [0, 1) maps to [0°, 360°), S ∈ [0, 1], and L ∈ [0, 1].

```glsl
// RGB (all channels in [0,1]) → HSL
vec3 rgb2hsl(vec3 c) {
  float maxC  = max(c.r, max(c.g, c.b));
  float minC  = min(c.r, min(c.g, c.b));
  float delta = maxC - minC;

  float L = (maxC + minC) * 0.5;
  float S = 0.0;
  float H = 0.0;

  if (delta > 0.00001) {
    S = delta / (1.0 - abs(2.0 * L - 1.0));

    if (maxC == c.r)       H = mod((c.g - c.b) / delta, 6.0) / 6.0;
    else if (maxC == c.g)  H = ((c.b - c.r) / delta + 2.0) / 6.0;
    else                   H = ((c.r - c.g) / delta + 4.0) / 6.0;
  }

  return vec3(H, S, L);
}

// HSL → RGB (all outputs in [0,1])
vec3 hsl2rgb(vec3 hsl) {
  float H = hsl.x, S = hsl.y, L = hsl.z;
  float C = (1.0 - abs(2.0 * L - 1.0)) * S;
  float X = C * (1.0 - abs(mod(H * 6.0, 2.0) - 1.0));
  float m = L - C * 0.5;

  vec3 rgb;
  float h6 = H * 6.0;
  if      (h6 < 1.0) rgb = vec3(C, X, 0.0);
  else if (h6 < 2.0) rgb = vec3(X, C, 0.0);
  else if (h6 < 3.0) rgb = vec3(0.0, C, X);
  else if (h6 < 4.0) rgb = vec3(0.0, X, C);
  else if (h6 < 5.0) rgb = vec3(X, 0.0, C);
  else               rgb = vec3(C, 0.0, X);

  return clamp(rgb + m, 0.0, 1.0);
}
```

**Floating-point equality in `rgb2hsl`:** The `maxC == c.r` comparisons are safe here because `maxC` is the direct result of `max(c.r, ...)` — its bit pattern is identical to one of the inputs at the GLSL hardware level. This is valid in the same way the existing blend-mode shader uses `step()` comparisons against fixed values. For pure mediump, add a tiny epsilon test if precision complaints arise in testing.

### New GLSL — `HS_FRAG` in `src/webgl/shaders.ts`

The vertex stage is identical to `BC_VERT` (a full-screen post-process quad that computes `v_texCoord` from `a_position / u_resolution`). Add only a fragment shader constant:

```ts
export const HS_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;         // accumulated composite (straight RGBA)
  uniform float u_hue;             // −180 … +180  (degrees)
  uniform float u_saturation;      // −100 … +100
  uniform float u_lightness;       // −100 … +100
  uniform sampler2D u_selMask;     // baked selection mask (R = alpha, full-canvas)
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  // ── RGB ↔ HSL helpers ────────────────────────────────────────────────────

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

  vec3 hsl2rgb(vec3 hsl) {
    float H = hsl.x, S = hsl.y, L = hsl.z;
    float C = (1.0 - abs(2.0 * L - 1.0)) * S;
    float X = C * (1.0 - abs(mod(H * 6.0, 2.0) - 1.0));
    float m = L - C * 0.5;
    vec3 rgb;
    float h6 = H * 6.0;
    if      (h6 < 1.0) rgb = vec3(C, X, 0.0);
    else if (h6 < 2.0) rgb = vec3(X, C, 0.0);
    else if (h6 < 3.0) rgb = vec3(0.0, C, X);
    else if (h6 < 4.0) rgb = vec3(0.0, X, C);
    else if (h6 < 5.0) rgb = vec3(X, 0.0, C);
    else               rgb = vec3(C, 0.0, X);
    return clamp(rgb + m, 0.0, 1.0);
  }

  // ── Main ─────────────────────────────────────────────────────────────────

  void main() {
    vec4 src = texture(u_src, v_texCoord);

    // Preserve fully-transparent pixels
    if (src.a < 0.0001) { fragColor = src; return; }

    // 1. Convert to HSL
    vec3 hsl = rgb2hsl(src.rgb);

    // 2. Apply adjustments
    hsl.x = fract(hsl.x + u_hue / 360.0);                         // hue rotation (wraps)
    hsl.y = clamp(hsl.y + u_saturation / 100.0, 0.0, 1.0);        // saturation shift
    hsl.z = clamp(hsl.z + u_lightness  / 100.0, 0.0, 1.0);        // lightness shift

    // 3. Convert back to RGB
    vec3 adjustedRGB = hsl2rgb(hsl);
    vec4 adjusted = vec4(adjustedRGB, src.a);

    // 4. Selection mask blend (0 = unaffected, 1 = fully adjusted)
    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor = mix(src, adjusted, mask);
  }
` as const
```

**Straight-alpha note:** The WebGL context uses `premultipliedAlpha: false`; all FBO textures store straight RGBA. The shader operates on straight RGB directly — no pre/de-multiply step needed. This matches the `BC_FRAG` approach.

---

## WebGL Renderer Changes (`src/webgl/WebGLRenderer.ts`)

### Extend `AdjustmentRenderOp` export

The BC design established:

```ts
export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number; visible: boolean; selMaskLayer?: WebGLLayer }
```

Extend the union with the new variant:

```ts
export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'hue-saturation';      hue: number; saturation: number; lightness: number;    visible: boolean; selMaskLayer?: WebGLLayer }
```

`RenderPlanEntry` is unchanged — it already accepts any `AdjustmentRenderOp` via the union.

### New private field

```ts
private readonly hsProgram: WebGLProgram
```

`hsProgram` is compiled and linked in the constructor, alongside (and immediately after) `bcProgram`:

```ts
// In constructor, after bcProgram is initialized:
this.hsProgram = linkProgram(
  gl,
  compileShader(gl, gl.VERTEX_SHADER,   BC_VERT),   // full-screen quad — identical to BC
  compileShader(gl, gl.FRAGMENT_SHADER, HS_FRAG)
)
```

Import `HS_FRAG` (and ensure `BC_VERT` is already imported) from `./shaders`.

### New public method: `applyHueSaturationPass`

```ts
applyHueSaturationPass(
  srcTex:       WebGLTexture,
  dstFb:        WebGLFramebuffer,
  hue:          number,
  saturation:   number,
  lightness:    number,
  selMaskLayer?: WebGLLayer
): void
```

Structure is identical to `applyBrightnessContrastPass` — full-screen quad draw from `srcTex` into `dstFb`:

```ts
applyHueSaturationPass(srcTex, dstFb, hue, saturation, lightness, selMaskLayer) {
  const { gl } = this
  const w = this.pixelWidth, h = this.pixelHeight

  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFb)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)

  gl.useProgram(this.hsProgram)
  gl.uniform2f(gl.getUniformLocation(this.hsProgram, 'u_resolution'), w, h)
  gl.uniform1f(gl.getUniformLocation(this.hsProgram, 'u_hue'),        hue)
  gl.uniform1f(gl.getUniformLocation(this.hsProgram, 'u_saturation'), saturation)
  gl.uniform1f(gl.getUniformLocation(this.hsProgram, 'u_lightness'),  lightness)

  const posLoc = gl.getAttribLocation(this.hsProgram, 'a_position')
  gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
  fillRectBuffer(gl, 0, 0, w, h)
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, srcTex)
  gl.uniform1i(gl.getUniformLocation(this.hsProgram, 'u_src'), 0)

  if (selMaskLayer) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, selMaskLayer.texture)
    gl.uniform1i(gl.getUniformLocation(this.hsProgram, 'u_selMask'), 1)
    gl.uniform1i(gl.getUniformLocation(this.hsProgram, 'u_hasSelMask'), 1)
  } else {
    gl.uniform1i(gl.getUniformLocation(this.hsProgram, 'u_hasSelMask'), 0)
  }

  gl.drawArrays(gl.TRIANGLES, 0, 6)
}
```

### Extend `renderPlan` (and `readFlattenedPlan`) inner loop

In the `renderPlan` / `readFlattenedPlan` ping-pong loop, add the `hue-saturation` case immediately after the `brightness-contrast` case:

```ts
} else if (entry.kind === 'hue-saturation') {
  if (!entry.visible) continue
  this.applyHueSaturationPass(
    srcTex, dstFb,
    entry.hue, entry.saturation, entry.lightness,
    entry.selMaskLayer
  )
  ;[srcFb, dstFb] = [dstFb, srcFb]
  ;[srcTex, dstTex] = [dstTex, srcTex]
}
```

**Ping-pong swap:** the swap mirrors the `brightness-contrast` case exactly. An invisible hue-saturation layer (`visible: false`) is skipped entirely — no pass is executed and no swap occurs, so the ping-pong state is unchanged.

### `destroy()` extension

Add `gl.deleteProgram(this.hsProgram)` to the `destroy()` method alongside the existing program deletions.

---

## `HueSaturationPanel` Component

**File:** `src/components/panels/AdjustmentPanel/HueSaturationPanel.tsx`  
**Category:** panel sub-component (same folder as `AdjustmentPanel`; **not** re-exported from `src/components/index.ts` — only `AdjustmentPanel` is)  
**Single responsibility:** render the three-slider body of the floating Hue/Saturation panel and dispatch param updates in real time.

### Props

```ts
interface HueSaturationPanelProps {
  layer: HueSaturationAdjustmentLayer
}
```

`onClose` is **not** a prop — `AdjustmentPanel` owns the close button and Escape handler.

### Internals

- Reads `dispatch` from `useContext(AppContext)`.
- Renders three `SliderInput` widget rows (the existing reusable widget):
  - **Hue** — `min={-180}` `max={180}` `default={0}` — label "Hue", unit "°"
  - **Saturation** — `min={-100}` `max={100}` `default={0}` — label "Saturation"
  - **Lightness** — `min={-100}` `max={100}` `default={0}` — label "Lightness"
- On every `onChange` (while dragging), dispatches:
  ```ts
  dispatch({
    type: 'UPDATE_ADJUSTMENT_LAYER',
    payload: { ...layer, params: { hue, saturation, lightness } }
  })
  ```
- Numeric inputs clamp to their respective ranges on `onBlur` / Enter:
  - Hue: clamped to `[−180, 180]`
  - Saturation: clamped to `[−100, 100]`
  - Lightness: clamped to `[−100, 100]`
  Values outside range are clamped before dispatch; they are never stored in state unclamped.
- A **Reset** button in the panel footer dispatches `UPDATE_ADJUSTMENT_LAYER` with `params: { hue: 0, saturation: 0, lightness: 0 }`.
- No local state: the panel is fully controlled — it reads `layer.params` for the current values; dispatching always goes through `AppContext`.

### Registration in `AdjustmentPanel.tsx`

In the `adjustmentType` switch inside `AdjustmentPanel.tsx`, add:

```tsx
case 'hue-saturation':
  return <HueSaturationPanel layer={layer} />
```

---

## Rendering Pipeline — Data Flow

The full pipeline from slider drag to on-screen pixel update:

1. **Slider `onChange`** dispatches `UPDATE_ADJUSTMENT_LAYER` with new `params.hue` / `params.saturation` / `params.lightness`.
2. React re-renders; `useReducer` produces a new `state.layers` containing the updated `HueSaturationAdjustmentLayer`.
3. **`useCanvas` render effect** fires (it already watches `state.layers`). It builds the `RenderPlan[]` from `state.layers`. For each entry:
   - `isPixelLayer(l)` → `{ kind: 'layer', layer: wglLayerMap.current.get(l.id), mask: maskMap.get(l.id) }`
   - `l.type === 'adjustment' && l.adjustmentType === 'brightness-contrast'` → BC op entry (existing)
   - `l.type === 'adjustment' && l.adjustmentType === 'hue-saturation'` →
     ```ts
     {
       kind:         'hue-saturation',
       hue:          l.params.hue,
       saturation:   l.params.saturation,
       lightness:    l.params.lightness,
       visible:      l.visible,
       selMaskLayer: adjustmentMaskMap.current.get(l.id),
     }
     ```
   - Other layer types → handled by their own implementations (text, shape, etc.)
4. Calls `renderer.renderPlan(plan)`.
5. Inside `renderPlan`, the ping-pong loop encounters the `kind: 'hue-saturation'` entry and calls `applyHueSaturationPass(srcTex, dstFb, hue, saturation, lightness, selMaskLayer)`, then swaps buffers.
6. Canvas pixels update on screen.

**GPU work per slider tick:** one compositing pass per underlying pixel layer + one full-screen HS quad draw. No WASM, no debouncing. The path is synchronous within a single React render cycle.

---

## Selection Masking

The selection masking pattern is **identical to `brightness-contrast`**. No new code is needed in `useAdjustments.ts` or `App.tsx` — the existing generic `handleCreateAdjustmentLayer` already:

1. Calls `getSelectionPixels()` to obtain the full-canvas selection `Uint8Array | null`.
2. Sets `hasMask = selPixels !== null` on the dispatched payload.
3. Calls `registerAdjMask(newLayerId, selPixels)` if a selection was active.

`registerAdjMask` in `useCanvas` creates a `WebGLLayer` at full canvas size, copies the selection alpha into the R channel, flushes it to GPU, and stores it in `adjustmentMaskMap.current`.

### In the GLSL pass

`HS_FRAG` samples `u_selMask` at `v_texCoord` (full-canvas UV, identical coordinate space). The R channel drives the `mix()` blend weight, exactly as in `BC_FRAG`:

```glsl
float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
fragColor = mix(src, adjusted, mask);
```

- `mask = 0` (outside selection) → `fragColor = src` (unaffected). ✓  
- `mask = 1` (inside selection) → `fragColor = adjusted`. ✓  
- Feathered selections produce smooth per-pixel blending automatically. ✓

### Cleanup

Orphaned `adjustmentMaskMap` entries are handled by the same `useEffect` in `useCanvas` that already monitors `state.layers` for `renderMaskMap` cleanup — it calls `renderer.destroyLayer(maskLayer)` for any adjustment layer ID that disappears from `state.layers` (either the adjustment layer itself was deleted, or its parent was deleted and `REMOVE_LAYER` cascaded).

---

## New Files and Changed Files

### New files

| File | Purpose |
|---|---|
| `src/components/panels/AdjustmentPanel/HueSaturationPanel.tsx` | Three-slider sub-panel UI (Hue, Saturation, Lightness) |
| `src/components/panels/AdjustmentPanel/HueSaturationPanel.module.scss` | Scoped styles (mirrors `BrightnessContrastPanel.module.scss` layout) |

### Changed files

| File | Summary of change |
|---|---|
| `src/types/index.ts` | Add `hasMask: boolean` to `HueSaturationAdjustmentLayer` |
| `src/webgl/shaders.ts` | Add `HS_FRAG` constant |
| `src/webgl/WebGLRenderer.ts` | Extend `AdjustmentRenderOp` union; add `hsProgram` field + constructor init + `destroy()` cleanup; add `applyHueSaturationPass`; extend `renderPlan` / `readFlattenedPlan` loop |
| `src/hooks/useCanvas.ts` | Extend render-plan builder: add `hue-saturation` branch that emits `kind: 'hue-saturation'` entry |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Import `HueSaturationPanel`; add `case 'hue-saturation'` to the `adjustmentType` switch |

---

## Implementation Steps

1. **`src/types/index.ts`** — Add `hasMask: boolean` to `HueSaturationAdjustmentLayer` (mirrors the same field on `BrightnessContrastAdjustmentLayer`).

2. **`src/webgl/shaders.ts`** — Append `HS_FRAG` export constant at the bottom of the file, after the existing `BLIT_FRAG` export. No new vertex shader constant is needed — `BC_VERT` is reused.

3. **`src/webgl/WebGLRenderer.ts`** (three sub-steps):
   a. Import `HS_FRAG` from `./shaders`.
   b. Extend `AdjustmentRenderOp` to add the `hue-saturation` variant.
   c. Add `private readonly hsProgram: WebGLProgram` field and compile it in the constructor (after `bcProgram`). Add `gl.deleteProgram(this.hsProgram)` to `destroy()`.
   d. Add `applyHueSaturationPass` method.
   e. Extend the `renderPlan` / `readFlattenedPlan` inner loop with the `hue-saturation` case.

4. **`src/hooks/useCanvas.ts`** — In the function that builds `RenderPlanEntry[]` from `state.layers`, add the `hue-saturation` branch alongside the existing `brightness-contrast` branch.

5. **`src/components/panels/AdjustmentPanel/HueSaturationPanel.tsx`** — Create the three-slider panel component per the spec above.

6. **`src/components/panels/AdjustmentPanel/HueSaturationPanel.module.scss`** — Create scoped styles. Can be a near-copy of `BrightnessContrastPanel.module.scss` since the layout is structurally identical (header + three rows instead of two + footer reset button).

7. **`src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`** — Import `HueSaturationPanel`; add `case 'hue-saturation': return <HueSaturationPanel layer={layer} />` to the switch.

---

## Architectural Constraints

- **No new actions needed.** `UPDATE_ADJUSTMENT_LAYER` is already generic (accepts any `AdjustmentLayerState`). The reducer simply replaces the matching layer record by ID.
- **No new hooks needed.** `useAdjustments` is already adjustment-type-agnostic; the selection-mask registration path functions identically for hue-saturation.
- **`HueSaturationPanel` is a sub-component, not a panel in its own folder.** It lives inside `AdjustmentPanel/` and is not exported from `src/components/index.ts`. Only `AdjustmentPanel` is exported.
- **Vertex shader reuse.** `hsProgram` is linked using `BC_VERT` (already exported). Keeping the full-screen post-process vertex shader logic in one place is acceptable without introducing a shared abstraction — there are exactly two consumers at this point.
- **Straight-alpha invariant.** The WebGL context was created with `premultipliedAlpha: false`. The HS shader reads and writes straight RGBA and must not premultiply or un-premultiply; this matches the rest of the pipeline.
- **Ping-pong swap must mirror BC.** The entire correctness of multi-adjustment compositing depends on consistent ping-pong buffer management. Every adjustment op that writes to `dstFb` must swap `[srcFb, dstFb]` and `[srcTex, dstTex]` afterward. The invisible-layer early-continue must skip the swap as well as the draw call.
- **`destroy()` must be complete.** Leaking `hsProgram` would hold a GPU resource permanently. Always add new programs to `destroy()` in the same commit that adds their constructor initialization.

---

## Open Questions

1. **Achromatic pixel behavior at positive saturation.** With $S_{in} = 0$ and $H_{in} = 0$ (the undefined-hue fallback for $R = G = B$ pixels), a saturation boost produces a reddish tint as H=0 maps to the red sector. This is Photoshop-compatible. If the team wants neutral-gray pixels to remain neutral regardless of saturation, the shader would need a special case: `if (hsl.y < 0.00001 && u_saturation > 0.0) { skip hue rotation; keep hsl.y = 0.0; }`. **Decision needed** before implementation; current design uses Photoshop-compatible behavior.

2. **mediump precision and round-trip accuracy.** The RGB→HSL→RGB round-trip at mediump (≈6.5 decimal digits) introduces small rounding errors. For pixel art (integer-sourced 8-bit pixels), rounding stays well below 1 ULP of the 8-bit output range. For photographic images with smooth gradients, faint banding may be visible at near-identity slider values. If this is reported, change `precision mediump float` to `precision highp float` in `HS_FRAG` (no other change required).

3. **Floating panel anchor (shared with BC).** The spec says the panel is anchored to the upper-right corner of the canvas. With the canvas potentially panned within the viewport, the panel must read the canvas container's `getBoundingClientRect()` to position correctly. This is a shared concern with `BrightnessContrastPanel` and should be resolved in `AdjustmentPanel.tsx` for all sub-panels at once.

4. **Merge operations with adjustment children (shared with BC).** What happens when "Merge Down" or "Flatten Image" is run on a pixel layer that has hue-saturation children? Options: (a) rasterize the adjustment into the merged result using `readFlattenedPlan`, (b) silently drop adjustment children, (c) block the merge. Must be resolved before implementing merge operations.

5. **Multiple stacked HS adjustments on the same parent.** The spec allows this. The render plan will emit one `kind: 'hue-saturation'` entry per child adjustment layer, applied sequentially in layer-stack order. The second pass receives the output of the first as `srcTex`. This is automatically correct with the existing ping-pong design — confirm with a test case (e.g. Hue +60 followed by Hue +60 should equal a single Hue +120 adjustment).
