# Technical Design: Color Invert

## Overview

The Color Invert adjustment is a non-destructive child layer that replaces every RGB channel value in the parent pixel layer with its complement (`output = 1.0 − input` per channel in shader-normalized [0, 1] space; equivalent to `255 − value` in 8-bit). The alpha channel is left unchanged. The adjustment has no configurable parameters: the effect is fixed and immediate at layer creation. The floating panel is purely informational — it shows the parent layer name and a close affordance. When the user triggers **Image → Color Invert**, a `ColorInvertAdjustmentLayer` record is inserted into `state.layers` immediately after the active pixel layer (same positional contract as all prior adjustment layers), `openAdjustmentLayerId` is set to the new layer's ID, and `AdjustmentPanel` opens showing `InvertPanel`. No slider changes are possible; the panel dispatches no `UPDATE_ADJUSTMENT_LAYER` actions. One undo entry is recorded when the panel closes.

This design builds directly on the infrastructure established by `adjustment-menu.md`, `brightness-contrast.md`, `hue-saturation.md`, `color-vibrance.md`, `color-balance.md`, `black-and-white.md`, and `color-temperature.md`. Anything defined in those documents (type system, `AdjustmentPanel` shell, `useAdjustments`, `renderPlan` / `readFlattenedPlan` methods, `UPDATE_ADJUSTMENT_LAYER` action, `adjustmentMaskMap` ref, `BC_VERT` vertex shader) is **already in place** — this document only specifies what is new or extended.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'color-invert'` to `AdjustmentType`; add `'color-invert'` entry to `AdjustmentParamsMap`; add `ColorInvertAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Add `'color-invert'` entry to `ADJUSTMENT_REGISTRY` |
| `src/webgl/shaders.ts` | Add `INVERT_FRAG` constant; vertex stage reuses existing `BC_VERT` |
| `src/webgl/WebGLRenderer.ts` | Extend `AdjustmentRenderOp` union; add `invertProgram`; add `applyInvertPass`; extend `renderPlan` / `readFlattenedPlan` loop; extend `destroy()` |
| `src/hooks/useCanvas.ts` | Extend render-plan builder to emit `kind: 'color-invert'` entries |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `case 'color-invert'` to adjustment-type switch |
| `src/components/panels/AdjustmentPanel/InvertPanel.tsx` | **New file.** Read-only informational sub-panel |
| `src/components/panels/AdjustmentPanel/InvertPanel.module.scss` | **New file.** Scoped styles |

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
  | 'color-invert'        // ← new
```

#### Extend `AdjustmentParamsMap`

Color Invert has no configurable parameters. An empty params entry is still required so the type system remains consistent and the registry generic constraint `AdjustmentRegistrationEntry<T>` can resolve `AdjustmentParamsMap['color-invert']` without a special case:

```ts
export interface AdjustmentParamsMap {
  // …existing entries…
  'color-invert': Record<never, never>   // no configurable parameters
}
```

`Record<never, never>` is the canonical TypeScript empty-object type. `defaultParams: {}` in the registry satisfies this type.

#### New layer interface

```ts
export interface ColorInvertAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'color-invert'
  params: AdjustmentParamsMap['color-invert']
  /** True when a selection was active at creation time; the baked mask pixels
   *  live in useCanvas.adjustmentMaskMap (not in React state). */
  hasMask: boolean
}
```

The `params` field carries no values but is kept for structural consistency with all other adjustment layer types — it simplifies generic `UPDATE_ADJUSTMENT_LAYER` handling and future parameter additions.

#### Extend `AdjustmentLayerState`

```ts
export type AdjustmentLayerState =
  | BrightnessContrastAdjustmentLayer
  | HueSaturationAdjustmentLayer
  | ColorVibranceAdjustmentLayer
  | ColorBalanceAdjustmentLayer
  | BlackAndWhiteAdjustmentLayer
  | ColorTemperatureAdjustmentLayer
  | ColorInvertAdjustmentLayer   // ← new
```

---

## Pixel Math

**No WASM function is required.** The inversion is a trivially simple per-pixel operation with no parameters.

### Algorithm

$$
(R',\; G',\; B') = (1 - R,\; 1 - G,\; 1 - B) \qquad \alpha' = \alpha
$$

All three RGB channels are complemented; the alpha channel is unchanged. Channel values are already in [0, 1] in the shader; no clamping is required after inversion because $1 - x \in [0, 1]$ whenever $x \in [0, 1]$.

**Boundary checks:**

| Condition | Expected result |
|---|---|
| All sliders at defaults (no sliders) | Output = `1.0 − src.rgb` always ✓ |
| Pure white pixel (1, 1, 1, 1) | Output = (0, 0, 0, 1) — black ✓ |
| Pure black pixel (0, 0, 0, 1) | Output = (1, 1, 1, 1) — white ✓ |
| Mid-gray (0.5, 0.5, 0.5, 1) | Output = (0.5, 0.5, 0.5, 1) — identity for 50% gray ✓ |
| α = 0 (fully transparent) | Early exit, pixel unchanged; RGB channels are mathematically inverted but not visible ✓ |
| α = 0.5 (partial transparency) | RGB inverted, alpha stays 0.5 ✓ |
| Double-invert (two stacked Color Invert layers) | Second pass inverts back to original colors ✓ |
| Selection active at creation | Only pixels within baked selection mask are inverted ✓ |

### New GLSL — `INVERT_FRAG` in `src/webgl/shaders.ts`

The vertex stage is identical to `BC_VERT`. Add only the fragment shader constant after `TEMP_FRAG`:

```ts
export const INVERT_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  void main() {
    vec4 src = texture(u_src, v_texCoord);

    // Preserve fully-transparent pixels
    if (src.a < 0.0001) { fragColor = src; return; }

    // Invert R, G, B; leave alpha unchanged
    vec4 adjusted = vec4(1.0 - src.rgb, src.a);

    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor   = mix(src, adjusted, mask);
  }
` as const
```

**No `u_temperature`/`u_tint`-style param uniforms are present** because the operation has no parameters. The only uniforms beyond `u_src` are the standard selection-mask pair `u_selMask` / `u_hasSelMask` shared by all adjustment shaders.

**`vec4(1.0 - src.rgb, src.a)` in GLSL:** The expression `1.0 - src.rgb` is a valid component-wise scalar–vector subtraction that produces `vec3(1.0-r, 1.0-g, 1.0-b)`. The `vec4(…, src.a)` constructor then appends the unchanged alpha. This is idiomatic GLSL.

**Straight-alpha note:** The WebGL context uses `premultipliedAlpha: false`; all FBO textures store straight RGBA. The shader operates on straight RGB directly. If alpha were premultiplied, `1.0 - r` would yield an incorrect result for partially-transparent pixels; the straight-alpha storage avoids this entirely.

---

## WebGL Renderer Changes (`src/webgl/WebGLRenderer.ts`)

### Extend `AdjustmentRenderOp`

```ts
export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-vibrance'; vibrance: number; saturation: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-balance'; params: ColorBalancePassParams; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'black-and-white'; params: BlackAndWhitePassParams; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-temperature'; temperature: number; tint: number; visible: boolean; selMaskLayer?: WebGLLayer }
  | { kind: 'color-invert'; visible: boolean; selMaskLayer?: WebGLLayer }   // ← new — no params
```

The `color-invert` variant carries **no parameter fields** beyond `visible` and the optional `selMaskLayer`. This is intentional — it is the only adjustment op with no data payload.

`RenderPlanEntry` is unchanged.

### New private field

```ts
private readonly invertProgram: WebGLProgram
```

Import `INVERT_FRAG` from `./shaders` alongside the existing imports. Compile and link in the constructor after `this.tempProgram`:

```ts
this.invertProgram = linkProgram(
  gl,
  compileShader(gl, gl.VERTEX_SHADER,   BC_VERT),
  compileShader(gl, gl.FRAGMENT_SHADER, INVERT_FRAG)
)
```

### New public method: `applyInvertPass`

```ts
applyInvertPass(
  srcTex:       WebGLTexture,
  dstFb:        WebGLFramebuffer,
  selMaskLayer?: WebGLLayer
): void {
  const { gl } = this
  const w = this.pixelWidth, h = this.pixelHeight

  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFb)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)

  gl.useProgram(this.invertProgram)
  gl.uniform2f(gl.getUniformLocation(this.invertProgram, 'u_resolution'), w, h)

  const posLoc = gl.getAttribLocation(this.invertProgram, 'a_position')
  gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
  fillRectBuffer(gl, 0, 0, w, h)
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, srcTex)
  gl.uniform1i(gl.getUniformLocation(this.invertProgram, 'u_src'), 0)

  if (selMaskLayer) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, selMaskLayer.texture)
    gl.uniform1i(gl.getUniformLocation(this.invertProgram, 'u_selMask'), 1)
    gl.uniform1i(gl.getUniformLocation(this.invertProgram, 'u_hasSelMask'), 1)
  } else {
    gl.uniform1i(gl.getUniformLocation(this.invertProgram, 'u_hasSelMask'), 0)
  }

  gl.drawArrays(gl.TRIANGLES, 0, 6)
}
```

### Extend `renderPlan` (and `readFlattenedPlan`) inner loop

Add the `color-invert` case immediately after the `color-temperature` case:

```ts
} else if (entry.kind === 'color-invert') {
  if (!entry.visible) continue
  this.applyInvertPass(srcTex, dstFb, entry.selMaskLayer)
  ;[srcFb, dstFb] = [dstFb, srcFb]
  ;[srcTex, dstTex] = [dstTex, srcTex]
}
```

### `destroy()` extension

Add `gl.deleteProgram(this.invertProgram)` alongside the existing `deleteProgram` calls.

---

## `useCanvas.ts` Render Plan Builder

Add the `color-invert` branch after the `color-temperature` branch:

```ts
} else if (l.type === 'adjustment' && l.adjustmentType === 'color-invert') {
  plan.push({
    kind:         'color-invert',
    visible:      l.visible,
    selMaskLayer: adjustmentMaskMap.current.get(l.id),
  })
}
```

Note: no `params` are spread into the plan entry — the render op carries no data payload.

---

## `InvertPanel` Component

**File:** `src/components/panels/AdjustmentPanel/InvertPanel.tsx`  
**Category:** panel sub-component (same folder as `AdjustmentPanel`; **not** re-exported from `src/components/index.ts`)  
**Single responsibility:** render the informational body of the floating Color Invert panel. Contains no sliders or editable controls.

### Props

```ts
interface InvertPanelProps {
  layer: ColorInvertAdjustmentLayer
}
```

### Internals

- Reads `state` from `useContext(AppContext)` to resolve the parent layer name.
- Looks up the parent layer: `state.layers.find(l => l.id === layer.parentId)`.
- Renders a single read-only row:
  - Label: **"Parent layer"** (or similar static text)
  - Value: the parent layer's `name` (e.g., `"Layer 1"`), displayed as non-editable text
- Dispatches **no actions** — there are no parameters to update.
- The panel body has no interactive controls. The title and close button are provided by the `AdjustmentPanel` shell and are not re-implemented here.

### Why `InvertPanel` still exists

The `AdjustmentPanel` shell's adjustment-type switch lands on `case 'color-invert'`. Without a sub-panel component, the shell would need a special empty-body case. Providing `InvertPanel` keeps the switch uniform and makes the parent layer indicator visible as the spec requires.

### Registration in `AdjustmentPanel.tsx`

```tsx
case 'color-invert':
  return <InvertPanel layer={layer as ColorInvertAdjustmentLayer} />
```

---

## Adjustment Registry Changes

### `src/adjustments/registry.ts`

Append an entry to `ADJUSTMENT_REGISTRY`:

```ts
{
  adjustmentType: 'color-invert' as const,
  label: 'Color Invert',           // NO trailing ellipsis — no dialog, no parameters
  defaultParams: {},
},
```

The absence of an ellipsis (`…`) on the label is intentional and spec-required: an ellipsis signals that a dialog or panel with configurable parameters will open. Color Invert has no parameters, so no ellipsis is used.

---

## Architectural Constraints

- **No business logic in `App.tsx`** — `useAdjustments` handles layer creation and panel open/close; no new hooks are needed.
- **`WebGLRenderer.ts` must not import from `@/types`** — the `AdjustmentRenderOp` variant for `color-invert` carries only plain structural fields, no type imports needed.
- **`InvertPanel` is a panel sub-component**, not re-exported from `src/components/index.ts`.
- **Empty `params` field is preserved** — `ColorInvertAdjustmentLayer.params` stores `{}` rather than omitting the field entirely. This keeps the type structurally consistent with all other `AdjustmentLayerState` members and avoids special-casing in generic reducer and hook code.
- **CSS must use `.module.scss`** — `InvertPanel.module.scss` is the scoped stylesheet.

---

## Open Questions

1. **`InvertPanel` body content** — the spec specifies "a read-only parent layer indicator." If the design team later decides the panel body should be completely empty (no parent indicator), `InvertPanel` can be reduced to returning `null` from its render. The `AdjustmentPanel` shell title already identifies the adjustment type; the parent indicator is strictly informational.
2. **Double-invert stacking** — two stacked Color Invert layers on the same parent cancel out. This is correct per spec and requires no special handling; it is a natural consequence of the non-destructive compositing pipeline.
