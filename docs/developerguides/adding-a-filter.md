# Adding a New Filter

Filters are **destructive one-shot operations** applied to the active pixel layer. Unlike adjustment layers, they permanently modify pixel data. Filters typically open a dialog with a live preview, and when the user clicks Apply the operation is committed to the layer and a history entry is created.

This guide uses a hypothetical **Pixelate** filter as the running example — a mosaic/block effect that groups pixels into uniform-colored squares.

---

## How filters work

```
User clicks Filters → Pixelate…
  ↓
TopBar.tsx dispatches 'openFilter' action → App.tsx sets showPixelateDialog = true
  ↓
<PixelateDialog> mounts with access to the canvas handle
  ↓
On dialog open: snapshot originalPixels from renderer (pre-filter state)
  ↓
User adjusts slider → debounced preview:
    filterCompute.pixelate(snapshot, w, h, blockSize)
    → apply selection composite
    → handle.writeLayerPixels(preview)
    → render()
  ↓
User clicks Apply:
    filterCompute.pixelate(snapshot, w, h, blockSize)
    → apply selection composite
    → handle.writeLayerPixels(final)
    → captureHistory('Pixelate')
    → onClose()
  ↓
User clicks Cancel:
    handle.writeLayerPixels(snapshot)   ← restore original
    → render()
    → onClose()
```

The preview writes pixels directly to the layer without capturing history. Only Apply captures a history entry. The snapshot taken on open is used for cancel restoration and for debounced re-preview when the user changes params (always re-apply to the original snapshot, not to the already-modified layer).

---

## Step 1: Add the `FilterKey` to `src/types/index.ts`

```typescript
export type FilterKey =
  | 'gaussian-blur'
  | /* ... existing filters ... */
  | 'pixelate'   // ← add here
```

TypeScript will error at every exhaustive check until you add all the downstream cases.

---

## Step 2: Register in the filter registry

Open `src/core/operations/filters/registry.ts`:

```typescript
export const FILTER_REGISTRY: FilterRegistryEntry[] = [
  // ...
  {
    key: 'pixelate' as FilterKey,
    label: 'Pixelate…',
    group: 'stylize',        // group determines submenu in the Filters menu
    instant: false,          // false = opens a dialog; true = applies immediately
  },
]
```

- `instant: true` — no dialog; the filter applies immediately with default settings. Use this for one-click operations like Auto Enhance or Desaturate.
- `instant: false` — opens a dialog. This is the standard pattern.

---

## Step 3: Implement the GPU compute pass

Open `src/graphicspipeline/webgpu/compute/filterCompute.ts`. This file contains the `FilterComputeEngine` class plus exported convenience functions. Add the WGSL shader and implementation:

```typescript
const PIXELATE_COMPUTE = /* wgsl */`
  @group(0) @binding(0) var<storage, read>       src:    array<u32>;
  @group(0) @binding(1) var<storage, read_write>  dst:    array<u32>;
  @group(0) @binding(2) var<uniform>              u:      Params;

  struct Params {
    width:     u32,
    height:    u32,
    blockSize: u32,
    _pad:      u32,
  }

  fn unpack(px: u32) -> vec4<f32> {
    return vec4<f32>(
      f32((px >>  0u) & 0xFFu) / 255.0,
      f32((px >>  8u) & 0xFFu) / 255.0,
      f32((px >> 16u) & 0xFFu) / 255.0,
      f32((px >> 24u) & 0xFFu) / 255.0,
    );
  }
  fn pack(c: vec4<f32>) -> u32 {
    return (u32(c.r * 255.0)       |
            u32(c.g * 255.0) <<  8u |
            u32(c.b * 255.0) << 16u |
            u32(c.a * 255.0) << 24u);
  }

  @compute @workgroup_size(8, 8)
  fn cs_pixelate(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= u.width || gid.y >= u.height) { return; }

    // Find the top-left corner of the block this pixel belongs to
    let bx = (gid.x / u.blockSize) * u.blockSize;
    let by = (gid.y / u.blockSize) * u.blockSize;

    // Average all pixels in the block
    var sum = vec4<f32>(0.0);
    var count = 0u;
    for (var dy = 0u; dy < u.blockSize; dy++) {
      for (var dx = 0u; dx < u.blockSize; dx++) {
        let sx = min(bx + dx, u.width  - 1u);
        let sy = min(by + dy, u.height - 1u);
        sum += unpack(src[sy * u.width + sx]);
        count++;
      }
    }
    let avg = sum / f32(count);
    dst[gid.y * u.width + gid.x] = pack(avg);
  }
`

export async function pixelate(
  pixels: Uint8Array,
  width:  number,
  height: number,
  blockSize: number,
): Promise<Uint8Array> {
  const device   = await getGpuDevice()  // shared device accessor
  const byteSize = width * height * 4

  // Upload source pixels
  const srcBuf = device.createBuffer({
    size:  byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(srcBuf, 0, pixels)

  // Create output buffer
  const dstBuf = device.createBuffer({
    size:  byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })

  // Uniforms
  const uniformData = new Uint32Array([width, height, Math.max(1, blockSize), 0])
  const uniformBuf  = device.createBuffer({
    size:  uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(uniformBuf, 0, uniformData)

  const pipeline  = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module:     device.createShaderModule({ code: PIXELATE_COMPUTE }),
      entryPoint: 'cs_pixelate',
    },
  })

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: srcBuf } },
      { binding: 1, resource: { buffer: dstBuf } },
      { binding: 2, resource: { buffer: uniformBuf } },
    ],
  })

  const encoder = device.createCommandEncoder()
  const pass    = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8))
  pass.end()

  // Read back results
  const readBuf = device.createBuffer({
    size:  byteSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })
  encoder.copyBufferToBuffer(dstBuf, 0, readBuf, 0, byteSize)
  device.queue.submit([encoder.finish()])

  await readBuf.mapAsync(GPUMapMode.READ)
  const result = new Uint8Array(readBuf.getMappedRange().slice(0))
  readBuf.unmap()

  srcBuf.destroy()
  dstBuf.destroy()
  uniformBuf.destroy()
  readBuf.destroy()

  return result
}
```

### Should the filter use GPU or WASM?

- **GPU (WebGPU):** Use for spatially parallelisable operations (blur, sharpen, pixelate, color transforms). Fast for large images.
- **WASM (C++):** Use for sequential algorithms (flood fill, path tracing, AI-based inpainting, operations that require reading output pixels as inputs to the next pixel). WASM can call back into JavaScript, GPU cannot.

Many blur/sharpen filters already exist as exported functions in `filterCompute.ts`. Check there before adding a new one.

---

## Step 4: Create the filter dialog

Create `src/ux/windows/filters/PixelateDialog/PixelateDialog.tsx`:

```typescript
import React, { useCallback, useEffect, useRef } from 'react'
import { ModalDialog, DialogButton } from '@/ux'
import type { CanvasHandle } from '@/types'
import { selectionStore } from '@/core/store/selectionStore'
import { pixelate } from '@/graphicspipeline/webgpu/compute/filterCompute'
import { applySelectionComposite } from '@/utils/selectionUtils'
import styles from './PixelateDialog.module.scss'

interface Props {
  open:          boolean
  canvasHandle:  CanvasHandle | null
  onClose():     void
}

export function PixelateDialog({ open, canvasHandle, onClose }: Props): React.JSX.Element | null {
  const [blockSize, setBlockSize] = React.useState(10)
  const [isApplying, setIsApplying] = React.useState(false)

  // Snapshots taken when the dialog opens — never modified by preview.
  const originalPixelsRef = useRef<Uint8Array | null>(null)
  const selectionMaskRef  = useRef<Uint8Array | null>(null)
  const debounceRef       = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Snapshot original state when dialog opens.
  useEffect(() => {
    if (!open || !canvasHandle) return
    originalPixelsRef.current = canvasHandle.readLayerPixels()
    selectionMaskRef.current  = selectionStore.mask?.slice() ?? null
  }, [open, canvasHandle])

  // Debounced preview — re-apply to original snapshot on every param change.
  const runPreview = useCallback((size: number): void => {
    const original = originalPixelsRef.current
    if (!original || !canvasHandle) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const { width, height } = canvasHandle.layerSize()
      const result = await pixelate(original.slice(), width, height, size)
      const composited = applySelectionComposite(result, original, selectionMaskRef.current)
      canvasHandle.writeLayerPixels(composited)
      canvasHandle.render()
    }, 80)  // 80 ms debounce — responsive without thrashing the GPU
  }, [canvasHandle])

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = Number(e.target.value)
    setBlockSize(value)
    runPreview(value)
  }

  const handleApply = async (): Promise<void> => {
    const original = originalPixelsRef.current
    if (!original || !canvasHandle) { onClose(); return }

    setIsApplying(true)
    const { width, height } = canvasHandle.layerSize()
    const result = await pixelate(original.slice(), width, height, blockSize)
    const composited = applySelectionComposite(result, original, selectionMaskRef.current)
    canvasHandle.writeLayerPixels(composited)
    canvasHandle.captureHistory('Pixelate')
    canvasHandle.render()
    setIsApplying(false)
    onClose()
  }

  const handleCancel = (): void => {
    // Restore original pixels — cancel must not leave a preview in place.
    if (originalPixelsRef.current && canvasHandle) {
      canvasHandle.writeLayerPixels(originalPixelsRef.current)
      canvasHandle.render()
    }
    onClose()
  }

  return (
    <ModalDialog
      open={open}
      title="Pixelate"
      width={360}
      onClose={handleCancel}
    >
      <div className={styles.body}>
        <div className={styles.row}>
          <label htmlFor="block-size">Block Size</label>
          <input
            id="block-size"
            type="range" min={1} max={64} step={1}
            value={blockSize}
            onChange={handleSliderChange}
          />
          <span>{blockSize}px</span>
        </div>
      </div>
      <div className={styles.actions}>
        <DialogButton variant="secondary" onClick={handleCancel} disabled={isApplying}>
          Cancel
        </DialogButton>
        <DialogButton variant="primary" onClick={handleApply} disabled={isApplying}>
          {isApplying ? 'Applying…' : 'Apply'}
        </DialogButton>
      </div>
    </ModalDialog>
  )
}
```

### Key dialog patterns

**Always snapshot on open, never on apply.** If you snapshot in `handleApply`, repeated preview passes have already modified the layer and the "original" is the last preview, not the real original.

**Re-apply to the snapshot, not to the current layer.** The slider changes call `pixelate(original.slice(), ...)`. If you applied to the already-previewed layer, you'd be compounding the effect.

**`applySelectionComposite` before writing.** This ensures the filter only modifies the selected area and leaves masked-out pixels untouched.

**Debounce the preview.** 80 ms is a good default — fast enough to feel responsive, slow enough to avoid queuing 10 GPU dispatches in one drag gesture.

**Cancel must restore.** If the user moved a slider (triggering preview), `handleCancel` must restore the original snapshot.

---

## Step 5: Create the dialog SCSS

Create `src/ux/windows/filters/PixelateDialog/PixelateDialog.module.scss`. Follow the structure of `GaussianBlurDialog.module.scss` for consistent visual design:

```scss
.body {
  padding: 16px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;

  label {
    min-width: 80px;
    font-size: 12px;
    color: var(--label-color);
  }

  input[type='range'] {
    flex: 1;
  }

  span {
    min-width: 36px;
    text-align: right;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
}
```

---

## Step 6: Export the dialog

```typescript
// src/ux/index.ts
export { PixelateDialog } from './windows/filters/PixelateDialog/PixelateDialog'
```

---

## Step 7: Add dialog state in `App.tsx`

```typescript
// Near other showXxxDialog state:
const [showPixelateDialog, setShowPixelateDialog] = React.useState(false)
```

Mount the dialog in the render output:

```typescript
<PixelateDialog
  open={showPixelateDialog}
  canvasHandle={canvasHandleRef.current}
  onClose={() => setShowPixelateDialog(false)}
/>
```

---

## Step 8: Open the dialog from `useFilters`

In `src/core/services/useFilters.ts`, add a case:

```typescript
// In the handleFilterAction (or equivalent) function:
case 'pixelate':
  setShowPixelateDialog(true)   // callback prop passed into the hook
  break
```

If the filter is `instant: true`, apply it directly here without opening a dialog:

```typescript
case 'auto-enhance':
  const { pixels, width, height } = await canvasHandle.readLayerPixelsAsync()
  const result = await autoEnhance(pixels, width, height)
  canvasHandle.writeLayerPixels(result)
  canvasHandle.captureHistory('Auto Enhance')
  canvasHandle.render()
  break
```

---

## Step 9: Add to the Filters menu in `TopBar.tsx`

`TopBar.tsx` builds the Filters menu from `FILTER_REGISTRY` — if you registered the filter in step 2, it automatically appears in the correct group/submenu. Verify by inspecting the `filterMenuItems` construction in `TopBar.tsx`.

If your filter has a custom submenu that isn't covered by the registry's `group` field, you may need to add a dedicated `MenuItem` manually.

---

## Step 10: Add to the macOS native menu in `App.tsx`

Find the `macMenuHandlerRef` switch block in `App.tsx` (or `useMenuBar.ts`). Add a case:

```typescript
case 'pixelate':
  setShowPixelateDialog(true)
  break
```

The macOS native menu handler fires when the user clicks the native menu bar on macOS. It must stay in sync with the `TopBar.tsx` menu.

---

## Instant filters (no dialog)

Some filters apply with no user input. Register them with `instant: true` and handle them entirely inside `useFilters`:

```typescript
// registry.ts:
{ key: 'invert', label: 'Invert', group: 'color', instant: true }

// useFilters.ts:
case 'invert':
  const result = await runInvert(canvasHandle.readLayerPixels(), w, h)
  canvasHandle.writeLayerPixels(result)
  canvasHandle.captureHistory('Invert')
  canvasHandle.render()
  break
```

No dialog, no state, no component — just a function call.

---

## Using WASM instead of GPU

For a CPU-bound filter, replace the `pixelate(...)` call with a WASM operation:

```typescript
import { getPixelOps } from '@/wasm'

export async function pixelateWasm(pixels: Uint8Array, width: number, height: number, blockSize: number): Promise<Uint8Array> {
  const m   = await getPixelOps()
  const len = pixels.byteLength
  const ptr = m._malloc(len)
  m.HEAPU8.set(pixels, ptr)

  m._pixelate(ptr, width, height, blockSize)

  // Re-read HEAPU8 after call — memory may have grown
  const result = m.HEAPU8.slice(ptr, ptr + len)
  m._free(ptr)
  return result
}
```

The C++ implementation goes in `wasm/src/` following the process documented in [dev-environment-setup.md](dev-environment-setup.md#adding-a-new-wasm-operation).

---

## Complete checklist

- [ ] Add `'pixelate'` to `FilterKey` union in `src/types/index.ts`
- [ ] Register in `src/core/operations/filters/registry.ts`
- [ ] Implement compute function in `filterCompute.ts` (or WASM wrapper in `src/wasm/index.ts`)
- [ ] Create `PixelateDialog/PixelateDialog.tsx` + `.module.scss`
  - [ ] Snapshot `originalPixels` + `selectionMask` on `open`
  - [ ] Debounced preview re-applied to original snapshot
  - [ ] `applySelectionComposite` before `writeLayerPixels`
  - [ ] Apply: write + `captureHistory` + `onClose`
  - [ ] Cancel: restore original + `render` + `onClose`
- [ ] Export from `src/ux/index.ts`
- [ ] Add `showPixelateDialog` state in `App.tsx`
- [ ] Mount `<PixelateDialog>` in `App.tsx` render output
- [ ] Add case in `useFilters.ts`
- [ ] Verify filter appears in Filters menu via `FILTER_REGISTRY` in `TopBar.tsx`
- [ ] Add case in macOS native menu handler in `App.tsx`
