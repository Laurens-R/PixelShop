# Technical Design: Color Key

## Overview

The Color Key adjustment layer performs non-destructive chroma keying on its parent pixel layer. Pixels whose HSV-space distance from a chosen key color falls within a configurable tolerance band are made fully transparent; pixels in a soft-edge transition zone receive partial transparency proportional to their distance from the hard boundary. The feature follows the established adjustment layer pattern exactly: a new `ColorKeyAdjustmentLayer` state type, a WGSL compute shader, an `AdjustmentRenderOp` variant wired into `WebGPURenderer.ts`, a registry entry, and a React panel component. Flatten/merge/export coverage is automatic because `GpuRasterPipeline.ts` delegates to `renderer.readFlattenedPlan`, which runs through the same `encodeAdjustmentOp` path as the live canvas preview.

---

## Affected Areas

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `'color-key'` to `AdjustmentType`; add `'color-key'` entry to `AdjustmentParamsMap`; add `ColorKeyAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Append `color-key` registry entry |
| `src/webgpu/shaders/adjustments/color-key.ts` | **New file** — WGSL compute shader |
| `src/webgpu/shaders.ts` | Re-export `CK_COMPUTE` from the new shader file |
| `src/webgpu/WebGPURenderer.ts` | Add `'color-key'` variant to `AdjustmentRenderOp`; add `ckPipeline` field; initialize in constructor; add dispatch branch in `encodeAdjustmentOp` |
| `src/components/window/Canvas/canvasPlan.ts` | Add `'color-key'` branch in `buildAdjustmentEntry` |
| `src/components/panels/ColorKeyPanel/ColorKeyPanel.tsx` | **New file** — React panel component |
| `src/components/panels/ColorKeyPanel/ColorKeyPanel.module.scss` | **New file** — Panel styles |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Import `ColorKeyPanel`; add title, header icon, and conditional render |
| `src/components/index.ts` | Export `ColorKeyPanel` |
| `src/rasterization/GpuRasterPipeline.ts` | **No changes needed** — new type flows through automatically |

---

## State Changes

### `src/types/index.ts`

**1. Extend `AdjustmentType`:**
```typescript
export type AdjustmentType =
  | 'brightness-contrast'
  | /* ... all existing ... */
  | 'halation'
  | 'color-key'            // ← add
```

**2. Add entry to `AdjustmentParamsMap`:**
```typescript
'color-key': {
  /** Key color as sRGB bytes (0–255). */
  keyColor:  { r: number; g: number; b: number }
  /** Pixels with HSV distance ≤ tolerance are fully transparent. Range 0–100. */
  tolerance: number
  /** Width of the soft-edge transition zone beyond the tolerance boundary. Range 0–100. */
  softness:  number
}
```

**3. New interface:**
```typescript
export interface ColorKeyAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'color-key'
  params: AdjustmentParamsMap['color-key']
  /** True when a selection was active at creation time; baked mask pixels live
   *  in Canvas adjustmentMaskMap, not in React state. */
  hasMask: boolean
}
```

**4. Extend `AdjustmentLayerState`:**
```typescript
export type AdjustmentLayerState =
  | BrightnessContrastAdjustmentLayer
  | /* ... all existing ... */
  | HalationAdjustmentLayer
  | ColorKeyAdjustmentLayer     // ← add
```

No changes to `AppState` or the reducer are required — `ADD_ADJUSTMENT_LAYER` and `UPDATE_ADJUSTMENT_LAYER` both accept `AdjustmentLayerState`.

---

## New Components / Hooks / Tools

### `src/webgpu/shaders/adjustments/color-key.ts`
**Category:** WebGPU shader module.  
**Responsibility:** WGSL compute kernel that applies chroma keying per pixel. Imports `MASK_FLAGS_STRUCT` from `./helpers`.

### `src/components/panels/ColorKeyPanel/ColorKeyPanel.tsx`
**Category:** Panel.  
**Responsibility:** UI for editing the three Color Key params. Receives a typed layer prop from `AdjustmentPanel`; dispatches `UPDATE_ADJUSTMENT_LAYER` on every change; never reads `AppContext` state directly.  
**Props:** `layer: ColorKeyAdjustmentLayer`, `parentLayerName: string`.

---

## Implementation Steps

### Step 1 — Add types: `src/types/index.ts`

Apply the four additions described in [State Changes](#state-changes). No other lines in the file change.

---

### Step 2 — Add registry entry: `src/adjustments/registry.ts`

Append to the `ADJUSTMENT_REGISTRY` array, before the closing `] as const satisfies ...`:

```typescript
{
  adjustmentType: 'color-key' as const,
  label: 'Color Key…',
  defaultParams: { keyColor: { r: 0, g: 255, b: 0 }, tolerance: 0, softness: 0 },
  group: 'color-adjustments',
},
```

---

### Step 3 — Write the WGSL shader: `src/webgpu/shaders/adjustments/color-key.ts`

Create the file with the following content:

```typescript
import { MASK_FLAGS_STRUCT } from './helpers'

export const CK_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}

// ── RGB → HSV conversion (H in 0..1) ────────────────────────────────────────
fn rgb2hsv(c: vec3f) -> vec3f {
  let maxC  = max(c.r, max(c.g, c.b));
  let minC  = min(c.r, min(c.g, c.b));
  let delta = maxC - minC;
  let v = maxC;
  var s = 0.0f;
  var h = 0.0f;
  if (delta > 0.00001) {
    s = delta / maxC;
    if (maxC == c.r) {
      h = (c.g - c.b) / delta;
      h = h - floor(h / 6.0) * 6.0;
      h = h / 6.0;
    } else if (maxC == c.g) {
      h = ((c.b - c.r) / delta + 2.0) / 6.0;
    } else {
      h = ((c.r - c.g) / delta + 4.0) / 6.0;
    }
  }
  return vec3f(h, s, v);
}

// ── Uniform struct (32 bytes, 16-byte aligned) ───────────────────────────────
struct CKParams {
  keyColor  : vec3f,   // sRGB 0..1 key color
  tolerance : f32,     // 0..100
  softness  : f32,     // 0..100
  _pad      : vec3f,
}

@group(0) @binding(0) var srcTex    : texture_2d<f32>;
@group(0) @binding(1) var dstTex    : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : CKParams;
@group(0) @binding(3) var selMask   : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_color_key(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);

  // Already transparent — nothing to key; preserve as-is.
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  let pHsv = rgb2hsv(src.rgb);
  let kHsv = rgb2hsv(params.keyColor);

  // ── HSV distance formula ─────────────────────────────────────────────────
  //
  // Circular hue distance, normalised to 0..1:
  //   dH_raw  = |pH - kH|
  //   dH      = min(dH_raw, 1 - dH_raw) × 2   → range 0..1
  //
  // Saturation and value absolute differences (both 0..1).
  //
  // Hue is attenuated by the minimum of the two saturations so that achromatic
  // pixels (grays, black, white) are evaluated primarily by S and V distance
  // and are not incorrectly keyed out due to an undefined/arbitrary hue.
  //
  //   dist = ( dH × min(pS, kS)  +  dS  +  dV ) / 3  × 100
  //
  // This yields a scalar in 0..100 that matches the tolerance/softness range.

  let dH_raw = abs(pHsv.x - kHsv.x);
  let dH     = min(dH_raw, 1.0 - dH_raw) * 2.0;
  let dS     = abs(pHsv.y - kHsv.y);
  let dV     = abs(pHsv.z - kHsv.z);
  let satW   = min(pHsv.y, kHsv.y);
  let dist   = ((dH * satW) + dS + dV) / 3.0 * 100.0;

  // ── Alpha keying ─────────────────────────────────────────────────────────
  let tol  = params.tolerance;
  let soft = params.softness;
  var alpha = src.a;
  if (dist <= tol) {
    // Inside tolerance zone → fully transparent
    alpha = 0.0;
  } else if (soft > 0.0001 && dist < tol + soft) {
    // Soft-edge transition → linear fade from 0 (at tol) to src.a (at tol+soft)
    alpha = src.a * (dist - tol) / soft;
  }
  // else: dist >= tol + soft → alpha unchanged (src.a)

  let adjusted = vec4f(src.rgb, alpha);
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  // mask=1 → fully keyed result; mask=0 → original src (no keying applied)
  textureStore(dstTex, coord, mix(src, adjusted, mask));
}
` as const
```

**Uniform buffer layout for the TypeScript caller (8 × f32 = 32 bytes):**

| Index | Value |
|-------|-------|
| 0 | `keyR / 255` |
| 1 | `keyG / 255` |
| 2 | `keyB / 255` |
| 3 | `tolerance` (0–100) |
| 4 | `softness` (0–100) |
| 5–7 | `0.0` (padding) |

---

### Step 4 — Barrel re-export: `src/webgpu/shaders.ts`

Add one line at the end of the existing adjustment exports:

```typescript
export { CK_COMPUTE } from './shaders/adjustments/color-key'
```

---

### Step 5 — WebGPURenderer: `src/webgpu/WebGPURenderer.ts`

**5a. Import `CK_COMPUTE`** — add to the destructured import from `'./shaders'`:
```typescript
import {
  /* ... existing ... */
  CK_COMPUTE,
} from './shaders'
```

**5b. Extend `AdjustmentRenderOp`** — append a new variant to the union (after the `'halation'` variant):
```typescript
| {
    kind:      'color-key'
    layerId:   string
    /** Key color components pre-normalised to 0..1. */
    keyR:      number
    keyG:      number
    keyB:      number
    tolerance: number    // 0..100
    softness:  number    // 0..100
    visible:   boolean
    selMaskLayer?: GpuLayer
  }
```

**5c. Add private pipeline field** (in the "Compute pipelines" section of the class):
```typescript
private readonly ckPipeline: GPUComputePipeline
```

**5d. Initialize pipeline in constructor** (after `this.halationExtractPipeline = ...`):
```typescript
this.ckPipeline = this.createComputePipeline(CK_COMPUTE, 'cs_color_key')
```

**5e. Add dispatch branch in `encodeAdjustmentOp`** (before the `const _exhaustive: never = entry` guard):
```typescript
if (entry.kind === 'color-key') {
  const params = new Float32Array([
    entry.keyR, entry.keyG, entry.keyB, entry.tolerance,
    entry.softness, 0, 0, 0,
  ])
  this.encodeComputePass(encoder, this.ckPipeline, srcTex, dstTex, params, entry.selMaskLayer)
  return
}
```

The standard `encodeComputePass` method handles the 5-binding layout (`srcTex`, `dstTex`, `params`, `selMask`, `maskFlags`) used by all single-pass adjustments.

---

### Step 6 — canvasPlan: `src/components/window/Canvas/canvasPlan.ts`

Add a branch in `buildAdjustmentEntry` before the `const _exhaustive: never = ls` guard:

```typescript
if (ls.adjustmentType === 'color-key') {
  const { r, g, b } = ls.params.keyColor
  return {
    kind:         'color-key',
    layerId:      ls.id,
    keyR:         r / 255,
    keyG:         g / 255,
    keyB:         b / 255,
    tolerance:    ls.params.tolerance,
    softness:     ls.params.softness,
    visible:      ls.visible,
    selMaskLayer: mask,
  }
}
```

This normalises the `keyColor` byte values to 0..1 floats as expected by the shader.

---

### Step 7 — Panel component: `src/components/panels/ColorKeyPanel/`

#### `ColorKeyPanel.tsx`

```typescript
import React, { useRef } from 'react'
import { useAppContext } from '@/store/AppContext'
import type { ColorKeyAdjustmentLayer } from '@/types'
import { ColorSwatch } from '@/components/widgets/ColorSwatch/ColorSwatch'
import { ParentConnectorIcon } from '@/adjustments/AdjustmentIcons'
import styles from './ColorKeyPanel.module.scss'

interface ColorKeyPanelProps {
  layer: ColorKeyAdjustmentLayer
  parentLayerName: string
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return { r: 0, g: 0, b: 0 }
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

async function pickWithEyedropper(): Promise<string | null> {
  if (!('EyeDropper' in window)) return null
  try {
    // EyeDropper is available in Electron (Chromium). No type declaration in
    // lib.dom — cast through unknown intentionally.
    const picker = new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper()
    const result = await picker.open()
    return result.sRGBHex   // e.g. "#00ff00"
  } catch {
    return null  // user cancelled or API error
  }
}

export function ColorKeyPanel({ layer, parentLayerName }: ColorKeyPanelProps): React.JSX.Element {
  const { dispatch } = useAppContext()
  const { keyColor, tolerance, softness } = layer.params
  const pct = (v: number, lo: number, hi: number): string => String((v - lo) / (hi - lo))

  const updateParams = (patch: Partial<typeof layer.params>): void => {
    dispatch({
      type: 'UPDATE_ADJUSTMENT_LAYER',
      payload: { ...layer, params: { ...layer.params, ...patch } },
    })
  }

  const handleEyedropper = async (): Promise<void> => {
    const hex = await pickWithEyedropper()
    if (hex) updateParams({ keyColor: hexToRgb(hex) })
  }

  return (
    <div className={styles.content}>

      {/* Key Color row */}
      <div className={styles.row}>
        <span className={styles.label}>Key Color</span>
        <div className={styles.colorRow}>
          <ColorSwatch
            value={rgbToHex(keyColor.r, keyColor.g, keyColor.b)}
            onChange={(hex) => updateParams({ keyColor: hexToRgb(hex) })}
            title="Key Color"
          />
          <button
            className={styles.eyedropperBtn}
            onClick={handleEyedropper}
            title="Sample key color from screen"
            aria-label="Pick key color from screen"
          >
            {/* Eyedropper SVG icon */}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8.5 1.5 L10.5 3.5 L5 9 L3 9 L3 7 Z" />
              <line x1="7" y1="3" x2="9" y2="5" />
              <line x1="2" y1="10" x2="3" y2="9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tolerance row */}
      <div className={styles.row}>
        <span className={styles.label}>Tolerance</span>
        <div className={styles.trackWrap}>
          <input
            type="range"
            className={styles.track}
            min={0} max={100} step={1}
            value={tolerance}
            style={{ '--pct': pct(tolerance, 0, 100) } as React.CSSProperties}
            onChange={(e) => updateParams({ tolerance: Number(e.target.value) })}
          />
        </div>
        <input
          type="number"
          className={styles.numInput}
          min={0} max={100} step={1}
          value={tolerance}
          onChange={(e) => {
            const v = e.target.valueAsNumber
            if (!isNaN(v)) updateParams({ tolerance: Math.min(100, Math.max(0, Math.round(v))) })
          }}
        />
      </div>

      {/* Edge Softness row */}
      <div className={styles.row}>
        <span className={styles.label}>Edge Softness</span>
        <div className={styles.trackWrap}>
          <input
            type="range"
            className={styles.track}
            min={0} max={100} step={1}
            value={softness}
            style={{ '--pct': pct(softness, 0, 100) } as React.CSSProperties}
            onChange={(e) => updateParams({ softness: Number(e.target.value) })}
          />
        </div>
        <input
          type="number"
          className={styles.numInput}
          min={0} max={100} step={1}
          value={softness}
          onChange={(e) => {
            const v = e.target.valueAsNumber
            if (!isNaN(v)) updateParams({ softness: Math.min(100, Math.max(0, Math.round(v))) })
          }}
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <span className={styles.footerInfo}>
          <ParentConnectorIcon />
          Adjusting <strong>{parentLayerName}</strong>
        </span>
        <button
          className={styles.resetBtn}
          onClick={() => updateParams({ keyColor: { r: 0, g: 255, b: 0 }, tolerance: 0, softness: 0 })}
          title="Reset to defaults"
        >
          Reset
        </button>
      </div>

    </div>
  )
}
```

**`ColorKeyPanel.module.scss`**

Copy `BrightnessContrastPanel.module.scss` verbatim as the base. Add two additional rules for the color swatch row and the eyedropper button:

```scss
// Additional rules on top of the BrightnessContrast base:

.colorRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.eyedropperBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--color-border-light);
  border-radius: 3px;
  background: var(--color-surface-2);
  color: var(--color-text-dim);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }
}
```

---

### Step 8 — AdjustmentPanel: `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`

**8a. Type import** — add `ColorKeyAdjustmentLayer` to the existing named import from `@/types`.

**8b. Component import:**
```typescript
import { ColorKeyPanel } from '../ColorKeyPanel/ColorKeyPanel'
```

**8c. `adjustmentTitle` switch** — add case:
```typescript
case 'color-key': return 'Color Key'
```

**8d. Header icon** — add the component before `AdjPanelIcon`:
```tsx
const ColorKeyHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="1.5" y="2.5" width="9" height="7" rx="0.5" />
    <circle cx="6" cy="6" r="2" />
    <line x1="1.5" y1="6" x2="4" y2="6" strokeOpacity="0.5" />
    <line x1="8" y1="6" x2="10.5" y2="6" strokeOpacity="0.5" />
  </svg>
)
```

**8e. `AdjPanelIcon` function** — add a branch before the final `return` fallback:
```typescript
if (type === 'color-key') return <ColorKeyHeaderIcon />
```

**8f. Panel render** — add inside `<div className={styles.body}>` after the `halation` block:
```tsx
{adjLayer.adjustmentType === 'color-key' && (
  <ColorKeyPanel
    layer={adjLayer as ColorKeyAdjustmentLayer}
    parentLayerName={parentLayerName}
  />
)}
```

The `panelWidth` default of `236` applies because `color-key` is not listed in the special-case overrides.

---

### Step 9 — Barrel export: `src/components/index.ts`

Add:
```typescript
export { ColorKeyPanel } from './panels/ColorKeyPanel/ColorKeyPanel'
```

---

## Architectural Constraints

**Unified rasterization is automatic.** `GpuRasterPipeline.ts` calls `renderer.readFlattenedPlan(request.plan)`. That method runs `encodePlanToComposite`, which calls `encodeAdjustmentOp` for every `AdjustmentRenderOp` entry. Adding the `'color-key'` variant to `encodeAdjustmentOp` is sufficient — no changes to `GpuRasterPipeline.ts` are required.

**Exhaustive type guard.** `buildAdjustmentEntry` in `canvasPlan.ts` terminates with `const _exhaustive: never = ls`. The new `'color-key'` branch must appear **before** that guard, or TypeScript will report a type error that makes the omission visible at compile time.

**Uniform buffer alignment.** The `CKParams` struct is 32 bytes (`vec3f` + `f32` + `f32` + `vec3f`). The existing `encodeComputePass` method uses `Math.max(16, Math.ceil(byteLength / 16) * 16)` to compute the aligned buffer size, so the 32-byte `Float32Array` is handled correctly without special treatment.

**Key color normalisation.** `AdjustmentParamsMap['color-key'].keyColor` stores sRGB byte values (0–255) consistent with `RGBColor` throughout the codebase. The `buildAdjustmentEntry` function is the single point where they are divided by 255 before being packed into the `Float32Array` for the GPU. The shader receives 0..1 floats and `rgb2hsv` operates in that space.

**Panel category.** `ColorKeyPanel` is a **Panel** — it calls `dispatch` from `AppContext`. State is not duplicated in local component state; every slider and numeric input dispatches immediately, which drives the live canvas preview via the normal render loop.

**Mask convention.** The `hasMask` field and `adjustmentMaskMap` mechanism are unchanged. Binding layout (0 = srcTex, 1 = dstTex, 2 = params uniform, 3 = selMask, 4 = maskFlags uniform) is identical to all other single-pass compute shaders, allowing the standard `encodeComputePass` path to be reused.

**EyeDropper API.** Electron uses Chromium, which ships the `EyeDropper` API. The API is not declared in `lib.dom.d.ts` — the cast through `unknown` in `pickWithEyedropper` is intentional and localised. The `EyeDropper` samples any pixel visible on screen, meaning it reads from the composited canvas output (including all layers and adjustments), which is the correct behaviour for selecting a key color. If the API is absent (possible in test environments), `pickWithEyedropper` returns `null` and the eyedropper button silently does nothing.

---

## Open Questions

1. **HSV vs perceptual colour space.** The spec mandates HSV-space distance. A perceptual-space metric (e.g. OkLab ΔE) would produce more visually uniform keying near the green/yellow boundary, which is the most common chroma key scenario. If the team decides to switch, only the `rgb2hsv` call and the distance formula inside `cs_color_key` need to change — the rest of the architecture is unaffected.

2. **EyeDropper button visibility.** Should the eyedropper button be hidden rather than silently no-op when `'EyeDropper' in window` is false? A `useState` check on mount could conditionally render the button, but the silent-no-op approach is simpler and the API is present in all supported Electron builds.

3. **`color-key` placement in `AdjustmentType` and `AdjustmentLayerState`.** The design appends `'color-key'` at the end of both unions. If alphabetical ordering is preferred, it should be inserted between `'color-invert'` and `'curves'`. The placement has no functional effect.
