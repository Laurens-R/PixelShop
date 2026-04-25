# Adding a New Real-Time Effect

Real-time effects are non-destructive like adjustment layers — they live in the layer stack, are re-evaluated every frame, and never mutate pixels. The difference is their purpose and menu location: effects produce stylistic results (bloom, glow, outline, chromatic aberration) rather than tonal corrections.

Mechanically, adding an effect is almost identical to adding an adjustment layer (see [adding-an-adjustment-layer.md](adding-an-adjustment-layer.md)). This guide covers the differences and extra considerations specific to effects.

We'll use a hypothetical **Vignette** effect as the running example — a radial darkening around the image edges.

---

## How effects differ from adjustment layers

| Property | Adjustment Layer | Real-Time Effect |
|---|---|---|
| Registry `group` | `'color-adjustments'` | `'real-time-effects'` |
| Top menu location | **Adjustments** | **Effects** |
| Panel component path | `ux/windows/adjustments/` | `ux/windows/effects/` |
| Component naming | `<TypeName>Panel` | `<TypeName>Options` |
| Typical complexity | Single compute pass | Often multi-pass (extract → process → composite) |

Both use `AdjustmentLayerState`, `AdjustmentRenderOp`, `AdjustmentEncoder`, and `canvasPlan.ts`. The codebase makes no internal distinction — the `group` field controls only where the type appears in menus.

---

## Step 1: Add the type to `AdjustmentType` and `AdjustmentParamsMap`

Open `src/types/index.ts`:

```typescript
export type AdjustmentType =
  | 'bloom' | 'chromatic-aberration' | 'drop-shadow' | /* ... */
  | 'vignette'   // ← add here

export interface AdjustmentParamsMap {
  // ...
  'vignette': {
    strength:  number  // 0–100
    softness:  number  // 0–100
    roundness: number  // 0–100
  }
}
```

Add the concrete `VignetteAdjustmentLayer` interface and add it to `AdjustmentLayerState`:

```typescript
export interface VignetteAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'vignette'
  params: AdjustmentParamsMap['vignette']
  hasMask: boolean
}

export type AdjustmentLayerState =
  | /* ... existing variants ... */
  | VignetteAdjustmentLayer
```

---

## Step 2: Register with `group: 'real-time-effects'`

Open `src/core/operations/adjustments/registry.ts`:

```typescript
{
  adjustmentType: 'vignette' as const,
  label: 'Vignette…',
  group: 'real-time-effects',
  defaultParams: { strength: 50, softness: 70, roundness: 60 },
},
```

This entry will automatically appear in the **Effects** menu because `TopBar.tsx` filters the registry by `group`.

---

## Step 3: Write the WGSL compute shader

Vignette is a single-pass effect: for each pixel, compute the distance from the image center, apply a smooth falloff, and darken accordingly.

In `AdjustmentEncoder.ts`:

```typescript
const VIGNETTE_COMPUTE = /* wgsl */`
  @group(0) @binding(0) var src:    texture_2d<f32>;
  @group(0) @binding(1) var dst:    texture_storage_2d<rgba16float, write>;
  @group(0) @binding(2) var<uniform> u: Params;

  struct Params {
    strength:  f32,
    softness:  f32,
    roundness: f32,
    _pad:      f32,  // pad to 16 bytes
  }

  @compute @workgroup_size(8, 8)
  fn cs_vignette(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims    = textureDimensions(src);
    if (gid.x >= dims.x || gid.y >= dims.y) { return; }

    let px      = textureLoad(src, vec2<i32>(gid.xy), 0);

    // Normalized coordinates in [-1, 1]
    let uv      = (vec2<f32>(gid.xy) / vec2<f32>(dims) - 0.5) * 2.0;

    // Aspect-correct radius based on roundness
    let aspect  = f32(dims.x) / f32(dims.y);
    let r       = u.roundness / 100.0;
    let d       = length(vec2<f32>(uv.x, uv.y / mix(1.0, aspect, r)));

    // Smooth vignette mask
    let inner   = 1.0 - u.softness / 100.0;
    let mask    = 1.0 - smoothstep(inner, 1.0, d);

    let s       = u.strength / 100.0;
    let factor  = 1.0 - s * (1.0 - mask);

    textureStore(dst, vec2<i32>(gid.xy), vec4<f32>(px.rgb * factor, px.a));
  }
`
```

### Multi-pass effects

More complex effects like bloom need multiple passes:

1. **Extract** — isolate bright pixels above a threshold
2. **Blur** — apply a Gaussian blur to the extracted mask
3. **Composite** — add-blend the blurred mask onto the source

Implement each pass as a separate private method (`runBloomExtract`, `runBloomBlur`, `runBloomComposite`) and call them in sequence from `encodeAdjustment`. Use intermediate textures (created once in the constructor and sized to the canvas) to pass data between passes. Example:

```typescript
// In AdjustmentEncoder constructor:
this.bloomIntermediateA = device.createTexture({
  size: [pixelWidth, pixelHeight],
  format: 'rgba16float',
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
})

// In encodeAdjustment:
case 'bloom':
  this.runBloomExtract(encoder, src, this.bloomIntermediateA, op)
  this.runBloomBlur(encoder, this.bloomIntermediateA, this.bloomIntermediateB, op)
  this.runBloomComposite(encoder, src, this.bloomIntermediateB, dst, op)
  break
```

---

## Step 4: Create the pipeline and dispatch method

In `AdjustmentEncoder.ts`:

```typescript
// Field:
private readonly vignettePipeline: GPUComputePipeline

// Constructor:
this.vignettePipeline = createComputePipeline(device, VIGNETTE_COMPUTE, 'cs_vignette')

// Method:
runVignette(
  encoder: GPUCommandEncoder,
  src: GPUTexture,
  dst: GPUTexture,
  params: { strength: number; softness: number; roundness: number },
): void {
  // 4 floats × 4 bytes = 16 bytes
  const uniforms = new Float32Array([params.strength, params.softness, params.roundness, 0])

  const uniformBuf = this.device.createBuffer({
    size: uniforms.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  this.device.queue.writeBuffer(uniformBuf, 0, uniforms)

  const bindGroup = this.device.createBindGroup({
    layout: this.vignettePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: src.createView() },
      { binding: 1, resource: dst.createView() },
      { binding: 2, resource: { buffer: uniformBuf } },
    ],
  })

  const pass = encoder.beginComputePass()
  pass.setPipeline(this.vignettePipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(
    Math.ceil(this.pixelWidth  / 8),
    Math.ceil(this.pixelHeight / 8),
  )
  pass.end()
}
```

---

## Step 5: Add the `AdjustmentRenderOp` variant

```typescript
export type AdjustmentRenderOp =
  | /* ... existing ... */
  | {
      kind: 'vignette'
      layerId: string
      strength: number
      softness: number
      roundness: number
      visible: boolean
      selMaskLayer?: GpuLayer
    }
```

Add the case to `encodeAdjustment`:

```typescript
case 'vignette':
  this.runVignette(encoder, src, dst, op)
  break
```

---

## Step 6: Map in `canvasPlan.ts`

```typescript
if (ls.adjustmentType === 'vignette') {
  return {
    kind: 'vignette',
    layerId: ls.id,
    strength:  ls.params.strength,
    softness:  ls.params.softness,
    roundness: ls.params.roundness,
    visible: ls.visible,
    selMaskLayer: mask,
  }
}
```

---

## Step 7: Create the options component

Effects use an **Options** component (not Panel), located in `src/ux/windows/effects/`:

Create `src/ux/windows/effects/VignetteOptions/VignetteOptions.tsx`:

```typescript
import React from 'react'
import { useAppContext } from '@/core/store/AppContext'
import type { VignetteAdjustmentLayer } from '@/types'
import styles from './VignetteOptions.module.scss'

interface Props {
  layer: VignetteAdjustmentLayer
}

export function VignetteOptions({ layer }: Props): React.JSX.Element {
  const { dispatch } = useAppContext()
  const { strength, softness, roundness } = layer.params

  const update = (partial: Partial<typeof layer.params>): void => {
    dispatch({
      type: 'UPDATE_ADJUSTMENT_LAYER',
      payload: { ...layer, params: { ...layer.params, ...partial } },
    })
  }

  return (
    <div className={styles.content}>
      <div className={styles.row}>
        <label>Strength</label>
        <input type="range" min={0} max={100} value={strength}
          onChange={e => update({ strength: Number(e.target.value) })} />
        <span>{strength}%</span>
      </div>
      <div className={styles.row}>
        <label>Softness</label>
        <input type="range" min={0} max={100} value={softness}
          onChange={e => update({ softness: Number(e.target.value) })} />
        <span>{softness}%</span>
      </div>
      <div className={styles.row}>
        <label>Roundness</label>
        <input type="range" min={0} max={100} value={roundness}
          onChange={e => update({ roundness: Number(e.target.value) })} />
        <span>{roundness}%</span>
      </div>
    </div>
  )
}
```

Create `VignetteOptions.module.scss` following the same structure as `BloomOptions.module.scss`.

---

## Step 8: Wire the component into the floating window

In `ToolWindow.tsx` (or wherever effects are mounted), add:

```typescript
import { VignetteOptions } from './effects/VignetteOptions/VignetteOptions'

// In the render switch:
if (layer.adjustmentType === 'vignette') {
  return <VignetteOptions layer={layer as VignetteAdjustmentLayer} />
}
```

---

## Step 9: Export from the barrel

```typescript
// src/ux/index.ts
export { VignetteOptions } from './windows/effects/VignetteOptions/VignetteOptions'
```

---

## Rasterization

Because effects go through the same `encodeAdjustment` path as adjustments, the unified rasterization pipeline (`rasterizeDocument`) automatically handles them for flatten, merge, and export. No additional changes are needed.

---

## Performance tips for effects

Effects run on every frame during compositing. Keep them fast:

- **Avoid per-frame buffer allocations.** Pre-allocate uniform buffers in the constructor and use `writeBuffer` to update their contents — buffer creation is ~100× more expensive than writing.
- **Use ping-pong textures for multi-pass effects.** Pre-allocate `intermediateA` and `intermediateB` at canvas size in the constructor; don't create them per-frame.
- **Separate resolution for blurs.** Blur passes (bloom, glow) can be run at half or quarter resolution and upscaled. This cuts compute cost by 4× or 16× with minimal quality loss.

Example of a pre-allocated uniform buffer pattern:

```typescript
// Constructor:
this.vignetteUniformBuf = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})

// Per-frame in runVignette:
const uniforms = new Float32Array([params.strength, params.softness, params.roundness, 0])
this.device.queue.writeBuffer(this.vignetteUniformBuf, 0, uniforms)
// (no createBuffer call here)
```

---

## Complete checklist

- [ ] Add `'vignette'` to `AdjustmentType` union in `src/types/index.ts`
- [ ] Add `AdjustmentParamsMap['vignette']` entry
- [ ] Add `VignetteAdjustmentLayer` interface + add to `AdjustmentLayerState` union
- [ ] Register in `src/core/operations/adjustments/registry.ts` with `group: 'real-time-effects'`
- [ ] Write WGSL shader(s) in `AdjustmentEncoder.ts`
- [ ] Add pipeline field(s) + constructor init
- [ ] Add `runVignette()` method (or multi-pass methods)
- [ ] Add `{ kind: 'vignette', ... }` to `AdjustmentRenderOp` union
- [ ] Add case in `encodeAdjustment()` switch
- [ ] Add case in `canvasPlan.ts` `buildAdjustmentEntry()`
- [ ] Create `VignetteOptions/VignetteOptions.tsx` + `.module.scss`
- [ ] Wire component in `ToolWindow.tsx`
- [ ] Export from `src/ux/index.ts`
