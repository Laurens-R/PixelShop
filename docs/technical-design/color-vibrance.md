# Technical Design: Color Vibrance

## Overview

The Color Vibrance adjustment is a non-destructive child layer that applies two complementary saturation controls — a non-linear **Vibrance** boost and a uniform **Saturation** shift — on a parent pixel layer at render time, never modifying the parent's pixel data. When the user triggers **Image → Color Vibrance…**, a `ColorVibranceAdjustmentLayer` record is inserted into `state.layers` immediately after the active pixel layer (same positional contract as mask, brightness-contrast, and hue-saturation adjustment layers), `openAdjustmentLayerId` is set to the new layer's ID, and `AdjustmentPanel` opens showing `ColorVibrancePanel`. Slider changes dispatch `UPDATE_ADJUSTMENT_LAYER` updates; on every such update `useCanvas` re-runs its render via the WebGL compositing pipeline, which includes a new GPU-side vibrance pass applied inline in the ping-pong loop. No WASM is needed — all math is GLSL. One undo entry is recorded when the panel closes.

This design builds directly on the infrastructure established by `adjustment-menu.md`, `brightness-contrast.md`, and `hue-saturation.md`. Anything defined in those documents (type system, `AdjustmentPanel` shell, `useAdjustments`, `renderPlan` / `readFlattenedPlan` methods, `UPDATE_ADJUSTMENT_LAYER` action, `adjustmentMaskMap` ref, `BC_VERT` vertex shader, RGB ↔ HSL GLSL helpers) is **already in place** — this document only specifies what is new or extended.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `hasMask: boolean` to `ColorVibranceAdjustmentLayer` |
| `src/webgl/shaders.ts` | Add `VIB_FRAG` constant; vertex stage reuses existing `BC_VERT` |
| `src/webgl/WebGLRenderer.ts` | Extend `AdjustmentRenderOp` union; add `vibProgram`; add `applyColorVibrancePass`; extend `renderPlan` / `readFlattenedPlan` loop; extend `destroy()` |
| `src/hooks/useCanvas.ts` | Extend render-plan builder to emit `kind: 'color-vibrance'` entries |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `case 'color-vibrance'` to adjustment-type switch |
| `src/components/panels/AdjustmentPanel/ColorVibrancePanel.tsx` | **New file.** Two-slider sub-panel UI (Vibrance, Saturation) |
| `src/components/panels/AdjustmentPanel/ColorVibrancePanel.module.scss` | **New file.** Scoped styles |

No changes are required to `src/store/AppContext.tsx`, `src/hooks/useAdjustments.ts`, or `src/App.tsx` — the `UPDATE_ADJUSTMENT_LAYER` action, selection-mask registration flow, and `AdjustmentPanel` shell are fully generic and require no modification.

---

## State Changes

### Extend `ColorVibranceAdjustmentLayer` in `src/types/index.ts`

The adjustment-menu design defined:

```ts
export interface ColorVibranceAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'color-vibrance'
  params: AdjustmentParamsMap['color-vibrance']  // { vibrance: number; saturation: number }
}
```

Add one field:

```ts
export interface ColorVibranceAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'color-vibrance'
  params: AdjustmentParamsMap['color-vibrance']
  /** True when a selection was active at creation time; the baked mask pixels
   *  live in useCanvas.adjustmentMaskMap (not in React state). */
  hasMask: boolean
}
```

This mirrors the identical `hasMask` addition on `BrightnessContrastAdjustmentLayer` and `HueSaturationAdjustmentLayer`, and keeps pixel data out of React state for the same reasons.

No other type changes are needed — the `UPDATE_ADJUSTMENT_LAYER` action union and reducer are already generic and accept any `AdjustmentLayerState`.

---

## Pixel Math

**No WASM function is required.** The RGB ↔ HSL conversion and all vibrance/saturation math run entirely on the GPU via a new GLSL program.

### Algorithm

The adjustment is a two-step transform applied per-pixel in HSL color space. Hue and lightness are never touched.

**Step 1 — Vibrance (non-linear saturation):**

$$
w = (1 - S_{in}) \cdot \left|\frac{u\_vibrance}{100}\right| \cdot \mathbf{1}_{S_{in} > \epsilon}
$$

$$
S' = \operatorname{clamp}\!\left(S_{in} + w \cdot \operatorname{sign}(u\_vibrance),\; 0,\; 1\right)
$$

The indicator $\mathbf{1}_{S_{in} > \epsilon}$ (implemented as `step(0.0001, S)` in GLSL) zeroes the weight for achromatic pixels ($S \approx 0$), ensuring they are unaffected at any Vibrance value. This is the **achromatic guard** — see Open Questions §1 for discussion.

The weight $w$ is maximised for low-$S$ (muted) pixels and approaches 0 as $S \to 1$ (vivid pixels), which is the defining property of Vibrance. Fully saturated pixels ($S = 1$) have $w = 0$ — they are never pushed beyond $S = 1$.

**Step 2 — Saturation (uniform linear):**

$$
S_{out} = \operatorname{clamp}\!\left(S' + \frac{u\_saturation}{100},\; 0,\; 1\right)
$$

The saturation shift is applied on top of the already-vibrance-adjusted $S'$. It is linear and unweighted, identical in design to the Saturation slider in `HueSaturationPanel`.

**Boundary checks:**

| Condition | Expected result |
|---|---|
| `u_vibrance = 0`, `u_saturation = 0` | $w = 0$, no shift → identity ✓ |
| `u_vibrance = +100`, $S = 0$ (achromatic, guard active) | `step(0.0001, 0.0) = 0.0` → $w = 0$ → $S' = 0$ → no tint ✓ |
| `u_vibrance = +100`, $S = 0.01$ (barely chromatic) | $w \approx 0.99 \cdot 1.0 = 0.99$ → $S' = \operatorname{clamp}(1.0, 0, 1) = 1.0$ ✓ |
| `u_vibrance = +100`, $S = 0.9$ (vivid) | $w = 0.1 \cdot 1.0 = 0.1$ → $S' = \operatorname{clamp}(1.0, 0, 1) = 1.0$ (smaller boost) ✓ |
| `u_vibrance = +100`, $S = 1.0$ (fully saturated) | $w = 0$ → $S' = 1.0$ → no change ✓ |
| `u_vibrance = -100`, $S = 0.1` | $w = 0.9 \cdot 1.0 = 0.9$ → $S' = \operatorname{clamp}(-0.8, 0, 1) = 0.0$ (large muted reduction) ✓ |
| `u_vibrance = -100`, $S = 0.9` | $w = 0.1 \cdot 1.0 = 0.1$ → $S' = \operatorname{clamp}(0.8, 0, 1) = 0.8$ (small vivid reduction) ✓ |
| `u_saturation = +100` | $S_{out} = \operatorname{clamp}(S' + 1.0, 0, 1)$ → pushes toward full saturation ✓ |
| `u_saturation = -100` | $S_{out} = \operatorname{clamp}(S' - 1.0, 0, 1) = 0$ → fully desaturated ✓ |
| $\alpha = 0$ | shader returns `src` unchanged (early exit) ✓ |
| Luminance | Only `hsl.y` is modified; `hsl.x` (hue) and `hsl.z` (lightness) are never written ✓ |

### New GLSL — `VIB_FRAG` in `src/webgl/shaders.ts`

The vertex stage is identical to `BC_VERT` — a full-screen post-process quad that computes `v_texCoord` from `a_position / u_resolution`. Add only the fragment shader constant.

The RGB ↔ HSL helpers are copied verbatim from `HS_FRAG`. Both must remain identical; if either is ever changed for precision, the other must be updated in the same commit (see Architectural Constraints).

```ts
export const VIB_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;         // accumulated composite (straight RGBA)
  uniform float u_vibrance;        // −100 … +100
  uniform float u_saturation;      // −100 … +100
  uniform sampler2D u_selMask;     // baked selection mask (R = alpha, full-canvas)
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  // ── RGB ↔ HSL helpers (identical to HS_FRAG) ─────────────────────────────

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

    // 2. Vibrance: non-linear saturation boost/cut
    //    Weight is proportional to how muted the pixel is.
    //    step() gates the effect to chromatic pixels only (achromatic: S ≈ 0).
    float vib = u_vibrance / 100.0;
    float w   = (1.0 - hsl.y) * abs(vib) * step(0.0001, hsl.y);
    hsl.y = clamp(hsl.y + w * sign(vib), 0.0, 1.0);

    // 3. Saturation: uniform linear shift applied on top of vibrance result
    hsl.y = clamp(hsl.y + u_saturation / 100.0, 0.0, 1.0);

    // 4. Convert back to RGB
    vec4 adjusted = vec4(hsl2rgb(hsl), src.a);

    // 5. Selection mask blend (0 = unaffected, 1 = fully adjusted)
    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor = mix(src, adjusted, mask);
  }
` as const
```

**Straight-alpha note:** The WebGL context uses `premultipliedAlpha: false`; all FBO textures store straight RGBA. The shader reads and writes straight RGBA and must not premultiply or un-premultiply. This matches `BC_FRAG` and `HS_FRAG` exactly.

**`sign(0.0)` note:** GLSL defines `sign(0.0) = 0.0`, so at `u_vibrance = 0`, `w * sign(vib) = w * 0.0 = 0.0` and the S channel is unchanged regardless of its current value. ✓

---

## WebGL Renderer Changes (`src/webgl/WebGLRenderer.ts`)

### Extend `AdjustmentRenderOp` export

The HS design established:

```ts
export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number;           visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'hue-saturation';      hue: number; saturation: number; lightness: number; visible: boolean; selMaskLayer?: WebGLLayer }
```

Extend the union with the new variant:

```ts
export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number;               visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'hue-saturation';      hue: number; saturation: number; lightness: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-vibrance';      vibrance: number; saturation: number;               visible: boolean; selMaskLayer?: WebGLLayer }
```

`RenderPlanEntry` is unchanged — it already accepts any `AdjustmentRenderOp` via the union.

### New private field

```ts
private readonly vibProgram: WebGLProgram
```

`vibProgram` is compiled and linked in the constructor, immediately after `hsProgram`:

```ts
// In constructor, after hsProgram is initialized:
this.vibProgram = linkProgram(
  gl,
  compileShader(gl, gl.VERTEX_SHADER,   BC_VERT),   // full-screen quad — identical to BC and HS
  compileShader(gl, gl.FRAGMENT_SHADER, VIB_FRAG)
)
```

Import `VIB_FRAG` from `./shaders` alongside the existing imports.

### New public method: `applyColorVibrancePass`

```ts
applyColorVibrancePass(
  srcTex:       WebGLTexture,
  dstFb:        WebGLFramebuffer,
  vibrance:     number,
  saturation:   number,
  selMaskLayer?: WebGLLayer
): void
```

Structure is identical to `applyHueSaturationPass` — full-screen quad draw from `srcTex` into `dstFb`:

```ts
applyColorVibrancePass(srcTex, dstFb, vibrance, saturation, selMaskLayer) {
  const { gl } = this
  const w = this.pixelWidth, h = this.pixelHeight

  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFb)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)

  gl.useProgram(this.vibProgram)
  gl.uniform2f(gl.getUniformLocation(this.vibProgram, 'u_resolution'), w, h)
  gl.uniform1f(gl.getUniformLocation(this.vibProgram, 'u_vibrance'),   vibrance)
  gl.uniform1f(gl.getUniformLocation(this.vibProgram, 'u_saturation'), saturation)

  const posLoc = gl.getAttribLocation(this.vibProgram, 'a_position')
  gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
  fillRectBuffer(gl, 0, 0, w, h)
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, srcTex)
  gl.uniform1i(gl.getUniformLocation(this.vibProgram, 'u_src'), 0)

  if (selMaskLayer) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, selMaskLayer.texture)
    gl.uniform1i(gl.getUniformLocation(this.vibProgram, 'u_selMask'),    1)
    gl.uniform1i(gl.getUniformLocation(this.vibProgram, 'u_hasSelMask'), 1)
  } else {
    gl.uniform1i(gl.getUniformLocation(this.vibProgram, 'u_hasSelMask'), 0)
  }

  gl.drawArrays(gl.TRIANGLES, 0, 6)
}
```

### Extend `renderPlan` (and `readFlattenedPlan`) inner loop

In the `renderPlan` / `readFlattenedPlan` ping-pong loop, add the `color-vibrance` case immediately after the `hue-saturation` case:

```ts
} else if (entry.kind === 'color-vibrance') {
  if (!entry.visible) continue
  this.applyColorVibrancePass(
    srcTex, dstFb,
    entry.vibrance, entry.saturation,
    entry.selMaskLayer
  )
  ;[srcFb, dstFb] = [dstFb, srcFb]
  ;[srcTex, dstTex] = [dstTex, srcTex]
}
```

**Ping-pong swap:** the swap mirrors the `brightness-contrast` and `hue-saturation` cases exactly. An invisible color-vibrance layer (`visible: false`) is skipped entirely — no pass is executed and no swap occurs, leaving the ping-pong state unchanged.

### `destroy()` extension

Add `gl.deleteProgram(this.vibProgram)` to the `destroy()` method, alongside the existing `bcProgram` and `hsProgram` deletions.

---

## `ColorVibrancePanel` Component

**File:** `src/components/panels/AdjustmentPanel/ColorVibrancePanel.tsx`  
**Category:** panel sub-component (same folder as `AdjustmentPanel`; **not** re-exported from `src/components/index.ts` — only `AdjustmentPanel` is)  
**Single responsibility:** render the two-slider body of the floating Color Vibrance panel and dispatch param updates in real time.

### Props

```ts
interface ColorVibrancePanelProps {
  layer: ColorVibranceAdjustmentLayer
}
```

`onClose` is **not** a prop — `AdjustmentPanel` owns the close button and Escape handler, calling `props.onClose()` which triggers `useAdjustments.handleCloseAdjustmentPanel`.

### Internals

- Reads `dispatch` from `useContext(AppContext)`.
- Renders two `SliderInput` widget rows (the existing reusable widget), in this order:
  - **Vibrance** — `min={-100}` `max={100}` `default={0}` — label "Vibrance"
  - **Saturation** — `min={-100}` `max={100}` `default={0}` — label "Saturation"
- On every `onChange` (while dragging), dispatches:
  ```ts
  dispatch({
    type: 'UPDATE_ADJUSTMENT_LAYER',
    payload: { ...layer, params: { vibrance, saturation } }
  })
  ```
- Numeric inputs clamp to `[−100, 100]` on `onBlur` / Enter. Values supplied outside this range (e.g., typed 150) are clamped to 100 before dispatch; they are never stored in state unclamped.
- A **Reset** button in the panel footer dispatches `UPDATE_ADJUSTMENT_LAYER` with `params: { vibrance: 0, saturation: 0 }`.
- No local state: the panel is fully controlled — it reads `layer.params.vibrance` and `layer.params.saturation` for current values. Dispatching always goes through `AppContext`.

### Registration in `AdjustmentPanel.tsx`

In the `adjustmentType` switch inside `AdjustmentPanel.tsx`, add:

```tsx
case 'color-vibrance':
  return <ColorVibrancePanel layer={layer} />
```

---

## Rendering Pipeline — Data Flow

The full data flow from slider drag to on-screen pixel update:

1. **Slider `onChange`** dispatches `UPDATE_ADJUSTMENT_LAYER` with new `params.vibrance` / `params.saturation`.
2. React re-renders; `useReducer` produces a new `state.layers` containing the updated `ColorVibranceAdjustmentLayer`.
3. **`useCanvas` render effect** fires (it already watches `state.layers`). It builds the `RenderPlanEntry[]` from `state.layers`. For each entry:
   - `isPixelLayer(l)` → `{ kind: 'layer', layer: wglLayerMap.current.get(l.id), mask: maskMap.get(l.id) }`
   - `l.type === 'adjustment' && l.adjustmentType === 'brightness-contrast'` → BC op entry (existing)
   - `l.type === 'adjustment' && l.adjustmentType === 'hue-saturation'` → HS op entry (existing)
   - `l.type === 'adjustment' && l.adjustmentType === 'color-vibrance'` →
     ```ts
     {
       kind:         'color-vibrance',
       vibrance:     l.params.vibrance,
       saturation:   l.params.saturation,
       visible:      l.visible,
       selMaskLayer: adjustmentMaskMap.current.get(l.id),
     }
     ```
4. Calls `renderer.renderPlan(plan)`.
5. Inside `renderPlan`, the ping-pong loop encounters the `kind: 'color-vibrance'` entry (assuming `visible: true`) and calls `applyColorVibrancePass(srcTex, dstFb, vibrance, saturation, selMaskLayer)`, then swaps ping-pong buffers.
6. Canvas pixels update on screen.

**GPU work per slider tick:** one compositing pass per underlying pixel layer + one full-screen vibrance quad draw. No WASM, no debouncing. The entire path is synchronous GPU work within a single React render cycle.

---

## Selection Masking

The selection masking pattern is **identical to `brightness-contrast` and `hue-saturation`**. No new code is needed in `useAdjustments.ts` or `App.tsx` — the existing generic `handleCreateAdjustmentLayer` already:

1. Calls `getSelectionPixels()` to obtain the full-canvas selection `Uint8Array | null`.
2. Sets `hasMask = selPixels !== null` on the dispatched `ADD_ADJUSTMENT_LAYER` payload.
3. Calls `registerAdjMask(newLayerId, selPixels)` if a selection was active.

`registerAdjMask` in `useCanvas` creates a `WebGLLayer` at full canvas size, copies the selection alpha into the R channel, flushes it to GPU, and stores it in `adjustmentMaskMap.current`.

### In the GLSL pass

`VIB_FRAG` samples `u_selMask` at `v_texCoord` (full-canvas UV, identical coordinate space to `BC_FRAG` and `HS_FRAG`). The R channel drives the `mix()` blend weight:

```glsl
float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
fragColor = mix(src, adjusted, mask);
```

- `mask = 0` (outside selection) → `fragColor = src` (unaffected). ✓  
- `mask = 1` (inside selection) → `fragColor = adjusted`. ✓  
- Feathered selections produce smooth per-pixel blending automatically. ✓

### Cleanup

Orphaned `adjustmentMaskMap` entries for color-vibrance layers are handled by the same `useEffect` in `useCanvas` that already monitors `state.layers` for removed layers — it calls `renderer.destroyLayer(maskLayer)` for any adjustment layer ID that disappears from `state.layers` (direct deletion or cascade from parent deletion). No new cleanup code is required.

---

## New Files and Changed Files

### New files

| File | Purpose |
|---|---|
| `src/components/panels/AdjustmentPanel/ColorVibrancePanel.tsx` | Two-slider sub-panel UI (Vibrance, Saturation) |
| `src/components/panels/AdjustmentPanel/ColorVibrancePanel.module.scss` | Scoped styles (mirrors `HueSaturationPanel.module.scss` layout) |

### Changed files

| File | Summary of change |
|---|---|
| `src/types/index.ts` | Add `hasMask: boolean` to `ColorVibranceAdjustmentLayer` |
| `src/webgl/shaders.ts` | Add `VIB_FRAG` constant at the end of the file |
| `src/webgl/WebGLRenderer.ts` | Extend `AdjustmentRenderOp` union; add `vibProgram` field + constructor init + `destroy()` cleanup; add `applyColorVibrancePass`; extend `renderPlan` / `readFlattenedPlan` loop |
| `src/hooks/useCanvas.ts` | Extend render-plan builder: add `color-vibrance` branch that emits `kind: 'color-vibrance'` entry |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Import `ColorVibrancePanel`; add `case 'color-vibrance'` to the `adjustmentType` switch |

---

## Implementation Steps

1. **`src/types/index.ts`** — Add `hasMask: boolean` to `ColorVibranceAdjustmentLayer`. This is the only type change for this feature (the type system, including `'color-vibrance'` in `AdjustmentType`, `AdjustmentParamsMap`, and the `ColorVibranceAdjustmentLayer` interface, was established by the adjustment-menu design).

2. **`src/webgl/shaders.ts`** — Append `VIB_FRAG` export constant at the bottom of the file, after the existing `HS_FRAG` export. No new vertex shader constant is needed — `BC_VERT` is reused.

3. **`src/webgl/WebGLRenderer.ts`** (four sub-steps, to be done as one atomic commit):
   - a. Import `VIB_FRAG` from `./shaders` alongside the existing `BC_VERT`, `HS_FRAG` imports.
   - b. Extend `AdjustmentRenderOp` to add the `color-vibrance` variant.
   - c. Add `private readonly vibProgram: WebGLProgram` field; compile and link it in the constructor after `hsProgram`; add `gl.deleteProgram(this.vibProgram)` to `destroy()`.
   - d. Add `applyColorVibrancePass` method (two float uniforms: `u_vibrance`, `u_saturation`; otherwise identical structure to `applyHueSaturationPass`).
   - e. Extend the `renderPlan` / `readFlattenedPlan` inner loop with the `color-vibrance` case, including the ping-pong buffer swap.

4. **`src/hooks/useCanvas.ts`** — In the function that builds `RenderPlanEntry[]` from `state.layers`, add the `color-vibrance` branch alongside the existing `brightness-contrast` and `hue-saturation` branches.

5. **`src/components/panels/AdjustmentPanel/ColorVibrancePanel.tsx`** — Implement the two-slider panel. Use the existing `SliderInput` widget for both rows. Dispatch `UPDATE_ADJUSTMENT_LAYER` on every `onChange`. Include a Reset button in the footer that sets both params to 0.

6. **`src/components/panels/AdjustmentPanel/ColorVibrancePanel.module.scss`** — Add panel-specific layout styles. Can be a near-copy of `HueSaturationPanel.module.scss` (structurally identical: header + two rows + footer reset button instead of three rows).

7. **`src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`** — Import `ColorVibrancePanel`; add `case 'color-vibrance': return <ColorVibrancePanel layer={layer} />` to the switch.

---

## Architectural Constraints

- **No WASM for vibrance.** The algorithm is a per-pixel HSL-space computation — two uniform evaluations plus two channel clamps. This is well within GPU throughput and trivial in GLSL. The WASM boundary is for CPU-intensive operations (flood fill, resize, quantization), not simple per-pixel math.
- **RGB ↔ HSL helpers must stay in sync with `HS_FRAG`.** `VIB_FRAG` copies the `rgb2hsl` and `hsl2rgb` helper functions verbatim from `HS_FRAG`. There is no runtime sharing of GLSL code between programs — the duplication is intentional (GLSL has no `#include`). If precision fixes or edge-case corrections are ever applied to the helpers in one shader, they must be applied to the other in the same commit. This constraint should be documented with an inline comment in both shader strings.
- **`WebGLRenderer` remains pixel-layer agnostic.** `AdjustmentRenderOp` is a structural type local to `WebGLRenderer.ts` and is not imported from `src/types`. The translation from `LayerState[]` to `RenderPlanEntry[]` lives entirely in `useCanvas.ts`.
- **Mask pixel data stays out of React state.** The selection mask lives in `adjustmentMaskMap` (a `useRef` in `useCanvas`) and is referenced only by the `hasMask: boolean` flag in React state. This was established by the B/C design and is unchanged here.
- **`ColorVibrancePanel` is not exported from `src/components/index.ts`.** It is an internal sub-component of `AdjustmentPanel`. Only `AdjustmentPanel` is barrel-exported.
- **Undo is captured on close, not on slider drag.** Each `onChange` dispatches `UPDATE_ADJUSTMENT_LAYER` for live preview but does **not** call `captureHistory`. History is captured once in `handleCloseAdjustmentPanel`. This matches the spec and the existing undo contract shared by all adjustment panels.
- **`destroy()` must be complete.** Leaking `vibProgram` would hold a GPU resource permanently. The `vibProgram` initialization and its `gl.deleteProgram` cleanup must be added in the same commit.
- **Ping-pong invariant.** Only ops that write to `dstFb` swap the buffers. The `visible: false` early-continue must skip both the draw call and the swap, exactly as in the BC and HS implementations. Violating this corrupts the compositing order of all subsequent entries in the plan.

---

## Open Questions

### 1. Achromatic guard on the Vibrance slider

The GLSL implementation uses `step(0.0001, hsl.y)` to zero the vibrance weight for achromatic pixels ($S \approx 0$). This is required because the formula $w = (1 - S) \cdot |V/100|$ is maximised — not zeroed — at $S = 0$, which would produce a reddish tint (via HSL→RGB with $H = 0$, $S > 0$) on neutral grey pixels. The guard prevents this and satisfies the spec acceptance criterion.

The threshold `0.0001` matches the epsilon used in `rgb2hsl`'s `delta > 0.00001` check. If the epsilon in `rgb2hsl` is ever tightened or loosened, the guard threshold should be re-evaluated accordingly (they do not need to match, but should be within the same order of magnitude).

### 2. Achromatic behaviour of the Saturation slider

The uniform Saturation slider in this panel applies its shift without a guard, identical to the Saturation slider in `HueSaturationPanel`. Applying Saturation = +100 on a near-achromatic pixel ($S \approx 0$, $H = 0$) will produce a reddish tint — the same Photoshop-compatible behaviour documented in the HS design.

The spec acceptance criterion for the Saturation slider ("Setting Saturation to +100 causes a uniform increase in saturation across all non-achromatic pixels") could be read as implying that truly achromatic pixels should also be guarded. If the product decision is to guard the Saturation slider as well (protecting achromatic pixels from any colour introduction), a second `step(0.0001, hsl.y)` term can be inserted before Step 3 in `VIB_FRAG` — it requires only a single line change. **Awaiting product clarification:** should the Saturation slider in the Color Vibrance panel match the HS panel behaviour (no guard), or should it also protect achromatic pixels?

### 3. Application order: Vibrance before Saturation

The design applies Vibrance first, then Saturation on top of the vibrance-adjusted S value. This means the Saturation slider can increase the S of a pixel that was already promoted toward 1.0 by Vibrance, potentially pushing it to full saturation sooner. The alternative (Saturation first, then Vibrance) would give priority to the uniform shift and let Vibrance only act on the post-saturation result.

The Vibrance-first order is consistent with how Lightroom and Camera Raw order these two controls when combining Vibrance + Saturation. **If the Product specification intends Saturation-first**, the order of GLSL steps 2 and 3 in `VIB_FRAG` can be swapped with no architectural impact.

### 4. No skin-tone hue protection

Lightroom's Vibrance implementation also includes a hue-specific protection factor that further limits the boost on pixels in the orange-to-pink hue range (skin tones). The spec does not mention this, so it is not implemented. It could be added later as a uniform `u_skinToneProtection` weight applied per hue sector inside the vibrance step, without changing the overall shader structure.
