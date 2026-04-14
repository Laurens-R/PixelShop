# Technical Design: Brightness/Contrast

## Overview

The Brightness/Contrast adjustment is a non-destructive child layer that shifts luminance and tonal contrast of a parent pixel layer at render time without touching its pixel data. When the user triggers **Image → Brightness/Contrast…**, a `BrightnessContrastAdjustmentLayer` record is inserted into `state.layers` immediately after the active pixel layer (following the same child-layer positioning contract established for mask layers), `openAdjustmentLayerId` is set to the new layer's ID, and `AdjustmentPanel` opens showing `BrightnessContrastPanel`. Slider changes dispatch `UPDATE_ADJUSTMENT_LAYER` updates into `state.layers`; on every such update `useCanvas` re-renders via the WebGL compositing pipeline, which now includes a GPU-side brightness/contrast pass applied inline in the ping-pong loop. No WASM is needed; the math is simple enough for GLSL. One undo entry is recorded when the panel closes.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `hasMask: boolean` to `BrightnessContrastAdjustmentLayer`; add `UPDATE_ADJUSTMENT_LAYER` action type reference (action union lives in `AppContext.tsx`) |
| `src/store/AppContext.tsx` | Add `UPDATE_ADJUSTMENT_LAYER` to `AppAction` union and its reducer case |
| `src/webgl/shaders.ts` | **New constant** `BC_VERT` + `BC_FRAG` — brightness/contrast post-process GLSL shader |
| `src/webgl/WebGLRenderer.ts` | Add `bcProgram`; new public type `AdjustmentRenderOp`; new public method `applyBrightnessContrastPass`; new public `renderPlan` / `readFlattenedPlan` methods that replace existing render loop with one that handles adjustment ops |
| `src/hooks/useCanvas.ts` | Build `RenderPlan[]` from `state.layers` at render time; maintain `adjustmentMaskMap` ref; expose `registerAdjustmentSelectionMask` |
| `src/hooks/useAdjustments.ts` | Pass resolved selection pixels into registration callback when creating a masked adjustment layer |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Register and render `BrightnessContrastPanel` in the `adjustmentType` switch |
| `src/components/panels/AdjustmentPanel/BrightnessContrastPanel.tsx` | **New file.** Sub-panel with two slider rows |
| `src/App.tsx` | Wire `registerAdjustmentSelectionMask` from `useCanvas` into `useAdjustments` options |

---

## State Changes

### Extend `BrightnessContrastAdjustmentLayer` in `src/types/index.ts`

The adjustment-menu design defined:

```ts
export interface BrightnessContrastAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'brightness-contrast'
  params: AdjustmentParamsMap['brightness-contrast']  // { brightness: number; contrast: number }
}
```

Add one field here:

```ts
export interface BrightnessContrastAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'brightness-contrast'
  params: AdjustmentParamsMap['brightness-contrast']
  /** True when a selection was active at creation time; the baked mask pixels
   *  live in useCanvas.adjustmentMaskMap (not in React state). */
  hasMask: boolean
}
```

Keeping pixel data out of React state means large selection masks don't get shallow-copied on every action.

### New action in `src/store/AppContext.tsx`

```ts
// Add to AppAction union:
| { type: 'UPDATE_ADJUSTMENT_LAYER'; payload: AdjustmentLayerState }
```

#### Reducer case

```ts
case 'UPDATE_ADJUSTMENT_LAYER':
  return {
    ...state,
    layers: state.layers.map(l =>
      l.id === action.payload.id ? action.payload : l
    ),
  }
```

This replaces the whole adjustment layer record (same pattern as `UPDATE_TEXT_LAYER` / `UPDATE_SHAPE_LAYER`). `BrightnessContrastPanel` sends a structurally complete updated layer, not a partial patch.

---

## Pixel Math

**No new WASM function is required.** There is no existing `filters_brightness_contrast` in `wasm/src/filters.h`; one is not needed because the adjustment runs entirely on the GPU via a new GLSL program.

### Algorithm

Apply brightness first, then contrast, operating on the RGB channels of each pixel (alpha is preserved unchanged and fully-transparent pixels are skipped):

$$
\text{out} = \text{clamp}\!\left(\left(\text{clamp}(\text{in} + \tfrac{B}{100},\, 0, 1) - 0.5\right) \cdot \tfrac{C + 100}{100} + 0.5,\; 0,\; 1\right)
$$

where $B \in [-100, 100]$ (brightness) and $C \in [-100, 100]$ (contrast).

**Boundary checks:**
- $B = +100$: all channels clamp to 1.0 (white) before contrast is applied → output is white. ✓  
- $B = -100$: all channels clamp to 0.0 (black) → output is black. ✓  
- $C = 0$: contrast factor $= 1.0$ → identity. ✓  
- $C = +100$: contrast factor $= 2.0$ → range doubled around 0.5; 0.25 → 0, 0.75 → 1. ✓  
- $C = -100$: contrast factor $= 0.0$ → all values collapse to 0.5 (50 % gray). ✓  
- $\alpha = 0$: shader returns `src` unchanged (early exit). ✓

### New GLSL — `BC_VERT` + `BC_FRAG` in `src/webgl/shaders.ts`

```glsl
// BC_VERT — full-screen quad, no transform needed
#version 300 es
in vec2 a_position;
uniform vec2 u_resolution;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_position / u_resolution;
  gl_Position = vec4(a_position / u_resolution * 2.0 - 1.0, 0.0, 1.0);
}
```

```glsl
// BC_FRAG — brightness/contrast post-process pass
#version 300 es
precision mediump float;

uniform sampler2D u_src;        // accumulated composite (straight RGBA)
uniform float u_brightness;     // −100 … +100
uniform float u_contrast;       // −100 … +100
uniform sampler2D u_selMask;    // baked selection mask (R = alpha, full-canvas)
uniform bool u_hasSelMask;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 src = texture(u_src, v_texCoord);

  // Preserve fully-transparent pixels
  if (src.a < 0.0001) { fragColor = src; return; }

  vec3 rgb = src.rgb;

  // 1. Brightness: additive shift in [0,1] space
  float b = u_brightness / 100.0;
  rgb = clamp(rgb + b, 0.0, 1.0);

  // 2. Contrast: expand / compress around midpoint 0.5
  float cFactor = (u_contrast + 100.0) / 100.0;   // −100→0, 0→1, +100→2
  rgb = clamp((rgb - 0.5) * cFactor + 0.5, 0.0, 1.0);

  vec4 adjusted = vec4(rgb, src.a);

  // 3. Selection mask blend (0 = unaffected, 1 = fully adjusted)
  float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
  fragColor = mix(src, adjusted, mask);
}
```

**Straight-alpha note:** The WebGL context is created with `premultipliedAlpha: false`; all FBO textures store straight RGBA. The B/C shader operates on straight RGB directly — no pre/de-multiply step needed.

---

## WebGL Renderer Changes (`src/webgl/WebGLRenderer.ts`)

### New exported type

```ts
// Export so useCanvas can build the plan without importing renderer internals
export type AdjustmentRenderOp =
  | {
      kind: 'brightness-contrast'
      brightness: number          // −100..+100
      contrast: number            // −100..+100
      visible: boolean            // if false, op is skipped (layer hidden)
      selMaskLayer?: WebGLLayer   // baked selection mask, optional
    }

export type RenderPlanEntry =
  | { kind: 'layer'; layer: WebGLLayer; mask?: WebGLLayer }
  | AdjustmentRenderOp
```

### New private fields

```ts
private readonly bcProgram: WebGLProgram
private readonly fullQuadTexCoordBuffer: WebGLBuffer  // reuse texCoordBuffer if already full-quad
```

`bcProgram` is compiled and linked in the constructor alongside `imageProgram` et al.

### New public method: `applyBrightnessContrastPass`

```ts
applyBrightnessContrastPass(
  srcTex: WebGLTexture,
  dstFb: WebGLFramebuffer,
  brightness: number,
  contrast: number,
  selMaskLayer?: WebGLLayer
): void
```

Executes one brightness/contrast GLSL pass: reads `srcTex`, writes to `dstFb`. Called internally by `renderPlan` when a `brightness-contrast` op is encountered. Making it public allows `readFlattenedPlan` to call it as well without code duplication.

### New public methods: `renderPlan` / `readFlattenedPlan`

```ts
renderPlan(plan: RenderPlanEntry[]): void
readFlattenedPlan(plan: RenderPlanEntry[]): Uint8Array
```

These replace the current `render()` / `readFlattenedPixels()` call sites in `useCanvas`. The implementations are identical to the existing pair except the inner loop handles both `kind: 'layer'` entries (calling `compositeLayer` as today) and adjustment op entries (calling `applyBrightnessContrastPass` inline, continuing the same ping-pong swing).

**Backward compatibility:** the existing `render(layers, maskMap)` and `readFlattenedPixels(layers, maskMap)` signatures are kept as thin wrappers that build a plan of `{ kind: 'layer' }` entries and delegate to `renderPlan` / `readFlattenedPlan`. No existing call sites change in this feature's scope.

---

## `BrightnessContrastPanel` Component

**File:** `src/components/panels/AdjustmentPanel/BrightnessContrastPanel.tsx`  
**Category:** panel sub-component (same folder as `AdjustmentPanel`; not exported from `src/components/index.ts` — only `AdjustmentPanel` is)  
**Single responsibility:** render the two-slider body of the floating Brightness/Contrast panel and dispatch param updates in real time.

### Props

```ts
interface BrightnessContrastPanelProps {
  layer: BrightnessContrastAdjustmentLayer
}
```

`onClose` is **not** a prop here — `AdjustmentPanel` owns the close button and Escape handler, calling `props.onClose()` which triggers `useAdjustments.handleCloseAdjustmentPanel`.

### Internals

- Reads `dispatch` from `useContext(AppContext)`.
- Renders two `SliderInput` rows using the existing `SliderInput` widget:
  - **Brightness** — min `−100`, max `+100`, default `0`
  - **Contrast** — min `−100`, max `+100`, default `0`
- On every `onChange` (while dragging), dispatches:
  ```ts
  dispatch({
    type: 'UPDATE_ADJUSTMENT_LAYER',
    payload: { ...layer, params: { brightness, contrast } }
  })
  ```
- Numeric inputs clamp to `[−100, 100]` on `onBlur` / Enter. Values supplied by user outside this range (e.g., typed 150) are clamped to 100 before dispatch.
- A **Reset** button in the panel footer resets params to `{ brightness: 0, contrast: 0 }` and dispatches `UPDATE_ADJUSTMENT_LAYER`.

### How `AdjustmentPanel` registers it

In `AdjustmentPanel.tsx`, the switch on `layer.adjustmentType` gains:

```tsx
case 'brightness-contrast':
  return <BrightnessContrastPanel layer={layer} />
```

---

## Live Preview / Rendering Pipeline

The full data flow from slider drag to on-screen pixel update:

1. **Slider `onChange`** dispatches `UPDATE_ADJUSTMENT_LAYER` with new `params.brightness` / `params.contrast`.
2. React re-renders; `useReducer` produces a new `state.layers` with the updated `BrightnessContrastAdjustmentLayer`.
3. **`useCanvas` render effect** fires (it already watches `state.layers`). It builds the `RenderPlan[]` from `state.layers`:
   - For each `LayerState` entry:
     - `isPixelLayer(l)` → `{ kind: 'layer', layer: wglLayerMap.current.get(l.id), mask: maskMap.get(l.id) }`
     - `l.type === 'adjustment' && l.adjustmentType === 'brightness-contrast'` →
       `{ kind: 'brightness-contrast', brightness: l.params.brightness, contrast: l.params.contrast, visible: l.visible, selMaskLayer: adjustmentMaskMap.current.get(l.id) }`
     - Other adjustment types, text, shape layers → included when the sibling tech designs are implemented.
4. Calls `renderer.renderPlan(plan)`.
5. Inside `renderPlan`, the ping-pong loop iterates `plan` entries in order:
   - `kind: 'layer'` → `compositeLayer(entry.layer, srcTex, dstFb, w, h, entry.mask)` (unchanged)
   - `kind: 'brightness-contrast'` and `visible: true` → `applyBrightnessContrastPass(srcTex, dstFb, brightness, contrast, selMaskLayer)`, then swap ping-pong buffers
   - `kind: 'brightness-contrast'` and `visible: false` → skip entirely (layer hidden = no effect)
6. Canvas updates on screen. Total GPU work per slider tick: one compositing pass per underlying layer plus one full-screen B/C quad draw.

**No debouncing or async WASM call** is in this path; the entire path is synchronous GPU work within a single React render cycle.

---

## Selection Masking

### At creation time

`useAdjustments.handleCreateAdjustmentLayer` gains an optional `onMaskCreated` callback injected from `App.tsx`:

```ts
interface UseAdjustmentsOptions {
  stateRef:              MutableRefObject<AppState>
  captureHistory:        (label: string) => void
  dispatch:              Dispatch<AppAction>
  getSelectionPixels:    () => Uint8Array | null   // returns null if no selection active
  registerAdjMask:       (layerId: string, pixels: Uint8Array) => void
}
```

In `handleCreateAdjustmentLayer`:

```ts
// After dispatching ADD_ADJUSTMENT_LAYER:
const selPixels = getSelectionPixels()
const hasMask = selPixels !== null
// Dispatch with hasMask field:
dispatch({ type: 'ADD_ADJUSTMENT_LAYER', payload: { ...newLayer, hasMask } })
if (selPixels) {
  registerAdjMask(newLayerId, selPixels)
}
```

### Mask format

`getSelectionPixels()` returns a full-canvas `Uint8Array` (RGBA, `width × height × 4` bytes) where alpha = 255 for selected pixels and 0 for unselected. `registerAdjMask` in `useCanvas`:

1. Creates a new `WebGLLayer` at full canvas size.
2. For each pixel, copies the alpha channel of the selection into the R channel of the new layer's data (so R = 255 → fully selected, R = 0 → unselected).
3. Flushes the layer's CPU data to its GPU texture via `renderer.flushLayer(maskLayer)`.
4. Stores `adjustmentMaskMap.current.set(layerId, maskLayer)`.

### In the GLSL pass

The `BC_FRAG` shader samples `u_selMask` at the current `v_texCoord` (full-canvas UV). The R channel drives the `mix()` blend weight:

```glsl
float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
fragColor = mix(src, adjusted, mask);
```

`mask = 0` → `src` returned unchanged (outside selection). `mask = 1` → `adjusted` returned. Feathered selections produce smooth blending automatically.

### Cleanup

When `REMOVE_LAYER` fires for an adjustment layer (or its parent), `useCanvas` already reacts to layer state changes. It should delete orphaned entries from `adjustmentMaskMap` and call `renderer.destroyLayer(maskLayer)` for any adjustment layer ID that is no longer present in `state.layers`. This is best placed in the same `useEffect` that monitors `state.layers` for added/removed layers to sync `wglLayerMap`.

---

## New Files and Changed Files

### New files

| File | Purpose |
|---|---|
| `src/components/panels/AdjustmentPanel/BrightnessContrastPanel.tsx` | Two-slider sub-panel UI |
| `src/components/panels/AdjustmentPanel/BrightnessContrastPanel.module.scss` | Scoped styles (relies on variables from `_variables.scss`) |

### Changed files

| File | Summary of change |
|---|---|
| `src/types/index.ts` | Add `hasMask: boolean` to `BrightnessContrastAdjustmentLayer` |
| `src/store/AppContext.tsx` | Add `UPDATE_ADJUSTMENT_LAYER` action + reducer case; import `AdjustmentLayerState` |
| `src/webgl/shaders.ts` | Add `BC_VERT` and `BC_FRAG` constants |
| `src/webgl/WebGLRenderer.ts` | Add `bcProgram`; add `AdjustmentRenderOp` + `RenderPlanEntry` export types; add `applyBrightnessContrastPass`, `renderPlan`, `readFlattenedPlan` methods |
| `src/hooks/useCanvas.ts` | Add `adjustmentMaskMap` ref; add `registerAdjustmentSelectionMask`; build `RenderPlanEntry[]` from `state.layers`; call `renderPlan` instead of `render` |
| `src/hooks/useAdjustments.ts` | Add `getSelectionPixels` + `registerAdjMask` to options; call both in `handleCreateAdjustmentLayer`; baked `hasMask` field on the dispatched payload |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Import and render `BrightnessContrastPanel` in the `adjustmentType` switch |
| `src/App.tsx` | Pass `getSelectionPixels` (from `selectionStore` or `useCanvas`) and `registerAdjMask` (from `useCanvas`) into `useAdjustments` |

---

## Implementation Steps

1. **`src/types/index.ts`** — Add `hasMask: boolean` to `BrightnessContrastAdjustmentLayer`. No other type changes in this file for this feature (type system was established by the adjustment-menu design).

2. **`src/store/AppContext.tsx`** — Import `AdjustmentLayerState` from `@/types`. Add `UPDATE_ADJUSTMENT_LAYER` to the `AppAction` union. Add the reducer case. (The `ADD_ADJUSTMENT_LAYER`, `SET_OPEN_ADJUSTMENT`, and `REMOVE_LAYER` cascade changes come from the adjustment-menu design and are prerequisites.)

3. **`src/webgl/shaders.ts`** — Append `BC_VERT` and `BC_FRAG` string constants. No changes to existing shader constants.

4. **`src/webgl/WebGLRenderer.ts`** — 
   - Import `BC_VERT`, `BC_FRAG` from `./shaders`.
   - Compile and link `bcProgram` in the constructor.
   - Export `AdjustmentRenderOp` and `RenderPlanEntry` types.
   - Implement `applyBrightnessContrastPass(srcTex, dstFb, brightness, contrast, selMaskLayer?)` — binds `bcProgram`, sets uniforms, draws a full-screen quad into `dstFb`.
   - Implement `renderPlan(plan: RenderPlanEntry[]): void` — the new primary render entry point.
   - Implement `readFlattenedPlan(plan: RenderPlanEntry[]): Uint8Array`.
   - Update `render()` and `readFlattenedPixels()` to delegate to `renderPlan` / `readFlattenedPlan` (wrap existing `WebGLLayer[]` into `{ kind: 'layer' }` entries).

5. **`src/hooks/useCanvas.ts`** —
   - Add `adjustmentMaskMap = useRef<Map<string, WebGLLayer>>(new Map())`.
   - Add `registerAdjustmentSelectionMask(layerId: string, selPixels: Uint8Array): void` that creates a WebGL layer from the selection's A-channel → R-channel.
   - In the layer-cleanup effect (where `wglLayerMap` entries are removed for deleted layers), also clean up `adjustmentMaskMap` entries and call `renderer.destroyLayer`.
   - In the render effect, replace the `WebGLLayer[]` construction with `RenderPlanEntry[]` construction that handles `type === 'adjustment'` entries.
   - Replace `renderer.render(...)` call with `renderer.renderPlan(plan)`.

6. **`src/hooks/useAdjustments.ts`** — Add `getSelectionPixels` and `registerAdjMask` to `UseAdjustmentsOptions`. In `handleCreateAdjustmentLayer`, read selection pixels, set `hasMask`, dispatch `ADD_ADJUSTMENT_LAYER`, then call `registerAdjMask` if pixels are non-null.

7. **`src/components/panels/AdjustmentPanel/BrightnessContrastPanel.tsx`** — Implement the two-slider panel. Use the existing `SliderInput` widget for both rows. Dispatch `UPDATE_ADJUSTMENT_LAYER` on every onChange. Include a Reset button in the footer that sets both params to 0.

8. **`src/components/panels/AdjustmentPanel/BrightnessContrastPanel.module.scss`** — Add any panel-specific layout styles. The slider rows inherit from `SliderInput`'s own module styles; the footer reset button needs a `resetBtn` class.

9. **`src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`** — Import `BrightnessContrastPanel`. Add the `case 'brightness-contrast':` branch to the `adjustmentType` switch.

10. **`src/App.tsx`** — Pass `registerAdjustmentSelectionMask` (from `useCanvas`) and a `getSelectionPixels` helper (reading from `selectionStore`) into `useAdjustments` as options.

---

## Architectural Constraints

- **No WASM for B/C.** The math is two arithmetic operations per channel per pixel — well within GPU throughput and trivial to express in GLSL. Adding a C++ wrapper and growing the WASM binary is not justified. The WASM AGENTS rule ("CPU-intensive operations") does not apply here.
- **`WebGLRenderer` remains pixel-layer agnostic.** `RenderPlanEntry` is a structural type local to `WebGLRenderer.ts` (not imported from `src/types`). The renderer does not import any `AppState` or `LayerState` types — the translation from `LayerState[]` to `RenderPlanEntry[]` lives entirely in `useCanvas.ts`.
- **Mask pixel data stays out of React state.** Storing a full-canvas `Uint8Array` in a `useReducer` state slice would cause it to be shallow-copied on every dispatched action. The selection mask lives in a `useRef` in `useCanvas` and is referenced by the adjustment layer's `hasMask: boolean` flag only.
- **`App.tsx` remains a thin orchestrator.** The wiring of `getSelectionPixels` and `registerAdjMask` into `useAdjustments` is two one-liners in `App.tsx`; the logic is in the hooks.
- **`BrightnessContrastPanel` is not exported from `src/components/index.ts`.** It is an internal sub-component of `AdjustmentPanel`. Only `AdjustmentPanel` is barrel-exported.
- **Undo is captured on close, not on slider drag.** Each slider `onChange` dispatches `UPDATE_ADJUSTMENT_LAYER` which updates live state but does NOT call `captureHistory`. History is captured once in `handleCloseAdjustmentPanel`. This matches the spec and the existing captureHistory contract.
- **The existing `render()` / `readFlattenedPixels()` signatures must continue to work.** Other callers (export, clipboard) must not require changes. The new `renderPlan` / `readFlattenedPlan` are supersets; the old methods become wrappers.

---

## Open Questions

1. **`getSelectionPixels` format.** This design assumes selection pixels are a full-canvas RGBA `Uint8Array` with selected pixels at alpha 255. If `selectionStore` uses a different format (e.g., a 1-bit packed mask, an SVG path, or a `Float32Array`), the `registerAdjustmentSelectionMask` conversion step will need adjustment. **Resolution needed:** confirm `selectionStore`'s pixel format before implementing step 5.

2. **Adjustment layer in `readFlattenedPixels` / export.** The `readFlattenedPlan` method applies the B/C pass during export/flatten, correctly including the non-destructive effect in the exported image. However, merging adjustment layers via "Merge Down" or "Flatten All" is not designed here. Those operations should rasterize the B/C result into the parent layer's pixel data and remove the adjustment layer. This interacts with `useLayers` and is out of scope for this feature.

3. **Multiple stacked adjustments on one parent.** The spec allows multiple `BrightnessContrastAdjustmentLayer` records parented to the same pixel layer. The `RenderPlanEntry[]` ordering correctly applies them in sequence (each reads the accumulated composite so far, including prior adjustments). No special handling is needed, but this should be verified with a test scenario.

4. **`PixelLayerState` lacks a `type` discriminant** (tracked as P3 open question in the adjustment-menu design). The `isPixelLayer()` guard used in `handleCreateAdjustmentLayer` and `useCanvas` plan-building depends on the `!('type' in l)` heuristic. This remains fragile and should be resolved by adding `type: 'pixel'` to `PixelLayerState` in a follow-up.

5. **Panel anchor when canvas is panned.** The spec says the panel floats "anchored to the upper-right corner of the canvas." With pan/zoom in effect, the canvas DOM rect shifts. `AdjustmentPanel` should read the canvas container's `getBoundingClientRect()` to anchor correctly. This is an `AdjustmentPanel` concern (defined in the adjustment-menu design) but the exact mechanism is unspecified there; it requires a `canvasContainerRef` forwarded from `App.tsx`.

6. **Re-editing a saved file.** When a document with a `BrightnessContrastAdjustmentLayer` (with `hasMask: true`) is loaded from disk, the baked selection mask pixels are not stored in the file format — only `hasMask: boolean` is in `LayerState`. A loaded adjustment layer with `hasMask: true` but no entry in `adjustmentMaskMap` will behave as if `hasMask: false` (i.e., the whole layer is affected). This is a serialization question that depends on the file format design, which is out of scope here but must be resolved before shipping save/load.
