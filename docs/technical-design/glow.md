# Technical Design: Glow

## Overview

Glow is a non-destructive real-time effect added to the **Effects** menu alongside Bloom, Drop Shadow, Chromatic Aberration, Halation, and Color Key. It produces a soft, colored halo that radiates outward from the visible content of a parent pixel, text, or shape layer. Structurally, Glow is identical to Drop Shadow with a fixed offset of (0, 0) — the same five-pass GPU pipeline (dilate H, dilate V, blur H×3, blur V×3, composite) is reused in its entirety. No new WGSL shaders are needed. The only behavioral distinction is that Glow omits X/Y offset controls from its panel and always passes `offsetX: 0, offsetY: 0` into the existing `encodeDropShadowPass()` method.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `'glow'` to `AdjustmentType`; add `GlowParams` to `AdjustmentParamsMap`; add `GlowAdjustmentLayer` interface; extend `AdjustmentLayerState` union |
| `src/adjustments/registry.ts` | Register `'glow'` entry with `group: 'real-time-effects'` |
| `src/webgpu/WebGPURenderer.ts` | Add `'glow'` `AdjustmentRenderOp` variant; add dispatch branch in `encodeAdjustmentOp()` routing to the existing `encodeDropShadowPass()` |
| `src/components/window/Canvas/canvasPlan.ts` | Add `'glow'` branch in `buildAdjustmentEntry()` |
| `src/components/panels/GlowOptions/GlowOptions.tsx` | **New file** — panel component |
| `src/components/panels/GlowOptions/GlowOptions.module.scss` | **New file** — panel styles |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | Add `'glow'` to `adjustmentTitle()`, header icon, type imports, and the render switch |
| `src/components/index.ts` | Export `GlowOptions` |

`useAdjustments.ts`, `src/webgpu/shaders/adjustments/drop-shadow.ts`, and the rasterization pipeline require **no changes**.

---

## State Changes

### `src/types/index.ts`

**1. Extend `AdjustmentType`:**

```ts
export type AdjustmentType =
  | /* ...existing... */
  | 'drop-shadow'
  | 'glow'
```

**2. Add `GlowParams` to `AdjustmentParamsMap`** (same shape as `DropShadowParams` minus `offsetX`/`offsetY`):

```ts
'glow': {
  /** Glow color including alpha channel. r/g/b/a are 0–255. Default: { r:255, g:255, b:153, a:255 } */
  color:     RGBAColor
  /** Overall glow opacity, 0–100 (%). Applied on top of color.a. Default: 75 */
  opacity:   number
  /** Morphological dilation radius in pixels, 0–100. Default: 0 */
  spread:    number
  /** Gaussian blur radius in pixels, 0–100. Default: 15 */
  softness:  number
  /** How the glow composites with layers beneath it. Default: 'normal' */
  blendMode: 'normal' | 'multiply' | 'screen'
  /** When true, the glow is masked by the inverse of the source alpha (outer glow only). Default: true */
  knockout:  boolean
}
```

**3. Add `GlowAdjustmentLayer` interface** (identical pattern to `DropShadowAdjustmentLayer`):

```ts
export interface GlowAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'glow'
  params: AdjustmentParamsMap['glow']
  hasMask: boolean
}
```

**4. Extend `AdjustmentLayerState` union:**

```ts
export type AdjustmentLayerState =
  | /* ...existing members... */
  | DropShadowAdjustmentLayer
  | GlowAdjustmentLayer
```

---

## Registry Entry

### `src/adjustments/registry.ts`

Append immediately after the `'drop-shadow'` entry:

```ts
{
  adjustmentType: 'glow' as const,
  label: 'Glow…',
  group: 'real-time-effects',
  defaultParams: {
    color:     { r: 255, g: 255, b: 153, a: 255 },
    opacity:   75,
    spread:    0,
    softness:  15,
    blendMode: 'normal',
    knockout:  true,
  },
},
```

Because `EFFECTS_MENU_ITEMS` is built by filtering `ADJUSTMENT_REGISTRY` for `group === 'real-time-effects'`, this entry appears automatically in the Effects menu — no change to `App.tsx` or `TopBar.tsx` is needed.

---

## No New WGSL Shaders

The existing five compute shaders in `src/webgpu/shaders/adjustments/drop-shadow.ts` handle the complete pipeline:

1. `DROP_SHADOW_DILATE_H_COMPUTE` — horizontal max-filter (extract alpha + spread)
2. `DROP_SHADOW_DILATE_V_COMPUTE` — vertical max-filter (complete separable dilation)
3. `DROP_SHADOW_BLUR_H_COMPUTE` — horizontal box blur (×3 for Gaussian approximation)
4. `DROP_SHADOW_BLUR_V_COMPUTE` — vertical box blur (×3)
5. `DROP_SHADOW_COMPOSITE_COMPUTE` — colorize, apply offset, knockout, blend mode, composite under source

For Glow, the composite shader's `offsetX` and `offsetY` uniforms are always written as `0`. The shader's offset-lookup logic:

```wgsl
let maskCoord = coord - vec2i(params.offsetX, params.offsetY);
```

degenerates to `let maskCoord = coord;` when both values are zero, which is equivalent to a centered halo. No shader modification is required.

---

## WebGPU Dispatch

### `AdjustmentRenderOp` variant (`src/webgpu/WebGPURenderer.ts`)

Add immediately after the `'drop-shadow'` variant in the `AdjustmentRenderOp` union:

```ts
| {
    kind:      'glow'
    layerId:   string
    /** Glow color components pre-normalised to 0..1. */
    colorR:    number
    colorG:    number
    colorB:    number
    colorA:    number
    opacity:   number   // 0..1 (pre-divided by 100)
    spread:    number   // 0..100 px
    softness:  number   // 0..100 px
    blendMode: 'normal' | 'multiply' | 'screen'
    knockout:  boolean
    visible:   boolean
    selMaskLayer?: GpuLayer
  }
```

Note the absence of `offsetX` and `offsetY` — these are not part of the public type. The caller always passes `0, 0`.

### `encodeAdjustmentOp()` dispatch branch

Add immediately after the `'drop-shadow'` branch, before the `const _exhaustive: never = entry` guard:

```ts
if (entry.kind === 'glow') {
  this.encodeDropShadowPass(
    encoder, srcTex, dstTex,
    entry.colorR, entry.colorG, entry.colorB, entry.colorA,
    entry.opacity,
    0, 0,           // offsetX, offsetY — always zero for Glow
    entry.spread, entry.softness,
    entry.blendMode, entry.knockout,
    entry.selMaskLayer,
  )
  return
}
```

`encodeDropShadowPass` signature is unchanged. The `0, 0` arguments satisfy its existing `offsetX: number, offsetY: number` parameters directly. No overloading or signature change is needed.

### Texture and pipeline reuse

`encodeDropShadowPass` internally calls `this.ensureShadowTextures()`, which returns the shared `shadowTexCache` (`tempA` / `tempB`). Drop Shadow and Glow cannot execute in the same frame for the same parent layer (the render plan processes one adjustment group at a time), so sharing the scratch textures is safe. No new scratch texture fields are required.

---

## `canvasPlan.ts` Addition

Add the following branch in `buildAdjustmentEntry()` immediately after the `'drop-shadow'` branch, before `const _exhaustive: never = ls`:

```ts
if (ls.adjustmentType === 'glow') {
  const { color, opacity, spread, softness, blendMode, knockout } = ls.params
  return {
    kind:      'glow',
    layerId:   ls.id,
    colorR:    color.r / 255,
    colorG:    color.g / 255,
    colorB:    color.b / 255,
    colorA:    color.a / 255,
    opacity:   opacity / 100,
    spread,
    softness,
    blendMode,
    knockout,
    visible:      ls.visible,
    selMaskLayer: mask,
  }
}
```

---

## New Components

### `GlowOptions` panel

- **Category**: panel (accesses `AppContext` via `useAppContext`)
- **Responsibility**: renders the six Glow controls and dispatches `UPDATE_ADJUSTMENT_LAYER` on change
- **Props**: `{ layer: GlowAdjustmentLayer; parentLayerName: string }`
- **Controls** and their DOM form (identical to `DropShadowOptions` minus the X/Y Offset rows):

| Control | Form element | Range | Default |
|---|---|---|---|
| Color | `<ColorSwatch>` opening RGBA picker | — | `{ r:255, g:255, b:153, a:255 }` |
| Opacity | slider + number input | 0–100, step 1 | 75 |
| Spread | slider + number input | 0–100 px, step 1 | 0 |
| Softness | slider + number input | 0–100 px, step 1 | 15 |
| Blend Mode | `<select>` Normal / Multiply / Screen | — | Normal |
| Knockout | `<input type="checkbox">` | — | checked |
| Footer | `ParentConnectorIcon` + parent layer name + Reset button | — | — |

The Reset button restores `{ color: { r:255, g:255, b:153, a:255 }, opacity: 75, spread: 0, softness: 15, blendMode: 'normal', knockout: true }`.

### `src/components/panels/GlowOptions/GlowOptions.tsx`

```tsx
import React from 'react'
import { useAppContext } from '@/store/AppContext'
import type { GlowAdjustmentLayer } from '@/types'
import { ColorSwatch } from '@/components'
import { ParentConnectorIcon } from '../DropShadowOptions/DropShadowOptions'  // re-export or copy
import styles from './GlowOptions.module.scss'

interface GlowOptionsProps {
  layer:           GlowAdjustmentLayer
  parentLayerName: string
}

export function GlowOptions({ layer, parentLayerName }: GlowOptionsProps): React.JSX.Element {
  const { dispatch } = useAppContext()
  const p = layer.params

  const update = (patch: Partial<typeof p>) =>
    dispatch({ type: 'UPDATE_ADJUSTMENT_LAYER', payload: { ...layer, params: { ...p, ...patch } } })

  const pct = (v: number, lo: number, hi: number) => String((v - lo) / (hi - lo))

  return (
    <div className={styles.content}>
      {/* Color */}
      <div className={styles.row}>
        <span className={styles.label}>Color</span>
        <ColorSwatch color={p.color} onClick={/* open RGBA color picker, on change call update({ color }) */} />
        <span className={styles.unitSpacer} />
      </div>

      {/* Opacity */}
      <div className={styles.row}>
        <span className={styles.label}>Opacity</span>
        <div className={styles.trackWrap}>
          <input type="range" className={styles.track}
            min={0} max={100} step={1} value={p.opacity}
            style={{ '--pct': pct(p.opacity, 0, 100) } as React.CSSProperties}
            onChange={e => update({ opacity: Number(e.target.value) })}
          />
        </div>
        <input type="number" className={styles.numInput} min={0} max={100} step={1} value={p.opacity}
          onChange={e => { const v = e.target.valueAsNumber; if (!isNaN(v)) update({ opacity: Math.min(100, Math.max(0, v)) }) }}
        />
        <span className={styles.unitLabel}>%</span>
      </div>

      {/* Spread */}
      <div className={styles.row}>
        <span className={styles.label}>Spread</span>
        <div className={styles.trackWrap}>
          <input type="range" className={styles.track}
            min={0} max={100} step={1} value={p.spread}
            style={{ '--pct': pct(p.spread, 0, 100) } as React.CSSProperties}
            onChange={e => update({ spread: Number(e.target.value) })}
          />
        </div>
        <input type="number" className={styles.numInput} min={0} max={100} step={1} value={p.spread}
          onChange={e => { const v = e.target.valueAsNumber; if (!isNaN(v)) update({ spread: Math.min(100, Math.max(0, Math.round(v))) }) }}
        />
        <span className={styles.unitLabel}>px</span>
      </div>

      {/* Softness */}
      <div className={styles.row}>
        <span className={styles.label}>Softness</span>
        <div className={styles.trackWrap}>
          <input type="range" className={styles.track}
            min={0} max={100} step={1} value={p.softness}
            style={{ '--pct': pct(p.softness, 0, 100) } as React.CSSProperties}
            onChange={e => update({ softness: Number(e.target.value) })}
          />
        </div>
        <input type="number" className={styles.numInput} min={0} max={100} step={1} value={p.softness}
          onChange={e => { const v = e.target.valueAsNumber; if (!isNaN(v)) update({ softness: Math.min(100, Math.max(0, Math.round(v))) }) }}
        />
        <span className={styles.unitLabel}>px</span>
      </div>

      <div className={styles.sep} />

      {/* Blend Mode */}
      <div className={styles.row}>
        <span className={styles.label}>Blend Mode</span>
        <select className={styles.select} value={p.blendMode}
          onChange={e => update({ blendMode: e.target.value as 'normal' | 'multiply' | 'screen' })}>
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
          <option value="screen">Screen</option>
        </select>
      </div>

      {/* Knockout */}
      <div className={styles.row}>
        <span className={styles.label}>Knockout</span>
        <input type="checkbox" className={styles.checkbox} checked={p.knockout}
          onChange={e => update({ knockout: e.target.checked })}
        />
      </div>

      <div className={styles.sep} />

      {/* Footer */}
      <div className={styles.footer}>
        <span className={styles.footerInfo}>
          <ParentConnectorIcon />
          Adjusting <strong>{parentLayerName}</strong>
        </span>
        <button className={styles.resetBtn}
          onClick={() => update({ color: { r: 255, g: 255, b: 153, a: 255 }, opacity: 75, spread: 0, softness: 15, blendMode: 'normal', knockout: true })}
          title="Reset to defaults"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
```

> **`ParentConnectorIcon`**: If `DropShadowOptions` defines this as a local component, either promote it to a shared widget or duplicate it in `GlowOptions`. The cleanest approach is to move `ParentConnectorIcon` to `src/components/widgets/` and import it in both panels.

### `src/components/panels/GlowOptions/GlowOptions.module.scss`

Clone `DropShadowOptions.module.scss` verbatim. All CSS classes are identical; the panel is structurally the same, just without the offset row styles (`.numInputWide` can be omitted if not needed elsewhere, but keeping it is harmless).

---

## `AdjustmentPanel` Wiring

### `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`

**1. Add to `adjustmentTitle()` switch:**

```ts
case 'glow': return 'Glow'
```

**2. Add `GlowHeaderIcon`** (concentric rings, distinct from `ColorVibranceHeaderIcon`):

```tsx
const GlowHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
    <circle cx="6" cy="6" r="1.5" strokeWidth="1.4" />
    <circle cx="6" cy="6" r="3.2" strokeWidth="0.9" opacity="0.6" />
    <circle cx="6" cy="6" r="5.0" strokeWidth="0.6" opacity="0.3" />
  </svg>
)
```

**3. Add to `AdjPanelIcon()`:**

```ts
if (type === 'glow') return <GlowHeaderIcon />
```

**4. Add import:**

```ts
import { GlowOptions } from '../GlowOptions/GlowOptions'
import type { GlowAdjustmentLayer } from '@/types'
```

**5. Extend the type import line** to include `GlowAdjustmentLayer`.

**6. Add to the render block** (after `'drop-shadow'`):

```tsx
{adjLayer.adjustmentType === 'glow' && (
  <GlowOptions layer={adjLayer as GlowAdjustmentLayer} parentLayerName={parentLayerName} />
)}
```

---

## Exports

### `src/components/index.ts`

Add `GlowOptions` to the barrel export:

```ts
export { GlowOptions } from './panels/GlowOptions/GlowOptions'
```

---

## `useAdjustments.ts` — No Changes Required

`useAdjustments` uses the generic `isEffectEligibleLayer` guard and `ADJUSTMENT_REGISTRY` lookup for all real-time effects. Since `'glow'` is registered with `group: 'real-time-effects'`, the existing `handleCreateAdjustmentLayer` and `isAdjustmentMenuEnabled` logic will include it automatically.

If text and shape layer support has not yet been extended in `useAdjustments` (it was an open item in the Drop Shadow design), that gap applies equally to Glow. It should be addressed once for all real-time effects, not per-effect.

---

## Data Flow

```
Effects menu → useAdjustments.handleCreateAdjustmentLayer('glow')
  → AppContext dispatch ADD_ADJUSTMENT_LAYER
    → AppState.layers gets new GlowAdjustmentLayer (params = registry defaults)
  → AdjustmentPanel opens with adjLayer.adjustmentType === 'glow'
    → GlowOptions renders, user adjusts controls
      → dispatch UPDATE_ADJUSTMENT_LAYER (new params object, no offsetX/offsetY)

On each render frame:
  canvasPlan.buildAdjustmentEntry(glowLayer)
    → { kind: 'glow', colorR, colorG, colorB, colorA, opacity, spread, softness, blendMode, knockout, ... }

WebGPURenderer.encodeAdjustmentOp(entry)
  → entry.kind === 'glow'
    → encodeDropShadowPass(encoder, srcTex, dstTex,
        colorR, colorG, colorB, colorA, opacity,
        0, 0,    ← offsetX, offsetY always zero
        spread, softness, blendMode, knockout, selMaskLayer)
      → [DilateH → DilateV → BlurH×3 → BlurV×3 → Composite]
      → writes final output (glow under source) to dstTex
```

---

## Implementation Steps

1. **`src/types/index.ts`** — add `'glow'` to `AdjustmentType`; add `GlowParams` to `AdjustmentParamsMap`; add `GlowAdjustmentLayer` interface; add `| GlowAdjustmentLayer` to `AdjustmentLayerState`.

2. **`src/adjustments/registry.ts`** — append the `'glow'` entry after `'drop-shadow'`.

3. **`src/webgpu/WebGPURenderer.ts`** — add the `'glow'` variant to `AdjustmentRenderOp`; add the `'glow'` branch to `encodeAdjustmentOp()`.

4. **`src/components/window/Canvas/canvasPlan.ts`** — add the `'glow'` branch to `buildAdjustmentEntry()`.

5. **`src/components/panels/GlowOptions/GlowOptions.tsx`** — create the panel component.

6. **`src/components/panels/GlowOptions/GlowOptions.module.scss`** — create the styles (clone `DropShadowOptions.module.scss`).

7. **`src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`** — add title, icon, import, and render case for `'glow'`.

8. **`src/components/index.ts`** — add `GlowOptions` to the barrel export.

9. **Verify** with `npm run typecheck` that `AdjustmentType`, `AdjustmentRenderOp`, `buildAdjustmentEntry`, and `encodeAdjustmentOp` are all exhaustive (no TypeScript errors on the `_exhaustive: never` guards).

---

## Architectural Constraints

- **No new shaders** — `AGENTS.md` requires new adjustment types to have their own WGSL shader file. Glow is explicitly an exception: it is not a new GPU algorithm but a restricted configuration of Drop Shadow. The dispatch path makes this clear by calling `encodeDropShadowPass` directly rather than a new method.
- **Unified rasterization pipeline** — flatten, merge, and export run through `src/rasterization/`. Because `buildAdjustmentEntry` in `canvasPlan.ts` produces `AdjustmentRenderOp` objects, and the rasterization pipeline consumes these objects via the same `encodeAdjustmentOp` dispatch, no additional rasterization changes are needed as long as `'glow'` is correctly emitted by `buildAdjustmentEntry`. Verify that the rasterization path also calls `buildAdjustmentEntry` (it does, via the shared plan builder).
- **Module-level singletons** — Glow introduces no new stores or singletons. The existing `shadowTexCache` in `WebGPURenderer` is shared between Drop Shadow and Glow passes; since they are serialized within a single command encoder, this is safe.
- **Component category rules** — `GlowOptions` is a panel (accesses `AppContext`), not a widget. It must not be placed in `widgets/`.
- **CSS Modules** — the SCSS file must be named `GlowOptions.module.scss`, not `GlowOptions.scss`.

---

## Risks and Open Questions

### Risk 1 — `encodeDropShadowPass` signature coupling

The Glow dispatch hardcodes `0, 0` into the positional `offsetX, offsetY` parameters of `encodeDropShadowPass`. If the method signature is ever refactored (e.g., to accept a single params object), both the Drop Shadow and Glow callers must be updated together. This is low risk but worth a comment at the call site.

**Mitigation**: add an inline comment at the Glow dispatch: `// offsetX, offsetY: always 0 for Glow — this is intentional`.

### Risk 2 — `ParentConnectorIcon` duplication

`DropShadowOptions` likely defines `ParentConnectorIcon` as a component-local function. If `GlowOptions` copies it, two identical inline SVGs exist. This is a minor P3 code-smell, not a correctness issue.

**Recommendation**: promote `ParentConnectorIcon` to `src/components/widgets/ParentConnectorIcon/` during the Glow implementation rather than duplicating it.

### Risk 3 — Blend mode default differs from Drop Shadow

Drop Shadow defaults to `blendMode: 'multiply'`; Glow defaults to `blendMode: 'normal'`. The composite shader uses the same enum mapping (`0 = Normal, 1 = Multiply, 2 = Screen`). The value written to the uniform buffer must match — `'normal'` maps to `0`, which is the correct default for a symmetric outer-glow effect. No shader change is needed but the registry default must be verified against the `BLEND_MODE_MAP` in `encodeDropShadowPass`.

### Risk 4 — Exhaustiveness checks after adding `'glow'`

Four locations enforce exhaustiveness via a `_exhaustive: never` guard:
1. `adjustmentTitle()` in `AdjustmentPanel.tsx`
2. `buildAdjustmentEntry()` in `canvasPlan.ts`
3. `encodeAdjustmentOp()` in `WebGPURenderer.ts`
4. Any reducer `switch` in `AppContext.tsx` that switches on `AdjustmentType`

All four will produce a TypeScript compile error until `'glow'` is handled. Running `npm run typecheck` after steps 1–8 above is the recommended verification gate.
