# Technical Design: Render Lens Flare

## Overview

Lens Flare is a procedural render filter that generates a synthetic optical flare on a brand-new, fully-transparent layer placed directly above the active layer. Unlike every other filter in the Filters menu, it does **not** read from an existing layer — the GPU shader writes to a blank `rgba8unorm` output texture without a source texture binding. A modal dialog lets the user choose a lens type (0–4), set brightness (10–300, default 100), and position the flare center by clicking or dragging on an interactive preview canvas. On Apply, the full-resolution flare pixel data is passed back to `App.tsx` via an `onApply` callback; the app creates the layer via the existing `INSERT_LAYER_ABOVE` dispatch and registers one undo entry. On Cancel, no state changes.

---

## Affected Areas

| File | What changes |
|---|---|
| `src/webgpu/filterShaders.ts` | Append `FILTER_LENS_FLARE_COMPUTE` shader constant |
| `src/webgpu/filterCompute.ts` | Add `lensFlareRenderPipeline` field, `renderLensFlare()` class method, module-level `renderLensFlare()` export |
| `src/components/dialogs/LensFlareDialog/LensFlareDialog.tsx` | **New** — dialog component |
| `src/components/dialogs/LensFlareDialog/LensFlareDialog.module.scss` | **New** — dialog styles |
| `src/components/index.ts` | Export `LensFlareDialog` and `LensFlareDialogProps` |
| `src/filters/registry.ts` | Add `render-lens-flare` entry in `render` group |
| `src/types/index.ts` | Add `'render-lens-flare'` to the `FilterKey` union |
| `src/hooks/useFilters.ts` | Extend `UseFiltersOptions` with `dispatch`/`stateRef`; add `handleOpenLensFlare` and `handleApplyLensFlare`; extend `UseFiltersReturn` |
| `src/App.tsx` | Add `showLensFlareDialog` state; pass `dispatch`/`stateRef` to `useFilters`; add `'render-lens-flare'` branch in `handleOpenFilterDialog`; mount `LensFlareDialog` |

---

## State Changes

No new fields on `AppState`. No new reducer actions. The existing `INSERT_LAYER_ABOVE` action handles layer insertion:

```ts
dispatch({
  type: 'INSERT_LAYER_ABOVE',
  payload: {
    layer: { id, name: 'Lens Flare', visible: true, opacity: 1, locked: false, blendMode: 'normal' },
    aboveId: activeLayerId,
  },
})
```

`FilterKey` in `src/types/index.ts` gains one member:

```ts
export type FilterKey =
  | ...
  | 'render-lens-flare'
```

---

## New Components / Hooks / Tools

### `LensFlareDialog` (dialog)

**Path:** `src/components/dialogs/LensFlareDialog/LensFlareDialog.tsx`

**Single responsibility:** Render an interactive lens flare preview, collect user parameters, and call `onApply(pixels, width, height)` with full-resolution rendered pixels on commit.

**Props:**

```ts
export interface LensFlareDialogProps {
  isOpen:    boolean
  onApply:   (pixels: Uint8Array, width: number, height: number) => void
  onCancel:  () => void
  width:     number   // full canvas width in pixels
  height:    number   // full canvas height in pixels
}
```

The dialog does **not** receive `canvasHandleRef`, `activeLayerId`, or `captureHistory`. It is entirely self-contained — it calls `renderLensFlare` from `@/webgpu/filterCompute` and delivers the result via `onApply`. It never reads from or writes to AppContext.

**Internal state:**

```ts
const [lensType,   setLensType]   = useState(0)          // 0–4
const [brightness, setBrightness] = useState(100)        // 10–300
const [centerX,    setCenterX]    = useState(Math.round(width  / 2))
const [centerY,    setCenterY]    = useState(Math.round(height / 2))
const [isBusy,     setIsBusy]     = useState(false)

const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
```

**Preview canvas sizing:**

```ts
const PREVIEW_MAX_W = 280
const PREVIEW_MAX_H = 180

const previewScale = Math.min(1, Math.min(PREVIEW_MAX_W / width, PREVIEW_MAX_H / height))
const previewW = Math.round(width  * previewScale)
const previewH = Math.round(height * previewScale)
```

**Preview render helper** (called after any parameter change):

```ts
async function renderPreview(): Promise<void> {
  const canvas = previewCanvasRef.current
  if (!canvas) return
  const pCx = Math.round(centerX * previewScale)
  const pCy = Math.round(centerY * previewScale)
  const pixels = await renderLensFlare(previewW, previewH, pCx, pCy, brightness, lensType)
  const ctx = canvas.getContext('2d')!
  const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer), previewW, previewH)
  ctx.clearRect(0, 0, previewW, previewH)
  ctx.putImageData(imageData, 0, 0)
}
```

**Debounce rule (spec):**
- `lensType` changes → re-render immediately (no debounce)
- `brightness` changes → re-render after 150 ms debounce
- Pointer interaction → re-render immediately

**Pointer interaction on preview canvas:**

On `pointerdown` and `pointermove` (while `buttons & 1`), translate click coordinates to canvas space:

```ts
function handlePreviewPointer(e: React.PointerEvent<HTMLCanvasElement>): void {
  const rect = previewCanvasRef.current!.getBoundingClientRect()
  const relX = e.clientX - rect.left
  const relY = e.clientY - rect.top
  const newCx = Math.round(Math.max(0, Math.min(width  - 1, relX / previewScale)))
  const newCy = Math.round(Math.max(0, Math.min(height - 1, relY / previewScale)))
  setCenterX(newCx)
  setCenterY(newCy)
  // trigger immediate preview re-render
}
```

**Apply handler:**

```ts
async function handleApply(): Promise<void> {
  setIsBusy(true)
  const pixels = await renderLensFlare(width, height, centerX, centerY, brightness, lensType)
  onApply(pixels, width, height)
}
```

**Cancel / Escape:** call `onCancel()`. Keyboard shortcut: `useEffect` listens for `keydown` on `'Escape'` and calls `onCancel`.

**Layout:** two-column layout inside `ToolWindow`:
- Left column: preview `<canvas>` with `cursor: crosshair`, width × height = `previewW × previewH`, plus X/Y numeric readouts below it (read-only `<span>`)
- Right column: lens type selector (radio group or `<select>`), brightness `SliderInput` (range 10–300, unit "%")
- Footer row: Cancel + Apply buttons (`DialogButton`)

---

## GPU Shader

### Shader constant name

`FILTER_LENS_FLARE_COMPUTE` — append to `src/webgpu/filterShaders.ts`.

### Params struct (16 bytes, aligned)

```wgsl
struct LensFlareParams {
  centerX    : u32,  // pixel x of flare center
  centerY    : u32,  // pixel y of flare center
  brightness : u32,  // 10–300
  lensType   : u32,  // 0–4
}
```

### Binding layout (no source texture — render-only shader)

```
@group(0) @binding(0)  var dstTex  : texture_storage_2d<rgba8unorm, write>
@group(0) @binding(1)  var<uniform> params : LensFlareParams
```

### Entry point and top-level dispatch

```wgsl
@compute @workgroup_size(8, 8)
fn cs_lens_flare(@builtin(global_invocation_id) id : vec3u) {
  let dims  = textureDimensions(dstTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let px = f32(id.x);
  let py = f32(id.y);
  let cx = f32(params.centerX);
  let cy = f32(params.centerY);
  let dx = px - cx;
  let dy = py - cy;
  let dist = sqrt(dx * dx + dy * dy);
  let w    = f32(dims.x);
  let h    = f32(dims.y);
  // Normalize all distances relative to canvas diagonal so the flare
  // scales correctly at any resolution.
  let diag = sqrt(w * w + h * h);
  let brightnessF = f32(params.brightness) / 100.0;

  var color = vec4f(0.0, 0.0, 0.0, 0.0);

  if      (params.lensType == 0u) { color = flare_zoom(dx, dy, dist, cx, cy, diag, w, h); }
  else if (params.lensType == 1u) { color = flare_prime35(dx, dy, dist, cx, cy, diag); }
  else if (params.lensType == 2u) { color = flare_prime105(dx, dy, dist, diag); }
  else if (params.lensType == 3u) { color = flare_movie_prime(dx, dy, dist, cx, cy, diag, w, h); }
  else                             { color = flare_anamorphic(px, py, dx, dy, dist, cx, cy, diag, w, h); }

  textureStore(dstTex, vec2i(id.xy), clamp(color * brightnessF, vec4f(0.0), vec4f(1.0)));
}
```

### Shared helpers

```wgsl
// Gaussian bell curve (distance squared variant — avoids an extra sqrt)
fn gauss(distSq : f32, sigmaSq : f32) -> f32 {
  return exp(-distSq / sigmaSq);
}

// Gaussian centered on a 1-D distance value
fn gauss1(d : f32, sigma : f32) -> f32 {
  return exp(-(d * d) / (sigma * sigma));
}

// Artifact position along the flare axis.
// axis_len_sq = dot(axisDir, axisDir) — precomputed for the type.
fn artifact_dist(dx: f32, dy: f32, axDx: f32, axDy: f32, t: f32) -> f32 {
  let ax = axDx * t;
  let ay = axDy * t;
  let ex = dx - ax;
  let ey = dy - ay;
  return sqrt(ex * ex + ey * ey);
}
```

### Type 0 — 50–300mm Zoom

Elements:
1. **Central hot-spot bloom** — Gaussian disk, warm white (`1.0, 0.95, 0.85`), sigma = `0.04 * diag`
2. **Primary halo ring** — ring at `r = 0.12 * diag`, width sigma = `0.008 * diag`, warm white
3. **Secondary halo ring** — ring at `r = 0.22 * diag`, width sigma = `0.006 * diag`, blue-green tint (`0.6, 0.8, 1.0`)
4. **Tertiary halo ring** — ring at `r = 0.35 * diag`, width sigma = `0.005 * diag`, magenta tint (`0.9, 0.5, 0.9`)
5. **Artifact chain (6 discs)** — axis direction: normalized vector `(-cx + w*0.5, -cy + h*0.5)` (pointing from flare toward canvas center), artifacts at `t ∈ {0.3, 0.55, 0.75, 1.0, 1.3, 1.6} * diag` with radii `{0.025, 0.012, 0.018, 0.008, 0.014, 0.010} * diag` and colors cycling through green, cyan, yellow, orange, violet, blue

Ring contribution formula:

```wgsl
fn ring(dist: f32, r: f32, sigma: f32, col: vec3f) -> vec4f {
  let v = gauss1(dist - r, sigma);
  return vec4f(col * v, v);
}
```

Artifact contribution:

```wgsl
fn disc(d: f32, radius: f32, col: vec3f) -> vec4f {
  let v = gauss1(d, radius * 0.5);
  return vec4f(col * v, v);
}
```

Accumulate all contributions with `color += contribution`, let the final `clamp(...*brightnessF)` limit the output.

### Type 1 — 35mm Prime (Starburst)

Elements:
1. **Central core** — small tight Gaussian, pure white, sigma = `0.02 * diag`
2. **Starburst (8 spokes)** — `angle = atan2(dy, dx)`, each spoke is a narrow Gaussian in angular space repeated every `π/4` rad. Contribution:

   ```wgsl
   fn starburst(dx: f32, dy: f32, dist: f32, diag: f32) -> vec4f {
     let angle  = atan2(dy, dx);
     let period = 3.14159265 / 4.0;
     // fmod into [-period/2, period/2]
     let mod_a  = angle - period * round(angle / period);
     let spike  = exp(-(mod_a * mod_a) / 0.0005);
     // Radial falloff: bright near center, fades with 1/dist
     let radial = spike * exp(-dist / (0.25 * diag)) / max(dist / (0.01 * diag), 1.0);
     return vec4f(vec3f(1.0, 0.97, 0.88) * clamp(radial, 0.0, 1.0),
                  clamp(radial, 0.0, 1.0));
   }
   ```

3. **Soft bloom halo** — Gaussian, sigma = `0.06 * diag`, cool-white (`0.85, 0.9, 1.0`)
4. **Two small artifacts** — discs at `t = 0.4 * diag` and `t = 0.9 * diag` along the anti-flare axis, radii `0.012 * diag`, faint green and violet

### Type 2 — 105mm Prime (Warm soft)

Elements:
1. **Large soft bloom** — wide Gaussian, sigma = `0.20 * diag`, warm orange-yellow (`1.0, 0.72, 0.30`), high amplitude
2. **Inner core** — tight Gaussian, sigma = `0.03 * diag`, near-white (`1.0, 0.90, 0.75`)
3. **Wide glow ring** — ring at `r = 0.28 * diag`, sigma = `0.035 * diag`, amber (`1.0, 0.60, 0.15`), low opacity (multiply contribution by `0.45`)
4. **No artifact chain** — zero artifacts, consistent with the "gentle and diffused" spec character

### Type 3 — Movie Prime (Hexagonal iris)

Elements:
1. **Central bloom** — Gaussian, sigma = `0.05 * diag`, neutral cool-white (`0.88, 0.92, 1.0`)
2. **Hexagonal iris** — bright hexagon outline centered at flare center, inner radius `0.04 * diag`, edge width `0.004 * diag`:

   ```wgsl
   fn hex_dist(dx: f32, dy: f32) -> f32 {
     let ax = abs(dx);
     let ay = abs(dy);
     return max(ax * 0.866025 + ay * 0.5, ay);
   }

   fn hex_iris(dx: f32, dy: f32, r: f32, edgeW: f32) -> f32 {
     let d = hex_dist(dx, dy);
     return gauss1(d - r, edgeW);
   }
   ```

3. **Artifact chain (7 discs)** — axis from flare toward canvas center, `t ∈ {0.25, 0.50, 0.70, 0.90, 1.15, 1.40, 1.65} * diag`, radii `{0.030, 0.018, 0.022, 0.010, 0.015, 0.008, 0.012} * diag`, cool neutral-blue colors cycling `vec3f(0.8, 0.85, 1.0)` with random hue offsets of ±10%

4. **Outer glow ring** — ring at `r = 0.18 * diag`, sigma = `0.010 * diag`, blue-white

### Type 4 — Cinematic / Anamorphic

Elements:
1. **Horizontal streak** — Gaussian in Y centered at `cy`, full canvas width in X, blue-teal color:

   ```wgsl
   fn streak(py: f32, cy: f32, diag: f32) -> vec4f {
     let sigmaY = 0.006 * diag;
     let v = exp(-(py - cy) * (py - cy) / (sigmaY * sigmaY));
     return vec4f(0.25, 0.60, 1.00, v) * v;
   }
   ```

2. **Streak chromatic fringe** — repeat streak at `sigmaY * 1.8`, tint red (`1.0, 0.3, 0.2`), multiply by `0.15` — creates the anamorphic red-blue edge coloring

3. **Central elliptical bloom** — elliptical Gaussian `σx = 0.05 * diag`, `σy = 0.025 * diag`, bright near-white blue:

   ```wgsl
   let v = exp(-(dx*dx)/(sigX*sigX) - (dy*dy)/(sigY*sigY));
   ```

4. **Elliptical ring artifacts (5 rings)** — artifacts along the **horizontal axis only** (no vertical component). For each artifact `i`, center at `(cx + t_i * diag, cy)` where `t ∈ {-0.30, -0.55, 0.35, 0.65, 1.0}`. Each artifact is an elliptical ring (wider in X than Y, ratio ≈ 3:1), ring radius `0.08 * diag`, width sigma = `0.006 * diag`, blue-teal color (`0.3, 0.65, 1.0`)

   ```wgsl
   fn ellip_ring(dx: f32, dy: f32, cx_a: f32, cy_a: f32,
                 rX: f32, rY: f32, sigma: f32) -> f32 {
     let ex = dx - cx_a;
     let ey = dy - cy_a;
     let ellip_d = sqrt((ex/rX)*(ex/rX) + (ey/rY)*(ey/rY));
     return gauss1(ellip_d - 1.0, sigma / rX);
   }
   ```

---

## `FilterComputeEngine` additions (`src/webgpu/filterCompute.ts`)

### New field

```ts
private readonly lensFlareRenderPipeline: GPUComputePipeline
```

### Constructor initialization

```ts
this.lensFlareRenderPipeline = this.createPipeline(FILTER_LENS_FLARE_COMPUTE, 'cs_lens_flare')
```

Add `FILTER_LENS_FLARE_COMPUTE` to the import at line 2.

### New class method

```ts
async renderLensFlare(
  width:      number,
  height:     number,
  centerX:    number,
  centerY:    number,
  brightness: number,
  lensType:   number,
): Promise<Uint8Array> {
  const { device } = this
  const w = width
  const h = height

  // Output texture — no source texture needed.
  const outTex = device.createTexture({
    size: { width: w, height: h },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })

  const paramsData = new Uint32Array([centerX, centerY, brightness, lensType])
  const paramsBuf  = createUniformBuffer(device, 16)
  writeUniformBuffer(device, paramsBuf, paramsData)

  const bindGroup = device.createBindGroup({
    layout: this.lensFlareRenderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: outTex.createView() },
      { binding: 1, resource: { buffer: paramsBuf } },
    ],
  })

  const encoder = device.createCommandEncoder()
  const pass    = encoder.beginComputePass()
  pass.setPipeline(this.lensFlareRenderPipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
  pass.end()

  const alignedBpr = Math.ceil(w * 4 / 256) * 256
  const readbuf    = createReadbackBuffer(device, alignedBpr * h)
  encoder.copyTextureToBuffer(
    { texture: outTex },
    { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h },
    { width: w, height: h },
  )
  device.queue.submit([encoder.finish()])

  await readbuf.mapAsync(GPUMapMode.READ)
  const result = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
  readbuf.unmap()

  outTex.destroy()
  paramsBuf.destroy()
  readbuf.destroy()

  return result
}
```

### Module-level export (append after `reduceNoise`)

```ts
export async function renderLensFlare(
  width:      number,
  height:     number,
  centerX:    number,
  centerY:    number,
  brightness: number,
  lensType:   number,
): Promise<Uint8Array> {
  return _engine!.renderLensFlare(width, height, centerX, centerY, brightness, lensType)
}
```

---

## `useFilters.ts` additions

### Extended `UseFiltersOptions`

Add two new required inputs so `handleApplyLensFlare` can insert the layer:

```ts
interface UseFiltersOptions {
  // ... existing fields ...
  dispatch:    Dispatch<AppAction>
  stateRef:    MutableRefObject<AppState>
}
```

### New return member signatures

```ts
export interface UseFiltersReturn {
  // ... existing members ...
  handleOpenLensFlare:   () => void
  handleApplyLensFlare:  (pixels: Uint8Array, width: number, height: number) => void
}
```

### `handleOpenLensFlare`

Follows the identical pattern of all existing `handleOpen*` callbacks:

```ts
const handleOpenLensFlare = useCallback(
  () => onOpenFilterDialog('render-lens-flare'),
  [onOpenFilterDialog]
)
```

### `handleApplyLensFlare`

Inserts a new transparent layer above the active pixel layer with the rendered pixels. Mirrors the `captureHistory` → `prepareNewLayer` → `dispatch` sequence used in `useLayers` for merge operations.

```ts
const handleApplyLensFlare = useCallback((
  pixels: Uint8Array,
  width:  number,
  height: number,
): void => {
  const handle        = canvasHandleRef.current
  const activeLayerId = stateRef.current.activeLayerId
  if (!handle || !activeLayerId) return

  const newId = `layer-${Date.now()}`
  captureHistory('Lens Flare')
  handle.prepareNewLayer(newId, 'Lens Flare', pixels)
  dispatch({
    type:    'INSERT_LAYER_ABOVE',
    payload: {
      layer: { id: newId, name: 'Lens Flare', visible: true, opacity: 1, locked: false, blendMode: 'normal' },
      aboveId: activeLayerId,
    },
  })
}, [canvasHandleRef, stateRef, captureHistory, dispatch])
```

---

## `App.tsx` changes

### New dialog visibility state

```ts
const [showLensFlareDialog, setShowLensFlareDialog] = useState(false)
```

### Import

```ts
import { LensFlareDialog } from '@/components/dialogs/LensFlareDialog/LensFlareDialog'
```

### Pass new inputs to `useFilters`

```ts
const filters = useFilters({
  layers:             state.layers,
  activeLayerId:      state.activeLayerId,
  onOpenFilterDialog: handleOpenFilterDialog,
  canvasHandleRef,
  canvasWidth:        state.canvas.width,
  canvasHeight:       state.canvas.height,
  captureHistory,
  dispatch,         // ← new
  stateRef,         // ← new
})
```

### `handleOpenFilterDialog` — add branch

```ts
if (key === 'render-lens-flare') setShowLensFlareDialog(true)
```

### Dialog mounting (alongside the other filter dialogs)

```tsx
{showLensFlareDialog && (
  <LensFlareDialog
    isOpen={showLensFlareDialog}
    onApply={(pixels, w, h) => {
      filters.handleApplyLensFlare(pixels, w, h)
      setShowLensFlareDialog(false)
    }}
    onCancel={() => setShowLensFlareDialog(false)}
    width={state.canvas.width}
    height={state.canvas.height}
  />
)}
```

---

## `src/filters/registry.ts` addition

```ts
{ key: 'render-lens-flare', label: 'Lens Flare…', group: 'render' },
```

Insert after the existing `clouds` entry so both render-group items are adjacent.

---

## `src/components/index.ts` addition

```ts
export { LensFlareDialog } from './dialogs/LensFlareDialog/LensFlareDialog'
export type { LensFlareDialogProps } from './dialogs/LensFlareDialog/LensFlareDialog'
```

---

## Implementation Steps

1. **`src/types/index.ts`** — Add `'render-lens-flare'` to the `FilterKey` union type.

2. **`src/filters/registry.ts`** — Add the `render-lens-flare` entry in the `render` group (after `clouds`).

3. **`src/webgpu/filterShaders.ts`** — Append the `FILTER_LENS_FLARE_COMPUTE` constant. The shader:
   - Declares `LensFlareParams` struct (16 bytes, 4 × u32)
   - Binds `dstTex` at `@binding(0)` and `params` at `@binding(1)` — **no source texture binding**
   - Implements the five `flare_*` functions for each lens type plus the `gauss`, `gauss1`, `ring`, `disc`, `hex_dist`, `ellip_ring` helpers
   - Dispatches per-pixel and writes `clamp(color * brightnessF, 0, 1)` to `dstTex`

4. **`src/webgpu/filterCompute.ts`** — (a) Add `FILTER_LENS_FLARE_COMPUTE` to the import line at line 2. (b) Add `private readonly lensFlareRenderPipeline` field. (c) Initialize it in the constructor. (d) Implement the `renderLensFlare` class method following the structure in the GPU Shader section above. (e) Append the module-level `renderLensFlare` export function.

5. **`src/components/dialogs/LensFlareDialog/LensFlareDialog.module.scss`** — Create styles. Key rules:
   - `.previewArea` — fixed-size container for the preview canvas, position relative, `cursor: crosshair`
   - `.previewCanvas` — `display: block` (no inline-block gap)
   - `.coordinateReadouts` — small monospace readout row below the canvas (`font-variant-numeric: tabular-nums`)
   - `.twoColumnBody` — CSS grid `grid-template-columns: auto 1fr`, gap between preview and controls columns
   - `.controlsColumn` — flex column with labeled control rows
   - `.lensTypeList` — flex column of radio items or styled select

6. **`src/components/dialogs/LensFlareDialog/LensFlareDialog.tsx`** — Implement the dialog component:
   - Return `null` when `!isOpen`
   - `useEffect` on `isOpen`: reset state to defaults (`lensType=0`, `brightness=100`, `centerX=Math.round(width/2)`, `centerY=Math.round(height/2)`); run initial preview render
   - Render preview: whenever `lensType` changes → immediate `renderPreview()`; whenever `brightness` changes → 150 ms debounced `renderPreview()`; whenever `centerX`/`centerY` change → immediate `renderPreview()`
   - Pointer handlers on `<canvas>`: `onPointerDown` and `onPointerMove` (guard `e.buttons & 1`), translate to canvas coords, update state
   - Use `ToolWindow` wrapper (matching existing dialog chrome)
   - Apply button disabled while `isBusy`
   - `useEffect` cleanup: `clearTimeout(debounceTimerRef.current)`
   - Keyboard: `useEffect` on `isOpen` attaches `keydown` listener for `Escape → onCancel()`; returns cleanup

7. **`src/components/index.ts`** — Append the `LensFlareDialog` export and its props type export.

8. **`src/hooks/useFilters.ts`** — (a) Add `dispatch: Dispatch<AppAction>` and `stateRef: MutableRefObject<AppState>` to `UseFiltersOptions`. (b) Add `handleOpenLensFlare` and `handleApplyLensFlare` to `UseFiltersReturn`. (c) Implement both callbacks as described above. (d) Include both in the `return` object.

9. **`src/App.tsx`** — (a) Add `showLensFlareDialog` state. (b) Add import. (c) Pass `dispatch` and `stateRef` to `useFilters`. (d) Add the `'render-lens-flare'` branch inside `handleOpenFilterDialog`. (e) Mount `<LensFlareDialog>` in the render tree.

10. **Typecheck** — Run `npm run typecheck` and resolve any type errors before considering the implementation complete.

---

## Architectural Constraints

- **App.tsx is a thin orchestrator.** The `handleApplyLensFlare` business logic (history capture, layer insertion) lives in `useFilters.ts`, not inlined in `App.tsx`. App.tsx only calls `filters.handleApplyLensFlare` and closes the dialog.
- **Dialog does not touch AppContext.** `LensFlareDialog` has no access to `dispatch`, `state`, `captureHistory`, or `canvasHandleRef`. It is given `width`/`height` as numbers and calls `onApply` with raw pixels. The app owns all state mutations.
- **No source texture.** Unlike every other filter in `FilterComputeEngine`, `renderLensFlare` creates no source texture and does not upload existing pixel data to the GPU. The compute shader is a pure render pass — binding 0 is write-only output.
- **History pattern.** `captureHistory('Lens Flare')` must be called before `prepareNewLayer` and `dispatch`, matching the pattern in `useLayers.handleMergeSelected`. This ensures Cmd+Z restores the pre-insertion layer stack.
- **CSS modules.** Both new files must use `.module.scss`. A plain `.scss` import is invisible at runtime.
- **Pointer event guard.** The preview canvas pointer handler must check `e.buttons & 1` on `pointermove` to ignore hover events and stylus-hover for Wacom devices.
- **No pixel layer guard inside the dialog.** The guard (menu item disabled when no pixel layer is active) is enforced by `isFiltersMenuEnabled` in `useFilters` and by the menu item state in `TopBar`. The dialog itself does not re-validate this; by the time it opens, a valid pixel layer is guaranteed to be active.
- **`_engine!` assumption.** The module-level `renderLensFlare` function calls `_engine!.renderLensFlare(...)` exactly like all other module-level exports. No new initialization logic is needed.
- **Rasterization pipeline.** The lens flare layer is a standard `PixelLayerState` (no special type). It participates in flatten, merge, and export through the unified rasterization pipeline without any changes — it is just another pixel layer.

---

## Open Questions

1. **Artifact axis direction for types 0 and 3.** The design uses "normalized vector from flare center toward canvas center" as the artifact axis. This matches Photoshop's behavior when the flare is off-center but produces a degenerate zero-length axis when the flare is exactly at the canvas center. The shader should fall back to a fixed axis (e.g. `vec2f(1.0, 0.0)`) when `length(axis) < 0.001`.

2. **Anamorphic streak width.** The streak sigma `0.006 * diag` is an estimate; at very high resolutions (e.g. 8000 px wide) this may look too thin. Consider using `max(0.006 * diag, 4.0)` as a minimum pixel guarantee.

3. **Lens type selector widget.** The spec shows five named options. The design defers the choice of a `<select>` element versus a radio group to the implementor — both are functionally correct. A radio group is more discoverable for five items but takes more vertical space in the controls column.

4. **Preview composite.** The spec calls for compositing the flare over a scaled-down representation of the actual canvas content. The architecture section overrides this with "render on transparent black Uint8Array." If the PM requires real canvas compositing in the preview, `LensFlareDialogProps` needs an additional `previewPixels?: Uint8Array` prop and the dialog must composite the flare over it using a 2D canvas `globalCompositeOperation = 'lighter'` or a second `drawImage` call. This is a product decision, not a technical blocker.

5. **`useFilters` signature change.** Adding `dispatch` and `stateRef` to `UseFiltersOptions` is a breaking change to all call sites of `useFilters`. Currently there is one call site (`App.tsx`). Confirm this is acceptable before implementing step 8.
