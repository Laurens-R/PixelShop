# Technical Design: Color Temperature

## Overview

The Color Temperature adjustment is a non-destructive child layer that shifts the warmth (blue–orange axis) and tint (green–magenta axis) of a parent pixel layer using a simple additive RGB bias applied entirely on the GPU. When the user triggers **Image → Color Temperature…**, a `ColorTemperatureAdjustmentLayer` record is inserted into `state.layers` immediately after the active pixel layer (same positional contract as all prior adjustment layers), `openAdjustmentLayerId` is set to the new layer's ID, and `AdjustmentPanel` opens showing `TemperaturePanel`. Slider changes dispatch `UPDATE_ADJUSTMENT_LAYER` updates; on every update `useCanvas` re-runs its render via the WebGL compositing pipeline, which now includes a GPU-side temperature pass applied inline in the ping-pong loop. No HSL conversion or WASM is needed — all math is a direct per-channel linear bias. One undo entry is recorded when the panel closes.

This design builds directly on the infrastructure established by `adjustment-menu.md`, `brightness-contrast.md`, `hue-saturation.md`, `color-vibrance.md`, `color-balance.md`, and `black-and-white.md`. Anything defined in those documents (type system, `AdjustmentPanel` shell, `useAdjustments`, `renderPlan` / `readFlattenedPlan` methods, `UPDATE_ADJUSTMENT_LAYER` action, `adjustmentMaskMap` ref, `BC_VERT` vertex shader) is **already in place** — this document only specifies what is new or extended.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'color-temperature'` to `AdjustmentType`; add `'color-temperature'` entry to `AdjustmentParamsMap`; add `ColorTemperatureAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Add `'color-temperature'` entry to `ADJUSTMENT_REGISTRY` |
| `src/webgl/shaders.ts` | Add `TEMP_FRAG` constant; vertex stage reuses existing `BC_VERT` |
| `src/webgl/WebGLRenderer.ts` | Extend `AdjustmentRenderOp` union; add `tempProgram`; add `applyColorTemperaturePass`; extend `renderPlan` / `readFlattenedPlan` loop; extend `destroy()` |
| `src/hooks/useCanvas.ts` | Extend render-plan builder to emit `kind: 'color-temperature'` entries |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `case 'color-temperature'` to adjustment-type switch |
| `src/components/panels/AdjustmentPanel/TemperaturePanel.tsx` | **New file.** Two-slider sub-panel UI |
| `src/components/panels/AdjustmentPanel/TemperaturePanel.module.scss` | **New file.** Scoped styles |

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
  | 'color-temperature'   // ← new
```

#### Extend `AdjustmentParamsMap`

```ts
export interface AdjustmentParamsMap {
  // …existing entries…
  'color-temperature': {
    temperature: number   // −100 … +100, default 0
    tint:        number   // −100 … +100, default 0
  }
}
```

Both values default to 0 (no-op). Negative temperature cools (blue shift); positive warms (orange/yellow shift). Negative tint pushes toward green; positive tint pushes toward magenta.

#### New layer interface

```ts
export interface ColorTemperatureAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'color-temperature'
  params: AdjustmentParamsMap['color-temperature']
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
  | ColorTemperatureAdjustmentLayer   // ← new
```

---

## Pixel Math

**No WASM function is required.** All math runs entirely on the GPU via a new GLSL program. No HSL conversion is needed — the color temperature model operates directly in RGB space as a per-channel additive bias.

### Algorithm

The adjustment applies a combined linear RGB shift derived from the two orthogonal axes:

**Temperature axis** (blue–orange):

$$
\Delta R_{\text{temp}} = \frac{t}{100} \times 0.2 \qquad \Delta G_{\text{temp}} = 0 \qquad \Delta B_{\text{temp}} = -\frac{t}{100} \times 0.2
$$

where $t$ = `u_temperature` ∈ [−100, +100]. Positive $t$ warms (boosts R, reduces B); negative $t$ cools (reduces R, boosts B).

**Tint axis** (green–magenta):

$$
\Delta R_{\text{tint}} = \frac{n}{100} \times 0.1 \qquad \Delta G_{\text{tint}} = -\frac{n}{100} \times 0.2 \qquad \Delta B_{\text{tint}} = \frac{n}{100} \times 0.1
$$

where $n$ = `u_tint` ∈ [−100, +100]. Positive $n$ pushes magenta (boosts R+B, reduces G); negative $n$ pushes green (boosts G, reduces R+B).

**Combined deltas:**

$$
\Delta R = \frac{t}{100} \times 0.2 + \frac{n}{100} \times 0.1
$$

$$
\Delta G = -\frac{n}{100} \times 0.2
$$

$$
\Delta B = -\frac{t}{100} \times 0.2 + \frac{n}{100} \times 0.1
$$

**Output:**

$$
(R', G', B') = \operatorname{clamp}((R + \Delta R,\; G + \Delta G,\; B + \Delta B),\; 0,\; 1)
$$

**Boundary checks:**

| Condition | Expected result |
|---|---|
| temperature=0, tint=0 | ΔR=ΔG=ΔB=0 → identity ✓ |
| temperature=+100, tint=0 | ΔR=+0.2, ΔG=0, ΔB=−0.2 → warm/orange cast ✓ |
| temperature=−100, tint=0 | ΔR=−0.2, ΔG=0, ΔB=+0.2 → cool/blue cast ✓ |
| temperature=0, tint=+100 | ΔR=+0.1, ΔG=−0.2, ΔB=+0.1 → magenta cast ✓ |
| temperature=0, tint=−100 | ΔR=−0.1, ΔG=+0.2, ΔB=−0.1 → green cast ✓ |
| temperature=+100, tint=+100 | ΔR=+0.3, ΔG=−0.2, ΔB=−0.1 → warm-magenta ✓ |
| temperature=−100, tint=−100 | ΔR=−0.3, ΔG=+0.2, ΔB=+0.1 → cool-green ✓ |
| Any channel overflows | clamped to [0, 1] ✓ |
| α = 0 | Early exit, pixel unchanged ✓ |
| Achromatic pixel (R=G=B) | Color cast applies; neutral grays pick up a color tint ✓ (spec-required) |

**Orthogonality note:** The temperature and tint axes are designed to be orthogonal in their primary effect: temperature shifts R and B by equal-and-opposite amounts (preserving G), and tint shifts G with a smaller equal boost to R and B. The R and B components of the tint (±0.1) exist to bias R+B symmetrically so the tint axis targets the magenta–green axis believably; without them the tint would be a pure green–no-green axis rather than green–magenta.

**Straight-alpha note:** The WebGL context uses `premultipliedAlpha: false`; all FBO textures store straight RGBA. The shader operates on straight RGB directly — no pre/de-multiply step needed. Identical to `BC_FRAG` and all prior adjustment shaders.

### New GLSL — `TEMP_FRAG` in `src/webgl/shaders.ts`

The vertex stage is identical to `BC_VERT` (full-screen post-process quad). Add only the fragment shader constant after `BW_FRAG`:

```ts
export const TEMP_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;
  uniform float u_temperature;   // −100 … +100
  uniform float u_tint;          // −100 … +100
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  void main() {
    vec4 src = texture(u_src, v_texCoord);

    // Preserve fully-transparent pixels
    if (src.a < 0.0001) { fragColor = src; return; }

    float t = u_temperature / 100.0;
    float n = u_tint         / 100.0;

    // Temperature axis: warm (positive) boosts R, reduces B.
    // Tint axis: positive → magenta (boosts R+B equally, reduces G).
    float dR = t * 0.2 + n * 0.1;
    float dG = -n * 0.2;
    float dB = -t * 0.2 + n * 0.1;

    vec3 adjusted = clamp(src.rgb + vec3(dR, dG, dB), 0.0, 1.0);
    vec4 result   = vec4(adjusted, src.a);

    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor   = mix(src, result, mask);
  }
` as const
```

---

## WebGL Renderer Changes (`src/webgl/WebGLRenderer.ts`)

### Extend `AdjustmentRenderOp`

Add the new variant to the existing union:

```ts
export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-vibrance'; vibrance: number; saturation: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-balance'; params: ColorBalancePassParams; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'black-and-white'; params: BlackAndWhitePassParams; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-temperature'; temperature: number; tint: number; visible: boolean; selMaskLayer?: WebGLLayer }  // ← new
```

`RenderPlanEntry` is unchanged — it already accepts any `AdjustmentRenderOp` via the union.

### New private field

```ts
private readonly tempProgram: WebGLProgram
```

Import `TEMP_FRAG` from `./shaders` alongside the existing imports. Compile and link in the constructor after `this.bwProgram`:

```ts
this.tempProgram = linkProgram(
  gl,
  compileShader(gl, gl.VERTEX_SHADER,   BC_VERT),
  compileShader(gl, gl.FRAGMENT_SHADER, TEMP_FRAG)
)
```

### New public method: `applyColorTemperaturePass`

```ts
applyColorTemperaturePass(
  srcTex:       WebGLTexture,
  dstFb:        WebGLFramebuffer,
  temperature:  number,
  tint:         number,
  selMaskLayer?: WebGLLayer
): void {
  const { gl } = this
  const w = this.pixelWidth, h = this.pixelHeight

  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFb)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)

  gl.useProgram(this.tempProgram)
  gl.uniform2f(gl.getUniformLocation(this.tempProgram, 'u_resolution'), w, h)
  gl.uniform1f(gl.getUniformLocation(this.tempProgram, 'u_temperature'), temperature)
  gl.uniform1f(gl.getUniformLocation(this.tempProgram, 'u_tint'),        tint)

  const posLoc = gl.getAttribLocation(this.tempProgram, 'a_position')
  gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
  fillRectBuffer(gl, 0, 0, w, h)
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, srcTex)
  gl.uniform1i(gl.getUniformLocation(this.tempProgram, 'u_src'), 0)

  if (selMaskLayer) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, selMaskLayer.texture)
    gl.uniform1i(gl.getUniformLocation(this.tempProgram, 'u_selMask'), 1)
    gl.uniform1i(gl.getUniformLocation(this.tempProgram, 'u_hasSelMask'), 1)
  } else {
    gl.uniform1i(gl.getUniformLocation(this.tempProgram, 'u_hasSelMask'), 0)
  }

  gl.drawArrays(gl.TRIANGLES, 0, 6)
}
```

### Extend `renderPlan` (and `readFlattenedPlan`) inner loop

Add the `color-temperature` case immediately after the `black-and-white` case:

```ts
} else if (entry.kind === 'color-temperature') {
  if (!entry.visible) continue
  this.applyColorTemperaturePass(srcTex, dstFb, entry.temperature, entry.tint, entry.selMaskLayer)
  ;[srcFb, dstFb] = [dstFb, srcFb]
  ;[srcTex, dstTex] = [dstTex, srcTex]
}
```

**Ping-pong swap mirrors all prior adjustment cases.** An invisible color-temperature layer is skipped with no buffer swap — the `continue` statement above the swap handles this.

**Note:** The swap must be placed after the `if (!entry.visible) continue` guard (outside it), **except** the existing implementation places the ping-pong swap unconditionally after each branch. Check the existing loop structure and replicate the identical swap pattern.

### `destroy()` extension

Add `gl.deleteProgram(this.tempProgram)` alongside the existing `deleteProgram` calls.

---

## `useCanvas.ts` Render Plan Builder

Add the `color-temperature` branch after the `black-and-white` branch:

```ts
} else if (l.type === 'adjustment' && l.adjustmentType === 'color-temperature') {
  plan.push({
    kind:         'color-temperature',
    temperature:  l.params.temperature,
    tint:         l.params.tint,
    visible:      l.visible,
    selMaskLayer: adjustmentMaskMap.current.get(l.id),
  })
}
```

---

## `TemperaturePanel` Component

**File:** `src/components/panels/AdjustmentPanel/TemperaturePanel.tsx`  
**Category:** panel sub-component (same folder as `AdjustmentPanel`; **not** re-exported from `src/components/index.ts`)  
**Single responsibility:** render the two-slider body of the floating Color Temperature panel and dispatch param updates in real time.

### Props

```ts
interface TemperaturePanelProps {
  layer: ColorTemperatureAdjustmentLayer
}
```

No local state. Fully controlled.

### Internals

- Reads `dispatch` from `useContext(AppContext)`.
- Renders two `SliderInput` widget rows in spec order:
  - **Temperature** — `min={-100}` `max={100}` `default={0}`
  - **Tint** — `min={-100}` `max={100}` `default={0}`
- On every slider `onChange` (while dragging), dispatches:
  ```ts
  dispatch({
    type: 'UPDATE_ADJUSTMENT_LAYER',
    payload: { ...layer, params: { ...layer.params, [changedKey]: newValue } },
  })
  ```
  Where `changedKey` is `'temperature'` or `'tint'`.
- Numeric inputs clamp to `[−100, 100]` on `onBlur` / Enter before dispatch.
- All displayed values are read from `layer.params` (fully controlled).

### Registration in `AdjustmentPanel.tsx`

```tsx
case 'color-temperature':
  return <TemperaturePanel layer={layer as ColorTemperatureAdjustmentLayer} />
```

---

## Adjustment Registry Changes

### `src/adjustments/registry.ts`

Append an entry to `ADJUSTMENT_REGISTRY`:

```ts
{
  adjustmentType: 'color-temperature' as const,
  label: 'Color Temperature…',
  defaultParams: { temperature: 0, tint: 0 },
},
```

---

## Architectural Constraints

- **No business logic in `App.tsx`** — `useAdjustments` (already in place) handles layer creation and panel open/close. No new hooks are needed.
- **`WebGLRenderer.ts` must not import from `@/types`** — the `AdjustmentRenderOp` variant carries plain `number` fields (`temperature`, `tint`) so no local type alias is necessary.
- **`TemperaturePanel` is a panel sub-component**, not re-exported from `src/components/index.ts`.
- **CSS must use `.module.scss`** — `TemperaturePanel.module.scss` is the scoped stylesheet.
- **Straight RGBA** — no pre/de-multiply; context is `premultipliedAlpha: false`.

---

## Open Questions

1. **Slider gradient backgrounds** — Photoshop-style color-gradient track fills (cool→warm for Temperature, green→magenta for Tint) are not specified here. If desired, they would require extending the `SliderInput` widget with an optional `trackGradient` prop; defer to a future UX pass.
2. **Luminance preservation** — the current linear model slightly shifts perceived luminance at extreme values (e.g., temperature=+100 on a mid-gray adds 0.2 to R and subtracts 0.2 from B, net luminance change ≈ +0.2×0.2126 − 0.2×0.0722 ≈ +0.028 BT.709 units). This is intentional and matches the spec's requirement that the shift is additive. A `preserveLuminosity` toggle (as in Color Balance) is not in the spec and is not designed here.
