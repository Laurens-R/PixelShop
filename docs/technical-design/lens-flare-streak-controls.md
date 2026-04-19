# Technical Design: Lens Flare – Streak Width & Streak Rotation Controls

## Overview

Two new integer parameters — **Streak Width** (1–100) and **Streak Rotation** (0–359°) — are threaded from the dialog UI through the TypeScript GPU dispatch layer and into the WGSL compute shader. Streak Width scales the angular tightness of each streak ray; Streak Rotation rotates the dx/dy vector fed to streak-rendering calls so the entire streak pattern pivots around the flare center. Both parameters occupy the two padding slots already present in `LensFlareParams`, so the GPU uniform buffer size stays exactly 32 bytes and no pipeline changes are needed.

---

## Affected Areas

| File | Change |
|------|--------|
| `src/webgpu/shaders/filters/lens-flare.ts` | Replace `_pad0`/`_pad1` with `streakWidth`/`streakRotation`; add rotation pre-computation in `cs_lens_flare`; pass scaled `tightness` and pre-rotated `(rdx, rdy)` to each streak call in the five `flare_*` functions |
| `src/webgpu/filterCompute.ts` | Add `streakWidth` and `streakRotation` to `runRenderLensFlare`, `FilterComputeEngine.renderLensFlare`, and the module-level `renderLensFlare` export |
| `src/components/dialogs/LensFlareDialog/LensFlareDialog.tsx` | Add per-type defaults table, two state+ref pairs, two change handlers, reset logic, two new slider rows, and updated `renderLensFlare` call sites |

No other files are affected. No new files are created.

---

## State Changes

No changes to `AppState` or `AppContext`. All new state is local to `LensFlareDialog`.

---

## New Components / Hooks / Tools

None. This change is purely additive within the three existing files listed above.

---

## Implementation Steps

### Step 1 — WGSL struct: replace padding with new fields

**File:** `src/webgpu/shaders/filters/lens-flare.ts`

Replace `_pad0 : u32` and `_pad1 : u32` in `LensFlareParams` with the two new fields:

```wgsl
struct LensFlareParams {
  centerX       : u32,
  centerY       : u32,
  brightness    : u32,
  lensType      : u32,
  ringOpacity   : u32,
  streakStrength: u32,
  streakWidth   : u32,   // was _pad0 — range 1..100
  streakRotation: u32,   // was _pad1 — range 0..359 degrees
}
```

The struct is 8 × 4 = 32 bytes. No alignment change; the existing `createUniformBuffer(device, 32)` call requires no update.

---

### Step 2 — WGSL compute entry: decode new params and pre-rotate dx/dy

**File:** `src/webgpu/shaders/filters/lens-flare.ts`, inside `fn cs_lens_flare`

After the existing `streakS` decode line, decode the two new parameters and compute the pre-rotated vector that will be used for streak calls only:

```wgsl
let streakS     = f32(params.streakStrength)/ 100.0;
let streakWF    = f32(params.streakWidth)   / 100.0;          // 0.01 – 1.0
let rotRad      = f32(params.streakRotation) * (3.14159265358979 / 180.0);
let cosR        = cos(rotRad);
let sinR        = sin(rotRad);
// Clockwise rotation of the coordinate frame seen by streak functions
let rdx         = dx * cosR + dy * sinR;
let rdy         = -dx * sinR + dy * cosR;
```

Then update the five dispatch calls to pass `rdx`/`rdy` and `streakWF` alongside the unchanged arguments (rings/glow/disc paths are not touched):

```wgsl
if      (params.lensType == 0u) { color = flare_zoom(rdx,rdy,dist,cx,cy,diag,w,h,ringO,streakS,streakWF); }
else if (params.lensType == 1u) { color = flare_prime35(rdx,rdy,dist,cx,cy,diag,ringO,streakS,streakWF); }
else if (params.lensType == 2u) { color = flare_prime105(rdx,rdy,dist,diag,ringO,streakS,streakWF); }
else if (params.lensType == 3u) { color = flare_movie_prime(rdx,rdy,dist,cx,cy,diag,w,h,ringO,streakS,streakWF); }
else                             { color = flare_anamorphic(px,py,rdx,rdy,dist,cx,cy,diag,w,h,ringO,streakS,streakWF); }
```

Note: `dist` is unchanged (`sqrt(dx²+dy²)` = `sqrt(rdx²+rdy²)` for a pure rotation), so no re-computation is needed.

---

### Step 3 — WGSL: apply `streakWF` to the tightness argument in each `flare_*` function

**File:** `src/webgpu/shaders/filters/lens-flare.ts`

Add `streakWF : f32` as the last parameter of each function and replace the hardcoded `tightness` value in every `radial_streaks` call using the formula:

$$\text{tightness\_eff} = \text{tightness\_natural} \times \frac{\text{streakWF}}{\text{default\_streakWF}}$$

This preserves the natural streak appearance when `streakWF` equals the per-type default (`default_streakWF`), and widens/narrows linearly from there.

#### `flare_zoom` (default streakWidth = 50 → default_streakWF = 0.50)

```wgsl
fn flare_zoom(dx: f32, dy: f32, dist: f32, cx: f32, cy: f32, diag: f32, w: f32, h: f32, ringO: f32, streakS: f32, streakWF: f32) -> vec4f {
```

Change the `radial_streaks` call from `0.040` to `0.080 * streakWF` (`= 0.040 / 0.50`):

```wgsl
  let sv = radial_streaks(dx, dy, dist, diag, 4u, 0.080 * streakWF, 0.35);
```

All other lines in `flare_zoom` are unchanged.

#### `flare_prime35` (default streakWidth = 25 → default_streakWF = 0.25)

```wgsl
fn flare_prime35(dx: f32, dy: f32, dist: f32, cx: f32, cy: f32, diag: f32, ringO: f32, streakS: f32, streakWF: f32) -> vec4f {
```

Change `0.022` to `0.088 * streakWF` (`= 0.022 / 0.25`):

```wgsl
  let sv = radial_streaks(dx, dy, dist, diag, 8u, 0.088 * streakWF, 0.40);
```

#### `flare_prime105` (default streakWidth = 75 → default_streakWF = 0.75)

```wgsl
fn flare_prime105(dx: f32, dy: f32, dist: f32, diag: f32, ringO: f32, streakS: f32, streakWF: f32) -> vec4f {
```

Change `0.10` to `0.1333 * streakWF` (`= 0.10 / 0.75`):

```wgsl
  let sv = radial_streaks(dx, dy, dist, diag, 3u, 0.1333 * streakWF, 0.22);
```

#### `flare_movie_prime` (default streakWidth = 30 → default_streakWF = 0.30)

```wgsl
fn flare_movie_prime(dx: f32, dy: f32, dist: f32, cx: f32, cy: f32, diag: f32, w: f32, h: f32, ringO: f32, streakS: f32, streakWF: f32) -> vec4f {
```

Change `0.028` to `0.0933 * streakWF` (`= 0.028 / 0.30`):

```wgsl
  let sv = radial_streaks(dx, dy, dist, diag, 6u, 0.0933 * streakWF, 0.38);
```

#### `flare_anamorphic` (default streakWidth = 20 → default_streakWF = 0.20)

The anamorphic streak is a Gaussian band in Y. The caller now passes `rdy` (the rotated Y component) instead of `dy`, so `streakRotation` is handled automatically. `streakWF` scales `sigmaY`:

```wgsl
fn flare_anamorphic(px: f32, py: f32, dx: f32, dy: f32, dist: f32, cx: f32, cy: f32, diag: f32, w: f32, h: f32, ringO: f32, streakS: f32, streakWF: f32) -> vec4f {
```

Replace the `sigmaY` line:

```wgsl
  let sigmaY  = max(0.006*diag, 4.0) * (streakWF / 0.20);
```

No other lines change. The existing `dy` argument to `flare_anamorphic` is already `rdy` from the dispatch site (Step 2), so rotation is handled there.

---

### Step 4 — TypeScript: update `runRenderLensFlare`

**File:** `src/webgpu/filterCompute.ts` — the `runRenderLensFlare` free function

Add two parameters after `streakStrength` and include them in the `Uint32Array` at positions 6 and 7 (displacing the two zeros that were padding):

```ts
export async function runRenderLensFlare(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  w: number,
  h: number,
  centerX: number,
  centerY: number,
  brightness: number,
  lensType: number,
  ringOpacity: number,
  streakStrength: number,
  streakWidth: number,
  streakRotation: number,
): Promise<Uint8Array> {
```

Update the `Uint32Array` construction:

```ts
const paramsData = new Uint32Array([
  Math.round(centerX), Math.round(centerY), brightness, lensType,
  ringOpacity, streakStrength, streakWidth, streakRotation,
])
```

---

### Step 5 — TypeScript: update `FilterComputeEngine.renderLensFlare`

**File:** `src/webgpu/filterCompute.ts`

Add the two parameters and pass them through:

```ts
async renderLensFlare(
  width: number, height: number,
  centerX: number, centerY: number,
  brightness: number, lensType: number,
  ringOpacity: number, streakStrength: number,
  streakWidth: number, streakRotation: number,
): Promise<Uint8Array> {
  return runRenderLensFlare(
    this.device, this.lensFlareRenderPipeline,
    width, height, centerX, centerY,
    brightness, lensType, ringOpacity, streakStrength,
    streakWidth, streakRotation,
  )
}
```

---

### Step 6 — TypeScript: update the module-level `renderLensFlare` export

**File:** `src/webgpu/filterCompute.ts`

```ts
export async function renderLensFlare(
  width: number, height: number,
  centerX: number, centerY: number,
  brightness: number, lensType: number,
  ringOpacity: number, streakStrength: number,
  streakWidth: number, streakRotation: number,
): Promise<Uint8Array> {
  return _engine!.renderLensFlare(
    width, height, centerX, centerY,
    brightness, lensType, ringOpacity, streakStrength,
    streakWidth, streakRotation,
  )
}
```

---

### Step 7 — Dialog: per-type defaults and new state

**File:** `src/components/dialogs/LensFlareDialog/LensFlareDialog.tsx`

Add a constant array that collocates all per-type defaults. Place it alongside the existing `LENS_TYPES` constant:

```ts
const LENS_TYPE_STREAK_DEFAULTS: { width: number; rotation: number }[] = [
  { width: 50, rotation: 0 },  // 50–300mm Zoom
  { width: 25, rotation: 0 },  // 35mm Prime
  { width: 75, rotation: 0 },  // 105mm Prime
  { width: 30, rotation: 0 },  // Movie Prime
  { width: 20, rotation: 0 },  // Cinematic / Anamorphic
]
```

Add two state variables and two refs after the existing `streakStrength` pair:

```ts
const [streakWidth,    setStreakWidth]    = useState(LENS_TYPE_STREAK_DEFAULTS[0].width)
const [streakRotation, setStreakRotation] = useState(0)
// …
const streakWidthRef    = useRef(LENS_TYPE_STREAK_DEFAULTS[0].width)
const streakRotationRef = useRef(0)
```

---

### Step 8 — Dialog: reset effect

**File:** `src/components/dialogs/LensFlareDialog/LensFlareDialog.tsx`

Inside the `useEffect` that resets state on `isOpen`, add the two new field resets after the `streakStrength` lines:

```ts
const def = LENS_TYPE_STREAK_DEFAULTS[0]
setStreakWidth(def.width);       streakWidthRef.current    = def.width
setStreakRotation(def.rotation); streakRotationRef.current = def.rotation
```

---

### Step 9 — Dialog: `handleLensTypeChange`

**File:** `src/components/dialogs/LensFlareDialog/LensFlareDialog.tsx`

Reset both new params to the newly selected type's defaults before triggering the immediate preview:

```ts
const handleLensTypeChange = useCallback((type: number): void => {
  setLensType(type)
  lensTypeRef.current = type
  const def = LENS_TYPE_STREAK_DEFAULTS[type]
  setStreakWidth(def.width);       streakWidthRef.current    = def.width
  setStreakRotation(def.rotation); streakRotationRef.current = def.rotation
  triggerImmediate()
}, [triggerImmediate])
```

---

### Step 10 — Dialog: new change handlers

**File:** `src/components/dialogs/LensFlareDialog/LensFlareDialog.tsx`

Add two handlers following the same clamp-and-debounce pattern as `handleStreakStrengthChange`:

```ts
const handleStreakWidthChange = useCallback((value: number): void => {
  const clamped = Math.max(1, Math.min(100, Math.round(value)))
  setStreakWidth(clamped)
  streakWidthRef.current = clamped
  triggerDebounced()
}, [triggerDebounced])

const handleStreakRotationChange = useCallback((value: number): void => {
  const clamped = Math.max(0, Math.min(359, Math.round(value)))
  setStreakRotation(clamped)
  streakRotationRef.current = clamped
  triggerDebounced()
}, [triggerDebounced])
```

---

### Step 11 — Dialog: pass new params through `runPreview` and `handleApply`

**File:** `src/components/dialogs/LensFlareDialog/LensFlareDialog.tsx`

In `runPreview`, extend the `renderLensFlare` call:

```ts
const pixels = await renderLensFlare(
  previewW, previewH, pCx, pCy,
  brightnessRef.current, lensTypeRef.current,
  ringOpacityRef.current, streakStrengthRef.current,
  streakWidthRef.current, streakRotationRef.current,
)
```

In `handleApply`, extend the `renderLensFlare` call:

```ts
const pixels = await renderLensFlare(
  width, height,
  centerXRef.current, centerYRef.current,
  brightnessRef.current, lensTypeRef.current,
  ringOpacityRef.current, streakStrengthRef.current,
  streakWidthRef.current, streakRotationRef.current,
)
```

---

### Step 12 — Dialog: new slider rows in JSX

**File:** `src/components/dialogs/LensFlareDialog/LensFlareDialog.tsx`

Insert two `<div className={styles.row}>` blocks immediately after the existing Streaks row, following the identical pattern used by Rings and Streaks:

```tsx
{/* Streak Width */}
<div className={styles.row}>
  <span className={styles.label}>Streak Width</span>
  <input
    type="range"
    className={styles.slider}
    min={1}
    max={100}
    step={1}
    value={streakWidth}
    onChange={e => handleStreakWidthChange(e.target.valueAsNumber)}
  />
  <input
    type="number"
    className={styles.numberInput}
    min={1}
    max={100}
    step={1}
    value={streakWidth}
    onChange={e => handleStreakWidthChange(e.target.valueAsNumber)}
    onBlur={e  => handleStreakWidthChange(e.target.valueAsNumber)}
  />
  <span className={styles.unit}>%</span>
</div>

{/* Streak Rotation */}
<div className={styles.row}>
  <span className={styles.label}>Streak Rotation</span>
  <input
    type="range"
    className={styles.slider}
    min={0}
    max={359}
    step={1}
    value={streakRotation}
    onChange={e => handleStreakRotationChange(e.target.valueAsNumber)}
  />
  <input
    type="number"
    className={styles.numberInput}
    min={0}
    max={359}
    step={1}
    value={streakRotation}
    onChange={e => handleStreakRotationChange(e.target.valueAsNumber)}
    onBlur={e  => handleStreakRotationChange(e.target.valueAsNumber)}
  />
  <span className={styles.unit}>°</span>
</div>
```

---

## Architectural Constraints

- **GPU uniform buffer layout** — `LensFlareParams` is 8 × `u32` = 32 bytes. Replacing `_pad0`/`_pad1` keeps the layout identical; the existing `createUniformBuffer(device, 32)` call in `runRenderLensFlare` requires no change.
- **No new state in `AppContext`** — both parameters are ephemeral dialog state with no persistence requirement. They are held in component state + refs, matching the pattern used by all other lens flare params.
- **Ref pattern for GPU calls** — preview and apply both read from `streakWidthRef`/`streakRotationRef`, not the React state values, consistent with every other parameter in the dialog. This avoids stale-closure bugs in async GPU dispatch.
- **Debounce consistency** — both new controls use `triggerDebounced` (150 ms), matching the existing Brightness, Rings, and Streaks behavior. Lens Type change resets the new controls and then calls `triggerImmediate`, preserving the existing immediate-update contract for type switches.
- **Unified rasterization pipeline** — `renderLensFlare` is a generative filter that writes directly to a new layer's pixel buffer; it does not go through the rasterization pipeline. The `onApply` callback in the calling component handles layer insertion, and no changes to `src/rasterization/` are required.

---

## Open Questions

- **Anamorphic rotation behavior at 90°** — the spec notes that rotating the anamorphic horizontal band to 90° makes it span the full canvas height. This is a natural consequence of rotating the `dy` component and requires no special handling, but the visual result (a near-vertical band across the whole canvas) should be confirmed acceptable before shipping.
- **Floating-point tightness constants** — the derived multipliers (e.g. `0.1333` for 105mm Prime) are truncated from exact fractions. Precision impact at extreme `streakWidth` values (1 or 100) should be eyeballed during implementation. If the results are unacceptable at either end, the multiplier can be expressed as `0.10 * streakWF / 0.75` explicitly, which keeps the original intent legible.
