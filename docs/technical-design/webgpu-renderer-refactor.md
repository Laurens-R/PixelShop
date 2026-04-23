# Technical Design: WebGPURenderer Refactor

## Overview

`src/webgpu/WebGPURenderer.ts` has grown to 2182 lines and now carries at least six
distinct concerns inside a single class. Every new adjustment type adds ~80–150 lines
directly to this file, making it the inevitable merge-conflict hot spot and the hardest
file in the codebase to navigate or test in isolation. This document describes a
three-phase refactoring that splits the file into focused modules while keeping the
public API of `WebGPURenderer` completely unchanged and the app working after every
individual step.

---

## Current Structure (Problem Inventory)

### Concern map by line range

| Lines (approx.) | Concern |
|---|---|
| 1–230 | Exported types: `GpuLayer`, `AdjustmentRenderOp` union (15 variants), `RenderPlanEntry`, `WebGPUUnavailableError` |
| 230–470 | Class field declarations + constructor — device, context, samplers, 3 render pipelines, **25 compute pipeline fields**, 4 texture-cache fields, ping-pong textures, shared vertex/uniform buffers |
| 470–600 | Pipeline factory helpers (`createCompositePipeline`, `createBlitPipeline`, `createCheckerPipeline`, `createComputePipeline`) |
| 600–760 | Layer management + CPU pixel operations (`createLayer`, `flushLayer`, `destroyLayer`, `growLayerToFit`, `drawPixel`, `erasePixel`, `samplePixel`, coord helpers) |
| 760–950 | Public rendering API (`render`, `renderPlan`, `readLayerPixels`, `readFlattenedPixels`, `readFlattenedPlan`, `readAdjustmentInputPlan`) |
| 950–1250 | Plan-execution engine + composite/blit passes (`encodePlanToComposite`, `encodeSubPlan`, `encodeAdjustmentGroup`, `encodeClearTexture`, `encodeCheckerboard`, `encodeBlitToView`, `encodeCompositeLayer`, `encodeCompositeTexture`) |
| 1250–1460 | `encodeAdjustmentOp` dispatch chain (~200-line if-else, one branch per adjustment kind) |
| 1460–1550 | Generic compute helpers (`encodeComputePass`, `encodeComputePassRaw`) |
| 1550–2182 | 12 specialised pass encoders: `encodeInvertPass`, `encodeSelectiveColorPass`, `ensureCurvesLutTextures`, `encodeCurvesPass`, `encodeColorGradingPass`, `encodeReduceColorsPass`, `encodeBloomPass`+`ensureBloomTextures`, `encodeChromaticAberrationPass`, `encodeHalationPass`+`ensureHalationTextures`, `encodeDropShadowPass`+`ensureShadowTextures`, `encodeOutlinePass`+`ensureOutlineTextures`, `flushPendingDestroys`, `destroy` |

---

## Identified Problems (Prioritised)

### P1 — Business-logic bloat / growth trap

**AJ-1 — 25 compute pipeline fields embedded in the renderer class.**
Every new adjustment type adds a field declaration, an init line in the constructor, a
dispatch arm in `encodeAdjustmentOp`, and a dedicated 60–200-line private method — all
in the same file. The class currently manages pipelines for: `bc`, `hs`, `vib`, `cb`,
`bw`, `temp`, `invert`, `selColor`, `curves`, `cg`, `rc`, five bloom passes,
`ca`, `halationExtract`, `ck`, five drop-shadow passes, and eight outline passes. Adding
one more adjustment (e.g. lens flare bloom) requires touching this same already-huge
file.

**AJ-2 — `encodeAdjustmentOp` is a 200-line open-coded dispatch chain.**
It is a classic Open-Closed violation: every new `AdjustmentRenderOp` variant
requires inserting a new `if` branch in the middle of the renderer. The exhaustiveness
check at the bottom (`const _exhaustive: never = entry`) is the only compile-time guard.

**AJ-3 — Four independent texture-cache subsystems live as ad-hoc instance state.**
Bloom, halation, drop-shadow, and outline each have:
- A private `*TexCache` field (4 total)
- An `ensure*Textures()` method (4 total)
- Explicit destroy calls in `WebGPURenderer.destroy()` (12 individual texture destroys)

Any new effect that needs persistent intermediate textures silently expands this list.
The `destroy()` method is already 20 lines of manual texture cleanup; it is easy to miss
a field (the outline cache needed `tempC` alongside `tempA` and `tempB` — a silent bug
waiting to happen if they are maintained separately).

---

### P2 — Mixed responsibilities / wrong layer

**AJ-4 — Types exported from an implementation file.**
`GpuLayer`, `AdjustmentRenderOp`, `RenderPlanEntry`, and `WebGPUUnavailableError` are
imported by 12 files across `src/`. These types have no implementation dependency on
`WebGPURenderer` itself, yet every consumer must import from the renderer file. Extracting
them to `src/webgpu/types.ts` decouples type consumers from the GPU implementation.

**AJ-5 — `encodeCompositeTexture` creates a dummy `GpuLayer` per frame.**
```ts
const pseudoLayer: GpuLayer = {
  id: '__group-composite__',
  data: new Uint8Array(0),  // ← per-frame allocation
  ...
}
this.encodeCompositeLayer(encoder, pseudoLayer, srcTex, dstTex)
```
`encodeCompositeLayer` should accept bare parameters (texture, opacity, blendMode,
w, h, offsetX, offsetY) rather than a full `GpuLayer` struct so the core compositing
path does not construct dummy objects.

**AJ-6 — Halation borrows bloom's pipelines (`this.bloomBlurHPipeline`,
`this.bloomBlurVPipeline`) via implicit coupling.**
Both effects happen to use the same box-blur shader, but halation piggybacks on the
pipeline objects stored for bloom. If bloom's shader parameters ever change, halation
breaks silently. The correct fix is to have a shared `boxBlurPipelines` resource that
both reference explicitly.

**AJ-7 — `useWebGL.ts` is a dead file with a wrong name.**
`src/hooks/useWebGL.ts` wraps `WebGPURenderer` (not WebGL) and is never imported
outside its own definition. It should be deleted.

---

### P3 — Minor structure

**AJ-8 — CPU pixel ops (`drawPixel`, `erasePixel`, `samplePixel`, coord helpers) live
inside the GPU renderer class.**
These six methods do not touch `this.device` and require no GPU context. They are pure
CPU array operations on `GpuLayer.data`. They belong in a separate utility module.

**AJ-9 — `createComputePipeline` is a generic helper unnecessarily bound to `this`.**
It takes only `(wgsl, entryPoint)` and needs only `this.device`. It can be a free
function `createComputePipeline(device, wgsl, entryPoint)` in `utils.ts`.

---

## Proposed New File Layout

```
src/webgpu/
  types.ts                       ← NEW. All exported types.
  utils.ts                       ← UNCHANGED.
  shaders.ts                     ← UNCHANGED (barrel).
  filterShaders.ts               ← UNCHANGED (barrel).
  filterCompute.ts               ← UNCHANGED.
  shaders/                       ← UNCHANGED.

  AdjustmentEncoder.ts           ← NEW. All 25 compute pipelines + all pass encoders.
  adjustmentPasses/              ← NEW (optional Phase 3 sub-split).
    simple.ts                    ← BC, HS, VIB, CB, BW, TEMP, INVERT, SEL_COLOR, CG, RC, CK + CA
    curves.ts                    ← ensureCurvesLutTextures + encodeCurvesPass
    bloom.ts                     ← ensureBloomTextures + encodeBloomPass
    halation.ts                  ← ensureHalationTextures + encodeHalationPass
    shadow.ts                    ← ensureShadowTextures + encodeDropShadowPass
    outline.ts                   ← ensureOutlineTextures + encodeOutlinePass

  WebGPURenderer.ts              ← SLIMMED. ~700 lines. Owns device, 3 render pipelines,
                                    ping-pong textures, plan execution, public API.
```

---

## Responsibility Boundaries After Refactoring

### `src/webgpu/types.ts` (new, ~170 lines)

Owns and re-exports all public types:

```ts
export interface GpuLayer { ... }
export const BLEND_MODE_INDEX: Record<string, number> = { ... }
export type AdjustmentRenderOp = ... (full union)
export type RenderPlanEntry = ...
export class WebGPUUnavailableError extends Error { ... }
```

`WebGPURenderer.ts` re-exports all of these with `export type { ... } from './types'`
so every existing import site (`@/webgpu/WebGPURenderer`) continues to work without
modification.

---

### `src/webgpu/AdjustmentEncoder.ts` (new, ~1100 lines)

An internal class — not part of the public API, not exported from `WebGPURenderer.ts`.

**Responsibilities:**
- Owns and creates all 25 adjustment compute pipelines.
- Owns `ensureBloom/Halation/Shadow/OutlineTextures()` and all related texture caches.
- Owns the curves LUT texture cache.
- Owns its own `pendingDestroyBuffers: GPUBuffer[]` accumulator.
- Exposes one public method that replaces the current `encodeAdjustmentOp`:

```ts
export class AdjustmentEncoder {
  constructor(device: GPUDevice, pixelWidth: number, pixelHeight: number)

  /** Encode a single adjustment op into the provided command encoder. */
  encode(
    encoder: GPUCommandEncoder,
    op: AdjustmentRenderOp,
    srcTex: GPUTexture,
    dstTex: GPUTexture,
  ): void

  /** Destroy GPU resources accumulated during encode calls. Call after queue.submit(). */
  flushPendingDestroys(): void

  /** Destroy all persistent GPU resources (pipelines, texture caches). */
  destroy(): void
}
```

**Key internal details:**
- The private `encode()` dispatch switch replaces the current if-else chain; the
  `_exhaustive: never` guard is preserved.
- Generic helpers `encodeComputePassRaw` and `encodeComputePass` move here as private
  methods (or to `utils.ts` as free functions).
- The shared box-blur pipelines that both bloom and halation use are created once in
  `AdjustmentEncoder` and passed explicitly to both pass methods. The field names become
  `boxBlurHPipeline` / `boxBlurVPipeline` instead of `bloomBlurHPipeline` /
  `bloomBlurVPipeline`.

**`WebGPURenderer` integration:**

```ts
// In WebGPURenderer constructor:
this.adjEncoder = new AdjustmentEncoder(device, pixelWidth, pixelHeight)

// encodeAdjustmentOp becomes a one-liner:
private encodeAdjustmentOp(encoder, op, src, dst): void {
  this.adjEncoder.encode(encoder, op, src, dst)
}

// flushPendingDestroys delegates:
private flushPendingDestroys(): void {
  for (const buf of this.pendingDestroyBuffers) buf.destroy()
  this.pendingDestroyBuffers = []
  for (const tex of this.pendingDestroyTextures) tex.destroy()
  this.pendingDestroyTextures = []
  this.adjEncoder.flushPendingDestroys()   // ← added
}

// destroy delegates:
destroy(): void {
  ...existing cleanup...
  this.adjEncoder.destroy()   // ← added; replaces 12 individual texture destroys
}
```

---

### `src/webgpu/WebGPURenderer.ts` (slimmed, ~700 lines)

After the refactoring `WebGPURenderer` owns exactly four concerns:

1. **Device/context lifecycle** — `create()`, constructor, `destroy()`.
2. **Render pipelines** — the three render pipelines only (`compositePipeline`,
   `checkerPipeline`, `blitPipeline`) and their factory methods.
3. **Layer management + CPU pixel ops** — `createLayer`, `flushLayer`, `destroyLayer`,
   `growLayerToFit`, `drawPixel`, `erasePixel`, `samplePixel`, coord helpers.
4. **Plan execution + public rendering API** — `render`, `renderPlan`,
   `readLayerPixels`, `readFlattenedPixels`, `readFlattenedPlan`,
   `readAdjustmentInputPlan`, and all private `encode*` methods that directly concern
   compositing (ping-pong textures, checkerboard, blit, layer composite).

Private fields remaining on `WebGPURenderer`:

```ts
private readonly device: GPUDevice
private readonly context: GPUCanvasContext
private readonly sampler: GPUSampler
private readonly lutSampler: GPUSampler
private readonly compositePipeline: GPURenderPipeline
private readonly checkerPipeline: GPURenderPipeline
private readonly blitPipeline: GPURenderPipeline
private pingTex, pongTex, groupPingTex, groupPongTex: GPUTexture
private readonly texCoordBuffer, canvasQuadVertBuf, frameUniformBuf, checkerUniformBuf: GPUBuffer
private checkerBindGroup: GPUBindGroup
private readonly adjEncoder: AdjustmentEncoder           // ← new
private pendingDestroyBuffers: GPUBuffer[]
private pendingDestroyTextures: GPUTexture[]
readonly pixelWidth: number
readonly pixelHeight: number
deferFlush: boolean
```

Removed from `WebGPURenderer` fields: all 25 compute pipeline fields, all 4
`*TexCache` fields, `curvesLutTextures`, `curvesLutSignatures`. That is ~35 field
declarations deleted from the class.

---

## Public API Surface

**The public API of `WebGPURenderer` is unchanged.** All method signatures, property
names, and return types remain identical. `GpuLayer`, `AdjustmentRenderOp`,
`RenderPlanEntry`, and `WebGPUUnavailableError` continue to be importable from
`@/webgpu/WebGPURenderer` via re-exports.

Call sites affected by the refactoring: **zero forced changes**. Importers can
optionally migrate to `@/webgpu/types` for type-only imports, but this is not required.

---

## Breaking Changes

There are no breaking changes to external call sites in Phases 1 or 2.

The only potentially visible change is in Phase 2 (P2/AJ-5 fix, optional): if
`encodeCompositeLayer` is refactored to not accept a full `GpuLayer`, the signature
changes from a private method and only affects `WebGPURenderer`'s own internal code.
No external callers reference `encodeCompositeLayer`.

---

## Implementation Order

### Phase 1 — Extract types (safe, zero risk, ~1–2 hours)

**Goal:** Decouple 12 import sites from the renderer implementation.

1. Create `src/webgpu/types.ts`. Copy into it: `GpuLayer`, `BLEND_MODE_INDEX`,
   `AdjustmentRenderOp`, `RenderPlanEntry`, `WebGPUUnavailableError`.
2. In `WebGPURenderer.ts`: delete those declarations and add
   `export type { GpuLayer, AdjustmentRenderOp, RenderPlanEntry } from './types'`
   and `export { WebGPUUnavailableError } from './types'`.
3. Run `npm run typecheck`. No call-site changes needed.

**Net change:** 2 files touched, ~170 lines moved, 0 import-site changes.

---

### Phase 2 — Extract `AdjustmentEncoder` (~4–6 hours, the core refactor)

This is the single highest-impact step. It moves ~1400 lines out of `WebGPURenderer.ts`.

**Step 2a — Scaffold the class (start with constructor only):**
1. Create `src/webgpu/AdjustmentEncoder.ts`.
2. Move all 25 compute pipeline field declarations to the new class.
3. Move the `createComputePipeline` private helper to the new class (or convert it to a
   free function in `utils.ts` — see AJ-9).
4. Move all 25 pipeline construction lines from `WebGPURenderer`'s constructor into
   `AdjustmentEncoder`'s constructor.
5. In `WebGPURenderer` constructor: replace the 25 pipeline init lines with
   `this.adjEncoder = new AdjustmentEncoder(device, pixelWidth, pixelHeight)`.
6. `npm run typecheck` — must pass before proceeding.

**Step 2b — Move texture caches and ensure methods:**
1. Move all four `*TexCache` fields and their `ensure*Textures()` methods to
   `AdjustmentEncoder`.
2. Move `curvesLutTextures` and `curvesLutSignatures` maps.
3. Add `flushPendingDestroys()` and `destroy()` to `AdjustmentEncoder`.
4. Update `WebGPURenderer.destroy()` and `WebGPURenderer.flushPendingDestroys()` to
   delegate to `this.adjEncoder`.
5. `npm run typecheck` — must pass.

**Step 2c — Move pass encoders one by one (in this order):**

Move each block as a single atomic commit, typechecking between each:

1. `encodeComputePassRaw` + `encodeComputePass` (generic helpers)
2. `encodeInvertPass` (simplest non-generic pass)
3. `encodeSelectiveColorPass`
4. `ensureCurvesLutTextures` + `encodeCurvesPass`
5. `encodeColorGradingPass`
6. `encodeReduceColorsPass`
7. `encodeChromaticAberrationPass`
8. `ensureHalationTextures` + `encodeHalationPass` — at this point, rename
   `bloomBlurHPipeline` → `boxBlurHPipeline`, `bloomBlurVPipeline` → `boxBlurVPipeline`
   in `AdjustmentEncoder` to fix the implicit coupling (AJ-6). Update all internal
   references.
9. `ensureBloomTextures` + `encodeBloomPass`
10. `ensureShadowTextures` + `encodeDropShadowPass`
11. `ensureOutlineTextures` + `encodeOutlinePass`

**Step 2d — Replace `encodeAdjustmentOp` with delegation:**
1. Replace the entire body of `WebGPURenderer.encodeAdjustmentOp` with:
   ```ts
   private encodeAdjustmentOp(encoder, op, src, dst): void {
     this.adjEncoder.encode(encoder, op, src, dst)
   }
   ```
   Or inline `this.adjEncoder.encode(encoder, entry, srcTex, dstTex)` directly at its
   call site in `encodeSubPlan` and `encodeAdjustmentGroup`, removing the method
   entirely.
2. `npm run typecheck` — must pass.

**After Phase 2:**
- `WebGPURenderer.ts`: ~700 lines (down from 2182)
- `AdjustmentEncoder.ts`: ~1100 lines (a single-concern file that only grows when
  new adjustment types are added)

---

### Phase 3 — Optional sub-splits inside `AdjustmentEncoder` (~2–3 hours)

If `AdjustmentEncoder.ts` at 1100 lines is still too large, split its pass encoders into
per-concern files under `src/webgpu/adjustmentPasses/`. Each file is 80–200 lines.

Create a sub-module pattern:

```
src/webgpu/adjustmentPasses/
  simple.ts      ← BC, HS, VIB, CB, BW, TEMP, INVERT, SEL_COLOR, CG, RC, CK, CA
                   (~350 lines, ~12 small encoders)
  curves.ts      ← ensureCurvesLutTextures + encodeCurvesPass (~90 lines)
  bloom.ts       ← ensureBloomTextures + encodeBloomPass (~130 lines)
  halation.ts    ← ensureHalationTextures + encodeHalationPass (~120 lines)
  shadow.ts      ← ensureShadowTextures + encodeDropShadowPass (~150 lines)
  outline.ts     ← ensureOutlineTextures + encodeOutlinePass (~200 lines)
```

Each file exports its pipeline-creation function (e.g. `createBloomPipelines(device)`)
and its pass encoder function (e.g. `encodeBloomPass(ctx, encoder, op, srcTex, dstTex)`),
where `ctx` is a small bag-of-state:

```ts
interface AdjPassContext {
  device:    GPUDevice
  w:         number
  h:         number
  pending:   GPUBuffer[]  // accumulated per frame, flushed after submit
}
```

`AdjustmentEncoder` becomes a thin coordinator that holds the pipeline objects and
`AdjPassContext`, and delegates each `encode()` branch to the relevant sub-module.

**When to do Phase 3:** Only when `AdjustmentEncoder.ts` grows past ~1500 lines
(i.e., after 3–4 more adjustment types are added). It is not necessary immediately.

---

### Phase 4 — Cleanup (P2/P3, opportunistic)

These can be done at any point after Phase 2 during normal feature work:

**AJ-5 fix — eliminate pseudo-GpuLayer in `encodeCompositeTexture`:**
Extract the GPU encoding core out of `encodeCompositeLayer` into a private method that
accepts explicit parameters (texture, lw, lh, ox, oy, opacity, blendMode, srcTex,
dstTex, maskTex?). Both `encodeCompositeLayer` and `encodeCompositeTexture` call this
core directly.

**AJ-8 fix — extract CPU pixel ops to `layerOps.ts`:**
Move `drawPixel`, `erasePixel`, `samplePixel`, `canvasToLayer`,
`canvasToLayerUnchecked`, `sampleCanvasPixel`, `drawCanvasPixel` to
`src/webgpu/layerOps.ts` as pure functions. `WebGPURenderer` re-exports them or
thin-delegates. Low priority: only ~60 lines, and no growth expected.

**AJ-7 fix — delete `src/hooks/useWebGL.ts`:**
This hook wraps `WebGPURenderer` (not WebGL), is never imported outside its own file,
and is a strict subset of `useWebGPU.ts`. Confirm with `grep` that no call site exists,
then delete.

**AJ-9 fix — free-function `createComputePipeline`:**
Move from instance method to `function createComputePipeline(device, wgsl, entryPoint)`
in `utils.ts`. Already needed for Phase 2 since `AdjustmentEncoder` needs it too.

---

## Architectural Constraints

Per `AGENTS.md`:

- **No behavior change.** This is a pure structural refactor. All pixel output must be
  identical before and after. Each phase must be validated with a typecheck pass
  (`npm run typecheck`).
- **No new public API surface.** `AdjustmentEncoder` is internal to `src/webgpu/` and
  must not be exported from `WebGPURenderer.ts` or anywhere in the barrel.
- **Rasterization pipeline stays unchanged.** `src/rasterization/` imports only
  `RenderPlanEntry`, `AdjustmentRenderOp`, and `WebGPURenderer` — all re-exported from
  `WebGPURenderer.ts` throughout the migration, so no rasterization code changes.
- **No terminal.** All work via file edits and typecheck.

---

## Open Questions

1. **Phase 3 `AdjPassContext` vs. class methods:** The per-file sub-encoders in Phase 3
   could be either free functions taking an `AdjPassContext` bag, or methods on
   small sub-encoder classes (one per effect). Free functions are simpler; classes allow
   each sub-encoder to hold its own pipeline fields without a shared registry. Decide
   before starting Phase 3.

2. **Box-blur shader naming:** `BLOOM_BLUR_H_COMPUTE` / `BLOOM_BLUR_V_COMPUTE` in
   `shaders.ts` are named after bloom but are generic box-blur shaders also used by
   halation. Consider renaming the exports to `BOX_BLUR_H_COMPUTE` / `BOX_BLUR_V_COMPUTE`
   in Phase 2 step 2c item 8. This is a `shaders.ts` + `AdjustmentEncoder` -only change
   (the shader string content is unchanged).

3. **Curves LUT sampler:** The `lutSampler` is currently on `WebGPURenderer` and is
   referenced by `encodeCurvesPass`. Once curves moves to `AdjustmentEncoder`, the
   sampler must either move with it or be passed in the constructor. The simplest approach
   is to create it in `AdjustmentEncoder`'s constructor alongside the pipelines — it is
   only ever used for curve LUT lookups.
