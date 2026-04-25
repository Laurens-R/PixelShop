# Adding a New Adjustment Layer

Adjustment layers are **non-destructive** operations that sit in the layer stack above a pixel layer and modify how it looks without changing its pixels. They are backed by WebGPU compute shaders and re-evaluated on every frame during compositing.

This guide uses a hypothetical **Posterize** adjustment (reducing the number of tonal levels) as the running example.

---

## How adjustment layers work

The data flow for a non-destructive adjustment:

```
AppState.layers[i]   → AdjustmentLayerState  (params only, no pixels)
  ↓
canvasPlan.ts        → buildAdjustmentEntry() maps state → AdjustmentRenderOp
  ↓
WebGPURenderer.ts    → renderPlan() iterates the plan, calls AdjustmentEncoder
  ↓
AdjustmentEncoder.ts → dispatches a WebGPU compute pass with uniform buffer
  ↓
WGSL shader          → reads from source texture, writes to output texture
  ↓
Screen               → composited result shown in real time
```

When the user changes a slider in the adjustment panel, `dispatch({ type: 'UPDATE_ADJUSTMENT_LAYER', payload: { ...layer, params: { ... } } })` is called. This updates `AppState`, which causes `buildRenderPlan` to rebuild the plan with new params, which triggers a new frame, which re-runs the compute shader. No pixels are ever mutated.

When the user flattens or exports, `rasterizeDocument` runs the same plan on a fresh command encoder and reads the composited result to CPU.

---

## Distinction: Adjustment Layers vs Effects

Both use the same system (adjustment layer + WGSL compute). The only difference is their registry `group`:

- `'color-adjustments'` → appears in the **Adjustments** top menu (e.g. Brightness/Contrast, Curves)
- `'real-time-effects'` → appears in the **Effects** top menu (e.g. Bloom, Drop Shadow)

Mechanically they are identical. See [adding-an-effect.md](adding-an-effect.md) for the Effects-specific steps.

---

## Step 1: Add the type to `AdjustmentType` and `AdjustmentParamsMap`

Open `src/types/index.ts`:

```typescript
// 1a. Add to the union
export type AdjustmentType =
  | 'brightness-contrast'
  | /* ... existing types ... */
  | 'posterize'   // ← add here

// 1b. Add the params shape to AdjustmentParamsMap
export interface AdjustmentParamsMap {
  'brightness-contrast': { brightness: number; contrast: number }
  // ...
  'posterize': { levels: number }   // ← add here
}
```

Adding `'posterize'` to the union immediately produces TypeScript errors in all the exhaustive switch statements and mapping objects that reference `AdjustmentType`. Follow the compiler errors — they point you to every place you need to add a case.

---

## Step 2: Register in the adjustment registry

Open `src/core/operations/adjustments/registry.ts` and add an entry:

```typescript
export const ADJUSTMENT_REGISTRY = [
  // ... existing entries ...
  {
    adjustmentType: 'posterize' as const,
    label: 'Posterize…',
    group: 'color-adjustments',
    defaultParams: { levels: 4 },
  },
] as const satisfies readonly AdjustmentRegistrationEntry[]
```

The `label` is what appears in the **Adjustments** menu and in the layer panel. The `…` (ellipsis) convention signals that the adjustment opens a floating panel.

The `defaultParams` object is what new adjustment layers are initialized with. It must exactly match `AdjustmentParamsMap['posterize']`.

---

## Step 3: Write the WGSL compute shader

WebGPU compute shaders are defined as TypeScript template strings inside `AdjustmentEncoder.ts`. Add yours there. The shader reads from a source texture and writes to an output texture.

Open `src/graphicspipeline/webgpu/AdjustmentEncoder.ts` and find the section where shaders are defined (look for `const BC_COMPUTE = /* wgsl */` as a pattern). Add:

```typescript
const POSTERIZE_COMPUTE = /* wgsl */`
  @group(0) @binding(0) var src:    texture_2d<f32>;
  @group(0) @binding(1) var dst:    texture_storage_2d<rgba16float, write>;
  @group(0) @binding(2) var<uniform> u: Params;

  struct Params {
    levels: f32,
    _pad0: f32,  // WGSL uniform structs must be padded to 16-byte alignment
    _pad1: f32,
    _pad2: f32,
  }

  @compute @workgroup_size(8, 8)
  fn cs_posterize(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(src);
    if (gid.x >= dims.x || gid.y >= dims.y) { return; }

    let px = textureLoad(src, vec2<i32>(gid.xy), 0);
    let levels = max(u.levels, 2.0);
    let step = 1.0 / (levels - 1.0);
    let r = round(px.r / step) * step;
    let g = round(px.g / step) * step;
    let b = round(px.b / step) * step;

    textureStore(dst, vec2<i32>(gid.xy), vec4<f32>(r, g, b, px.a));
  }
`
```

**Critical WGSL alignment rules:**
- Uniform structs must be padded to a multiple of 16 bytes. A `f32` is 4 bytes. If your uniform has 1 field (4 bytes), add 3 `_pad` fields.
- Use `rgba16float` for the output texture (supports high bit depth).
- Always check `gid.x >= dims.x || gid.y >= dims.y` to avoid out-of-bounds writes.
- `@workgroup_size(8, 8)` means each dispatch covers an 8×8 tile. The encoder dispatches `ceil(width / 8) × ceil(height / 8)` workgroups.

---

## Step 4: Create and register the GPU pipeline

Still in `AdjustmentEncoder.ts`, add a private pipeline field and initialize it in the constructor:

```typescript
export class AdjustmentEncoder {
  // ... existing pipelines ...
  private readonly posterizePipeline: GPUComputePipeline  // ← add field

  constructor(device: GPUDevice, pixelWidth: number, pixelHeight: number) {
    // ... existing init ...
    this.posterizePipeline = createComputePipeline(device, POSTERIZE_COMPUTE, 'cs_posterize')
  }
```

Then add a method that runs the pass:

```typescript
  runPosterize(
    encoder: GPUCommandEncoder,
    src: GPUTexture,
    dst: GPUTexture,
    params: { levels: number },
  ): void {
    // Build the uniform buffer (Float32Array, 4 floats = 16 bytes)
    const uniforms = new Float32Array(4)
    uniforms[0] = params.levels
    // uniforms[1..3] are padding, stay 0

    const uniformBuf = this.device.createBuffer({
      size: uniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(uniformBuf, 0, uniforms)

    const bindGroup = this.device.createBindGroup({
      layout: this.posterizePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: dst.createView() },
        { binding: 2, resource: { buffer: uniformBuf } },
      ],
    })

    const pass = encoder.beginComputePass()
    pass.setPipeline(this.posterizePipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(
      Math.ceil(this.pixelWidth  / 8),
      Math.ceil(this.pixelHeight / 8),
    )
    pass.end()
  }
```

**Why `Float32Array` for uniforms?** WGSL uniform structs are read as raw memory. A `f32` in WGSL corresponds to a 32-bit float in the buffer. The struct layout must match **exactly** — field order, byte offsets, and padding included. Always verify with a comment:

```typescript
// uniforms layout (16 bytes total):
// offset 0:  levels  (f32)
// offset 4:  _pad0   (f32) = 0
// offset 8:  _pad1   (f32) = 0
// offset 12: _pad2   (f32) = 0
```

---

## Step 5: Add a dispatch case in the render-plan executor

`AdjustmentEncoder.ts` has a method (e.g. `encodeAdjustment`) that takes an `AdjustmentRenderOp` and dispatches the correct pipeline. Add a case for `posterize`:

```typescript
encodeAdjustment(
  encoder: GPUCommandEncoder,
  op: AdjustmentRenderOp,
  src: GPUTexture,
  dst: GPUTexture,
): void {
  switch (op.kind) {
    case 'brightness-contrast':
      this.runBrightnessContrast(encoder, src, dst, op)
      break
    // ... other cases ...
    case 'posterize':
      this.runPosterize(encoder, src, dst, op)
      break
    default: {
      const _exhaustive: never = op
      console.warn('[AdjustmentEncoder] Unknown op:', _exhaustive)
    }
  }
}
```

---

## Step 6: Add the `AdjustmentRenderOp` variant

Open `src/graphicspipeline/webgpu/types.ts` (or wherever `AdjustmentRenderOp` is defined). Add a variant:

```typescript
export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; layerId: string; brightness: number; contrast: number; visible: boolean; selMaskLayer?: GpuLayer }
  | /* ... other variants ... */
  | { kind: 'posterize'; layerId: string; levels: number; visible: boolean; selMaskLayer?: GpuLayer }
```

---

## Step 7: Add a mapping in `canvasPlan.ts`

`canvasPlan.ts` maps `AdjustmentLayerState` → `AdjustmentRenderOp`. Open `src/ux/main/Canvas/canvasPlan.ts` and add a case in `buildAdjustmentEntry`:

```typescript
export function buildAdjustmentEntry(
  ls: AdjustmentLayerState,
  mask: GpuLayer | undefined,
  swatches: RGBAColor[],
): AdjustmentRenderOp | null {
  // ... existing cases ...
  if (ls.adjustmentType === 'posterize') {
    return {
      kind: 'posterize',
      layerId: ls.id,
      levels: ls.params.levels,
      visible: ls.visible,
      selMaskLayer: mask,
    }
  }
  // Must remain exhaustive — TypeScript will error if a type is missing
  const _exhaustive: never = ls
  return _exhaustive
}
```

This is the bridge between the React state world (`AdjustmentLayerState`) and the GPU world (`AdjustmentRenderOp`). The render plan is rebuilt on every frame by `buildRenderPlan`, so parameter changes immediately flow to the GPU.

---

## Step 8: Ensure the unified rasterization pipeline handles it

`src/graphicspipeline/rasterization/GpuRasterPipeline.ts` calls `AdjustmentEncoder.encodeAdjustment` with the same plan. If your new `AdjustmentRenderOp` variant is included in the `encodeAdjustment` switch statement (step 5 above), rasterization automatically works for flatten, merge, and export. **No additional code is needed** — this is the whole point of the unified pipeline.

---

## Step 9: Create the floating panel component

The panel is a React component rendered inside the floating `ToolWindow` frame when the adjustment layer is open. It reads the current params from the layer state and dispatches `UPDATE_ADJUSTMENT_LAYER` to change them.

Create `src/ux/windows/adjustments/PosterizePanel/PosterizePanel.tsx`:

```typescript
import React from 'react'
import { useAppContext } from '@/core/store/AppContext'
import type { PosterizeAdjustmentLayer } from '@/types'
import styles from './PosterizePanel.module.scss'

interface PosteizePanelProps {
  layer: PosterizeAdjustmentLayer
  parentLayerName: string
}

export function PosterizePanel({ layer, parentLayerName }: PosterizePanelProps): React.JSX.Element {
  const { dispatch } = useAppContext()
  const { levels } = layer.params

  const pct = (v: number, min: number, max: number): string =>
    String((v - min) / (max - min))

  const update = (levels: number): void => {
    dispatch({
      type: 'UPDATE_ADJUSTMENT_LAYER',
      payload: { ...layer, params: { levels } },
    })
  }

  return (
    <div className={styles.content}>
      <div className={styles.row}>
        <span className={styles.label}>Levels</span>
        <div className={styles.trackWrap}>
          <input
            type="range"
            className={styles.track}
            min={2} max={32} step={1}
            value={levels}
            style={{ '--pct': pct(levels, 2, 32) } as React.CSSProperties}
            onChange={e => update(Number(e.target.value))}
          />
        </div>
        <input
          type="number"
          className={styles.numInput}
          min={2} max={32} step={1}
          value={levels}
          onChange={e => {
            const v = e.target.valueAsNumber
            if (!isNaN(v)) update(Math.round(Math.min(32, Math.max(2, v))))
          }}
        />
      </div>
      <div className={styles.footer}>
        <span className={styles.footerInfo}>
          Adjusting <strong>{parentLayerName}</strong>
        </span>
        <button
          className={styles.resetBtn}
          onClick={() => update(4)}
          title="Reset to defaults"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
```

Create the accompanying `PosterizePanel.module.scss`. Follow the exact same structure as `BrightnessContrastPanel.module.scss` — the visual design is consistent across all panels.

**Why does changing a slider update the canvas immediately?**

1. `dispatch({ type: 'UPDATE_ADJUSTMENT_LAYER', payload: ... })` updates `AppState.layers`.
2. `Canvas.tsx` has a `useEffect` that depends on `state.layers`. When it fires, it calls `buildRenderPlan(state.layers, ...)`.
3. The new plan has the updated `levels` value in the `posterize` render op.
4. `renderer.renderPlan(plan)` runs, calling `adjustmentEncoder.encodeAdjustment(...)` with the new uniform.
5. The compute shader writes a new texture with the updated posterize levels.
6. The result is composited and shown on screen — all within the same animation frame.

---

## Step 10: Wire the panel into `ToolWindow.tsx`

The floating panel manager (`src/ux/windows/ToolWindow.tsx` or `AdjustmentPanel.tsx` — check the current file) renders the correct panel for `state.openAdjustmentLayerId`. Add a case:

```typescript
import { PosterizePanel } from './adjustments/PosterizePanel/PosterizePanel'

// In the switch/if block that selects which panel to render:
if (layer.adjustmentType === 'posterize') {
  return (
    <PosterizePanel
      layer={layer as PosterizeAdjustmentLayer}
      parentLayerName={parentLayer?.name ?? ''}
    />
  )
}
```

---

## Step 11: Export the panel component

Add it to `src/ux/index.ts`:

```typescript
export { PosterizePanel } from './windows/adjustments/PosterizePanel/PosterizePanel'
```

---

## Step 12: Add the `AdjustmentLayerState` interface

Back in `src/types/index.ts`, add the concrete layer state interface:

```typescript
export interface PosterizeAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'posterize'
  params: AdjustmentParamsMap['posterize']
  hasMask: boolean
}

// Add to the AdjustmentLayerState union:
export type AdjustmentLayerState =
  | BrightnessContrastAdjustmentLayer
  | /* ... other variants ... */
  | PosterizeAdjustmentLayer
```

---

## Selection masks

Adjustment layers support being applied to only a portion of the parent layer using a selection mask. When the user has an active selection when they add the adjustment, `handleCreateAdjustmentLayer` captures `selectionStore.mask` and calls `registerAdjMask(newLayerId, maskPixels)`. This bakes the selection into a `GpuLayer` stored in `adjustmentMaskMap`.

In `buildAdjustmentEntry`, the `mask` parameter (the `GpuLayer` from `adjustmentMaskMap`) is passed directly into the `AdjustmentRenderOp` as `selMaskLayer`. The encoder uses this to apply the adjustment only within the masked region.

You don't need to do anything special to support masks — as long as you pass `selMaskLayer` into your `AdjustmentRenderOp`, the encoder handles it.

---

## Complete checklist

- [ ] Add `'posterize'` to `AdjustmentType` union in `src/types/index.ts`
- [ ] Add `AdjustmentParamsMap['posterize']` entry in `src/types/index.ts`
- [ ] Add `PosterizeAdjustmentLayer` interface and add it to `AdjustmentLayerState` union
- [ ] Add registry entry in `src/core/operations/adjustments/registry.ts`
- [ ] Write WGSL shader in `AdjustmentEncoder.ts` (constant string)
- [ ] Add pipeline field + constructor init in `AdjustmentEncoder`
- [ ] Add `runPosterize()` method in `AdjustmentEncoder`
- [ ] Add `{ kind: 'posterize', ... }` to `AdjustmentRenderOp` union
- [ ] Add case in `AdjustmentEncoder.encodeAdjustment()` switch
- [ ] Add case in `canvasPlan.ts` `buildAdjustmentEntry()`
- [ ] Create `PosterizePanel/PosterizePanel.tsx` + `.module.scss`
- [ ] Wire panel in `ToolWindow.tsx` / `AdjustmentPanel.tsx`
- [ ] Export from `src/ux/index.ts`
