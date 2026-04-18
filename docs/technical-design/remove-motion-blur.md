# Technical Design: Remove Motion Blur

## Overview

Remove Motion Blur is a destructive filter that attempts to reverse a known linear motion blur from the active pixel layer using Richardson-Lucy (RL) iterative deconvolution — a standard spatial-domain algorithm that works without an FFT library. The user supplies the angle and distance of the blur to undo, plus a noise reduction strength. The filter constructs a 1D line PSF oriented at the given angle, then iteratively sharpens the image using RL deconvolution with Tikhonov-style damping controlled by the `noiseReduction` parameter. It follows the identical structural pattern as Motion Blur: new WASM function → TypeScript wrapper → `FilterKey` extension → registry entry → dialog component → `App.tsx` wiring → `useFilters` callback. No new hook, no new reducer action, and no new `AppState` field are required.

---

## Affected Areas

| File | Change |
|---|---|
| `wasm/src/filters.h` | Declare `filters_remove_motion_blur` |
| `wasm/src/filters.cpp` | Implement `filters_remove_motion_blur` (RL deconvolution) |
| `wasm/src/pixelops.cpp` | Add `EMSCRIPTEN_KEEPALIVE` export `pixelops_remove_motion_blur` |
| `wasm/CMakeLists.txt` | Append `_pixelops_remove_motion_blur` to `-sEXPORTED_FUNCTIONS` |
| `src/wasm/types.ts` | Add `_pixelops_remove_motion_blur` signature to `PixelOpsModule` |
| `src/wasm/index.ts` | Add `removeMotionBlur` async wrapper |
| `src/types/index.ts` | Extend `FilterKey` union with `'remove-motion-blur'` |
| `src/filters/registry.ts` | Add `{ key: 'remove-motion-blur', label: 'Remove Motion Blur…', group: 'blur' }` entry |
| `src/components/dialogs/RemoveMotionBlurDialog/RemoveMotionBlurDialog.tsx` | **New** — modal dialog with Angle, Distance, Noise Reduction controls and angle indicator |
| `src/components/dialogs/RemoveMotionBlurDialog/RemoveMotionBlurDialog.module.scss` | **New** — dialog styles |
| `src/components/index.ts` | Export `RemoveMotionBlurDialog` and `RemoveMotionBlurDialogProps` |
| `src/App.tsx` | Import dialog, add `showRemoveMotionBlurDialog` state, add `if` case in `handleOpenFilterDialog`, render dialog |
| `src/hooks/useFilters.ts` | Add `handleOpenRemoveMotionBlur` callback and return it from `useFilters` |

---

## State Changes

No new fields in `AppState`. No new reducer actions. All dialog-local state (`angle`, `distance`, `noiseReduction`, `isBusy`, `hasSelection`, `errorMessage`) lives inside `RemoveMotionBlurDialog` via `useState`. Working refs (`originalPixelsRef`, `selectionMaskRef`, `debounceTimerRef`, `isBusyRef`) are scoped to the component and do not survive unmount.

---

## New Components / Hooks / Tools

### `RemoveMotionBlurDialog` (Dialog)

**Category:** `dialogs/`  
**Single responsibility:** Presents the Angle, Distance, and Noise Reduction controls, manages the debounced WASM preview, renders the angle indicator SVG, and commits or discards the effect on Apply/Cancel.  
**Inputs:** `RemoveMotionBlurDialogProps` (see Implementation Steps below).  
**Outputs:** writes pixels via `canvasHandleRef.writeLayerPixels`, calls `captureHistory` and `onClose` on Apply.

### `AngleIndicator` (file-internal React component)

**Category:** internal to `RemoveMotionBlurDialog.tsx` — not exported.  
**Single responsibility:** renders a 40×40 SVG compass rose showing the current deconvolution direction. Purely visual; `pointer-events: none`.  
**Input:** `angle: number` (degrees, 0–360). Identical implementation to the one in `MotionBlurDialog.tsx`.

---

## Implementation Steps

### Step 1 — `wasm/src/filters.h`

Append the following declaration after `filters_motion_blur`:

```cpp
/// Richardson-Lucy iterative deconvolution to reverse a linear motion blur,
/// applied in-place. Channels R, G, B are processed independently; alpha unchanged.
/// angleDeg: 0–360 (0 = horizontal right, increases clockwise).
/// distance: PSF kernel length in pixels (1–999); minimum 1.
/// noiseReduction: Tikhonov damping strength (0–100).
///   0 = pure RL (maximum sharpness, may ring).
///   100 = 50% blend back to input (soft, suppresses ringing).
void filters_remove_motion_blur(
    uint8_t* pixels, int width, int height,
    float angleDeg, int distance, int noiseReduction
);
```

---

### Step 2 — `wasm/src/filters.cpp`

Add `filters_remove_motion_blur` at the end of the file. The function processes R, G, B channels independently. Alpha is left unchanged.

#### Algorithm overview

1. Build a 1D line PSF of length `numSamples = max(distance, 1)` with equal weights `1/numSamples`, oriented at `angleDeg`.
2. Run Richardson-Lucy iterative deconvolution for `numIterations = max(2, 6 - noiseReduction / 20)` iterations (range 2–6).
3. After convergence, blend the RL result back toward the original with weight `blend = noiseReduction / 100.0f * 0.5f`.
4. Clamp the output to `[0, 255]`.

The convolution helper samples along the PSF direction using repeat-edge clamping — the same approach as `filters_motion_blur`.

```cpp
// ─── Convolution helper ─────────────────────────────────────────────────────
// Convolves a single-channel float buffer with the motion PSF.
// src and dst must be the same size (width * height floats).
// Samples are taken at offsets s = 0..numSamples-1 along (dx, dy).
static void convolve_psf(
    const std::vector<float>& src,
    std::vector<float>&       dst,
    int                       width,
    int                       height,
    float                     dx,
    float                     dy,
    int                       numSamples
) {
    const float weight = 1.f / (float)numSamples;
    const int halfK = numSamples / 2;

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            float acc = 0.f;
            for (int s = 0; s < numSamples; ++s) {
                const int t  = s - halfK;
                const int sx = std::clamp((int)std::round((float)x + dx * (float)t), 0, width  - 1);
                const int sy = std::clamp((int)std::round((float)y + dy * (float)t), 0, height - 1);
                acc += src[sy * width + sx] * weight;
            }
            dst[y * width + x] = acc;
        }
    }
}

// ─── Remove Motion Blur (Richardson-Lucy deconvolution) ─────────────────────

void filters_remove_motion_blur(
    uint8_t* pixels, int width, int height,
    float angleDeg, int distance, int noiseReduction
) {
    if (width <= 0 || height <= 0) return;

    const int numSamples = std::max(distance, 1);
    // distance == 1 → PSF is a single-sample no-op; output equals input
    if (numSamples == 1) return;

    const int numIterations = std::max(2, 6 - noiseReduction / 20);
    const float blendToInput = (float)noiseReduction / 100.f * 0.5f;

    const float angleRad = angleDeg * (float)M_PI / 180.f;
    const float dx = std::cos(angleRad);
    const float dy = std::sin(angleRad);

    const int N = width * height;

    // Temporary float buffers for a single channel
    std::vector<float> observed(N);
    std::vector<float> estimate(N);
    std::vector<float> blurred_estimate(N);
    std::vector<float> ratio(N);
    std::vector<float> correction(N);

    // Process R, G, B channels independently; alpha at channel index 3 is untouched
    for (int ch = 0; ch < 3; ++ch) {
        // Load channel into float buffers (normalize to [0, 1])
        for (int i = 0; i < N; ++i) {
            const float v = (float)pixels[i * 4 + ch] / 255.f;
            observed[i] = v;
            estimate[i] = v;   // RL initial estimate = observed image
        }

        // Richardson-Lucy iterations
        for (int iter = 0; iter < numIterations; ++iter) {
            // Step 1: blurred_estimate = convolve(estimate, PSF)
            convolve_psf(estimate, blurred_estimate, width, height, dx, dy, numSamples);

            // Step 2: ratio = observed / blurred_estimate (clamp denominator to 0.001)
            for (int i = 0; i < N; ++i) {
                ratio[i] = observed[i] / std::max(blurred_estimate[i], 0.001f);
            }

            // Step 3: correction = convolve(ratio, flipped PSF)
            // Flipped PSF: negate the direction vector (dx, dy) → (-dx, -dy).
            // The kernel is symmetric (equal weights), so direction flip is equivalent
            // to index reversal of a symmetric kernel — which is the same kernel.
            // Equivalently: convolve with PSF direction (-dx, -dy).
            convolve_psf(ratio, correction, width, height, -dx, -dy, numSamples);

            // Step 4: estimate = estimate * correction
            for (int i = 0; i < N; ++i) {
                estimate[i] *= correction[i];
            }
        }

        // Tikhonov-style damping: blend RL result back toward observed
        // blend = 0 at noiseReduction=0 (pure RL), 0.5 at noiseReduction=100
        if (blendToInput > 0.f) {
            for (int i = 0; i < N; ++i) {
                estimate[i] = estimate[i] * (1.f - blendToInput) + observed[i] * blendToInput;
            }
        }

        // Write back to pixel buffer, clamped to [0, 255]
        for (int i = 0; i < N; ++i) {
            pixels[i * 4 + ch] = (uint8_t)std::clamp(
                (int)std::round(estimate[i] * 255.f), 0, 255
            );
        }
    }
    // Alpha channel (index 3) is intentionally not modified.
}
```

**Notes:**
- `numIterations = max(2, 6 - noiseReduction / 20)` gives 6 iterations at `noiseReduction=0` (integer division: `6 - 0/20 = 6`) down to 2 at `noiseReduction=100` (`6 - 100/20 = 6 - 5 = 1` → clamped to 2). The clamp to 2 ensures at least one meaningful RL step regardless of input.
- The flipped PSF has the same weights as the forward PSF (all `1/numSamples`); the only change is the direction vector is negated. Because the PSF is symmetric in weight distribution, this is equivalent to reversing the sample order, which for a uniform kernel produces the same result. This is correct RL: the back-projection uses the transpose (mirror) of the PSF operator.
- `blendToInput = noiseReduction / 100.0f * 0.5f` maps the 0–100 range to a 0–0.5 blend weight. At 100, the output is 50% RL + 50% input.
- Each channel uses its own independent `observed`, `estimate` derived from the input pixels.
- `M_PI` is available via the `<cmath>` include already present in `filters.cpp`.

---

### Step 3 — `wasm/src/pixelops.cpp`

Add the following block after the `pixelops_motion_blur` export:

```cpp
// ─── Remove Motion Blur (Richardson-Lucy deconvolution, in-place) ─────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_remove_motion_blur(
    uint8_t* pixels, int width, int height,
    float angleDeg, int distance, int noiseReduction
) {
    filters_remove_motion_blur(pixels, width, height, angleDeg, distance, noiseReduction);
}
```

`float angleDeg` is passed directly as a JS `number`; Emscripten coerces it to f32 on the WASM stack — no `HEAPF32` indirection needed for scalar arguments.

---

### Step 4 — `wasm/CMakeLists.txt`

In the `target_link_options` block, extend the `-sEXPORTED_FUNCTIONS` line by appending `_pixelops_remove_motion_blur` at the end:

```
"-sEXPORTED_FUNCTIONS=_malloc,_free,_pixelops_flood_fill,_pixelops_gaussian_blur,_pixelops_box_blur,_pixelops_convolve,_pixelops_resize_bilinear,_pixelops_resize_nearest,_pixelops_dither_floyd_steinberg,_pixelops_dither_bayer,_pixelops_quantize,_pixelops_curves_histogram,_pixelops_radial_blur,_pixelops_sharpen,_pixelops_sharpen_more,_pixelops_unsharp_mask,_pixelops_smart_sharpen,_pixelops_add_noise,_pixelops_film_grain,_pixelops_lens_blur,_pixelops_clouds,_pixelops_motion_blur,_pixelops_remove_motion_blur"
```

After editing, run `npm run build:wasm` to regenerate `src/wasm/generated/`.

---

### Step 5 — `src/wasm/types.ts`

Add the new signature inside the `PixelOpsModule` interface, after `_pixelops_motion_blur`:

```ts
_pixelops_remove_motion_blur(
  pixelsPtr: number, width: number, height: number,
  angleDeg: number, distance: number, noiseReduction: number
): void
```

---

### Step 6 — `src/wasm/index.ts`

Add the public wrapper after `motionBlur`:

```ts
/** Remove Motion Blur via Richardson-Lucy iterative deconvolution (in-place).
 *  angleDeg: 0–360 (0 = horizontal right, clockwise).
 *  distance: PSF kernel length in pixels (1–999).
 *  noiseReduction: Tikhonov damping strength 0–100 (0 = pure RL, 100 = 50% blend to input). */
export async function removeMotionBlur(
  pixels: Uint8Array, width: number, height: number,
  angleDeg: number, distance: number, noiseReduction: number
): Promise<Uint8Array> {
  const m = await getPixelOps()
  return withInPlaceBuffer(m, pixels, ptr =>
    m._pixelops_remove_motion_blur(ptr, width, height, angleDeg, distance, noiseReduction)
  )
}
```

---

### Step 7 — `src/types/index.ts`

Extend the `FilterKey` union by appending `'remove-motion-blur'`:

```ts
export type FilterKey =
  | 'gaussian-blur'
  | 'box-blur'
  | 'radial-blur'
  | 'motion-blur'
  | 'remove-motion-blur'   // ← add
  | 'sharpen'
  | 'sharpen-more'
  | 'unsharp-mask'
  | 'smart-sharpen'
  | 'add-noise'
  | 'film-grain'
  | 'lens-blur'
  | 'clouds'
```

---

### Step 8 — `src/filters/registry.ts`

Add the new entry to `FILTER_REGISTRY`. Insert it immediately after `'motion-blur'` to keep the Blur group contiguous:

```ts
{ key: 'motion-blur',         label: 'Motion Blur…',          group: 'blur' },
{ key: 'remove-motion-blur',  label: 'Remove Motion Blur…',   group: 'blur' },  // ← add
{ key: 'lens-blur',           label: 'Lens Blur…',            group: 'blur' },
```

---

### Step 9 — `src/components/dialogs/RemoveMotionBlurDialog/RemoveMotionBlurDialog.tsx`

Create the file. Full folder structure:

```
src/components/dialogs/RemoveMotionBlurDialog/
  RemoveMotionBlurDialog.tsx
  RemoveMotionBlurDialog.module.scss
```

#### Props

```ts
export interface RemoveMotionBlurDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}
```

The same six props used by every other filter dialog.

#### File-level constants

```ts
const MIN_ANGLE      = 0
const MAX_ANGLE      = 360
const DEFAULT_ANGLE  = 0

const MIN_DISTANCE      = 1
const MAX_DISTANCE      = 999
const DEFAULT_DISTANCE  = 10

const MIN_NOISE_REDUCTION      = 0
const MAX_NOISE_REDUCTION      = 100
const DEFAULT_NOISE_REDUCTION  = 10

const DEBOUNCE_MS = 400

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)))
}
```

#### Selection-aware compositing helper (module-level, not exported)

Identical pattern to all other filter dialogs:

```ts
function applySelectionComposite(
  processed: Uint8Array,
  original:  Uint8Array,
  mask:      Uint8Array | null,
): Uint8Array {
  if (mask === null) return processed
  const out = original.slice()
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) {
      const p = i * 4
      out[p]     = processed[p]
      out[p + 1] = processed[p + 1]
      out[p + 2] = processed[p + 2]
      out[p + 3] = processed[p + 3]
    }
  }
  return out
}
```

The deconvolution input is always the full canvas-size original buffer so that boundary pixels can sample across the selection boundary — identical reasoning as in all sibling dialogs.

#### SVG icon components (file-internal, not exported)

```tsx
const CloseIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
       strokeLinecap="round" width="10" height="10" aria-hidden="true">
    <line x1="1" y1="1" x2="11" y2="11" />
    <line x1="11" y1="1" x2="1" y2="11" />
  </svg>
)

// Deconvolution / reversal icon: blur trails fanning out on the left,
// all converging to a single sharp focal point on the right —
// the visual inverse of MotionBlurIcon which spreads from a point outward.
const RemoveMotionBlurIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    {/* Far fan trail (very faint) — starts wide-left, converges right */}
    <line x1="1.0" y1="2.2" x2="9.8" y2="6.0"
          stroke="currentColor" strokeWidth="0.7" opacity="0.18" strokeLinecap="round"/>
    {/* Near fan trail */}
    <line x1="1.0" y1="4.2" x2="9.8" y2="6.0"
          stroke="currentColor" strokeWidth="0.85" opacity="0.45" strokeLinecap="round"/>
    {/* Main convergence line (centre) */}
    <line x1="1.0" y1="6.0" x2="9.8" y2="6.0"
          stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    {/* Near fan trail (below) */}
    <line x1="1.0" y1="7.8" x2="9.8" y2="6.0"
          stroke="currentColor" strokeWidth="0.85" opacity="0.45" strokeLinecap="round"/>
    {/* Far fan trail (very faint, below) */}
    <line x1="1.0" y1="9.8" x2="9.8" y2="6.0"
          stroke="currentColor" strokeWidth="0.7" opacity="0.18" strokeLinecap="round"/>
    {/* Convergence dot at the focal point (right) */}
    <circle cx="9.8" cy="6.0" r="1.5" fill="currentColor"/>
  </svg>
)
```

#### `AngleIndicator` component (file-internal, not exported)

A purely visual 40×40 SVG compass rose that shows the current deconvolution direction as an arrow. `pointer-events: none` — clicking it does nothing.

Identical implementation to `MotionBlurDialog`'s `AngleIndicator` — it may be copy-pasted verbatim.

```tsx
interface AngleIndicatorProps { angle: number }

function AngleIndicator({ angle }: AngleIndicatorProps): React.JSX.Element {
  const HEAD_LEN   = 5    // arrowhead depth in px
  const HEAD_WIDTH = 3.6  // arrowhead base half-width in px
  const ARROW_R    = 14   // distance from center to arrow tip

  const rad  = angle * Math.PI / 180
  const ux   = Math.cos(rad)
  const uy   = Math.sin(rad)
  const tipX = 20 + ARROW_R * ux
  const tipY = 20 + ARROW_R * uy

  const baseCX = tipX - ux * HEAD_LEN
  const baseCY = tipY - uy * HEAD_LEN
  const lx = baseCX + (-uy) * HEAD_WIDTH
  const ly = baseCY + ( ux) * HEAD_WIDTH
  const rx = baseCX + ( uy) * HEAD_WIDTH
  const ry = baseCY + (-ux) * HEAD_WIDTH

  const arrowPoints = `${tipX},${tipY} ${lx},${ly} ${rx},${ry}`

  return (
    <svg
      viewBox="0 0 40 40"
      width="40"
      height="40"
      xmlns="http://www.w3.org/2000/svg"
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
    >
      {/* Outer ring */}
      <circle cx="20" cy="20" r="18" stroke="#555555" strokeWidth="0.8" fill="none" opacity="0.55"/>
      {/* Cardinal ticks N/E/S/W */}
      <line x1="20" y1="2"  x2="20" y2="6.5"  stroke="#555555" strokeWidth="1"   opacity="0.6"/>
      <line x1="38" y1="20" x2="33.5" y2="20" stroke="#555555" strokeWidth="1"   opacity="0.6"/>
      <line x1="20" y1="38" x2="20" y2="33.5" stroke="#555555" strokeWidth="1"   opacity="0.6"/>
      <line x1="2"  y1="20" x2="6.5"  y2="20" stroke="#555555" strokeWidth="1"   opacity="0.6"/>
      {/* Diagonal ticks at 45° NE/SE/SW/NW */}
      <line x1="32.7" y1="7.3"  x2="30.1" y2="9.9"  stroke="#555555" strokeWidth="0.7" opacity="0.32"/>
      <line x1="32.7" y1="32.7" x2="30.1" y2="30.1" stroke="#555555" strokeWidth="0.7" opacity="0.32"/>
      <line x1="7.3"  y1="32.7" x2="9.9"  y2="30.1" stroke="#555555" strokeWidth="0.7" opacity="0.32"/>
      <line x1="7.3"  y1="7.3"  x2="9.9"  y2="9.9"  stroke="#555555" strokeWidth="0.7" opacity="0.32"/>
      {/* Direction line: center → tip */}
      <line x1="20" y1="20" x2={tipX} y2={tipY}
            stroke="#0699fb" strokeWidth="1.5" strokeLinecap="round"/>
      {/* Arrowhead at tip */}
      <polygon points={arrowPoints} fill="#0699fb"/>
      {/* Center dot */}
      <circle cx="20" cy="20" r="2" fill="#0699fb"/>
    </svg>
  )
}
```

#### Internal state and refs

| Name | Kind | Purpose |
|---|---|---|
| `angle` | `useState<number>(DEFAULT_ANGLE)` | Controlled value for the Angle slider and number input |
| `distance` | `useState<number>(DEFAULT_DISTANCE)` | Controlled value for the Distance slider and number input |
| `noiseReduction` | `useState<number>(DEFAULT_NOISE_REDUCTION)` | Controlled value for the Noise Reduction slider and number input |
| `isBusy` | `useState<boolean>(false)` | True while a WASM call is in flight; disables Apply |
| `hasSelection` | `useState<boolean>(false)` | Whether a selection was active at dialog open; drives selection-note visibility |
| `errorMessage` | `useState<string \| null>(null)` | Non-null when an Apply or preview call fails |
| `isBusyRef` | `useRef<boolean>(false)` | Synchronous mirror of `isBusy` for reads inside async callbacks where closure staleness is a risk |
| `originalPixelsRef` | `useRef<Uint8Array \| null>(null)` | Canvas-size RGBA snapshot taken at open; ground truth for preview and cancel |
| `selectionMaskRef` | `useRef<Uint8Array \| null>(null)` | Snapshot of `selectionStore.mask` taken at open; frozen for the dialog's lifetime |
| `debounceTimerRef` | `useRef<ReturnType<typeof setTimeout> \| null>(null)` | Handle for the pending debounce timer |

#### Initialization effect

```ts
useEffect(() => {
  if (!isOpen) return
  const handle = canvasHandleRef.current
  if (!handle || activeLayerId == null) return

  originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
  selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
  setAngle(DEFAULT_ANGLE)
  setDistance(DEFAULT_DISTANCE)
  setNoiseReduction(DEFAULT_NOISE_REDUCTION)
  setIsBusy(false)
  isBusyRef.current = false
  setHasSelection(selectionMaskRef.current !== null)
  setErrorMessage(null)

  return () => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }
}, [isOpen, canvasHandleRef, activeLayerId])
```

#### `runPreview` callback

```ts
const runPreview = useCallback(async (a: number, d: number, n: number): Promise<void> => {
  const handle   = canvasHandleRef.current
  const original = originalPixelsRef.current
  if (!handle || activeLayerId == null || original == null) return

  if (isBusyRef.current) {
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(a, d, n)
    }, 100)
    return
  }

  isBusyRef.current = true
  setIsBusy(true)
  setErrorMessage(null)
  try {
    const result   = await removeMotionBlur(original.slice(), canvasWidth, canvasHeight, a, d, n)
    const composed = applySelectionComposite(result, original, selectionMaskRef.current)
    handle.writeLayerPixels(activeLayerId, composed)
  } catch (err) {
    setErrorMessage('Failed to preview Remove Motion Blur.')
    console.error('[RemoveMotionBlur] preview error:', err)
  } finally {
    isBusyRef.current = false
    setIsBusy(false)
  }
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])
```

#### Change handlers

All three controls share the same debounce pattern via a `schedulePreview` helper:

```ts
const schedulePreview = useCallback((a: number, d: number, n: number): void => {
  if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
  debounceTimerRef.current = setTimeout(() => {
    debounceTimerRef.current = null
    void runPreview(a, d, n)
  }, DEBOUNCE_MS)
}, [runPreview])

const handleAngleChange = useCallback((value: number): void => {
  const clamped = clamp(value, MIN_ANGLE, MAX_ANGLE)
  setAngle(clamped)
  schedulePreview(clamped, distance, noiseReduction)
}, [schedulePreview, distance, noiseReduction])

const handleDistanceChange = useCallback((value: number): void => {
  const clamped = clamp(value, MIN_DISTANCE, MAX_DISTANCE)
  setDistance(clamped)
  schedulePreview(angle, clamped, noiseReduction)
}, [schedulePreview, angle, noiseReduction])

const handleNoiseReductionChange = useCallback((value: number): void => {
  const clamped = clamp(value, MIN_NOISE_REDUCTION, MAX_NOISE_REDUCTION)
  setNoiseReduction(clamped)
  schedulePreview(angle, distance, clamped)
}, [schedulePreview, angle, distance])
```

#### Apply handler

```ts
const handleApply = useCallback(async (): Promise<void> => {
  const handle   = canvasHandleRef.current
  const original = originalPixelsRef.current
  if (!handle || activeLayerId == null || original == null) return

  if (debounceTimerRef.current !== null) {
    clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = null
  }

  isBusyRef.current = true
  setIsBusy(true)
  setErrorMessage(null)
  try {
    // Re-run from originals — correct regardless of preview timing
    const result   = await removeMotionBlur(
      original.slice(), canvasWidth, canvasHeight, angle, distance, noiseReduction
    )
    const composed = applySelectionComposite(result, original, selectionMaskRef.current)
    handle.writeLayerPixels(activeLayerId, composed)
    captureHistory('Remove Motion Blur')
    onClose()
  } catch (err) {
    setErrorMessage('Failed to apply Remove Motion Blur: could not read layer pixels.')
    console.error('[RemoveMotionBlur] apply error:', err)
  } finally {
    isBusyRef.current = false
    setIsBusy(false)
  }
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, angle, distance, noiseReduction, captureHistory, onClose])
```

**History semantics:** `captureHistory('Remove Motion Blur')` is called _after_ `writeLayerPixels`. Internally, `captureHistory` calls `canvasHandle.captureAllLayerPixels()` which snapshots `layer.data` — the just-written deconvolved pixels. The previous history tip (captured before the dialog opened) is the pre-filter state; Ctrl+Z restores to it.

#### Cancel handler

```ts
const handleCancel = useCallback((): void => {
  if (debounceTimerRef.current !== null) {
    clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = null
  }
  const handle   = canvasHandleRef.current
  const original = originalPixelsRef.current
  if (handle && activeLayerId != null && original != null) {
    handle.writeLayerPixels(activeLayerId, original)
  }
  onClose()
}, [canvasHandleRef, activeLayerId, onClose])
```

No `captureHistory` call — undo stack is untouched.

#### JSX structure

```tsx
return (
  <ModalDialog
    isOpen={isOpen}
    onClose={handleCancel}
    aria-label="Remove Motion Blur"
  >
    {/* Header */}
    <div className={styles.header}>
      <span className={styles.headerIcon}><RemoveMotionBlurIcon /></span>
      <span className={styles.title}>Remove Motion Blur</span>
      <button className={styles.closeBtn} onClick={handleCancel} aria-label="Cancel (Esc)">
        <CloseIcon />
      </button>
    </div>

    {/* Body */}
    <div className={styles.body}>

      {/* Angle row */}
      <div className={styles.row}>
        <span className={styles.label} id="lbl-angle">Angle</span>
        <input type="range" className={styles.slider}
               min={MIN_ANGLE} max={MAX_ANGLE} step={1} value={angle}
               onChange={e => handleAngleChange(Number(e.target.value))}
               aria-labelledby="lbl-angle"
               style={{ '--pct': `${((angle - MIN_ANGLE) / (MAX_ANGLE - MIN_ANGLE)) * 100}%` } as React.CSSProperties} />
        <input type="number" className={styles.numberInput}
               min={MIN_ANGLE} max={MAX_ANGLE} step={1} value={angle}
               onChange={e => handleAngleChange(Number(e.target.value))}
               onBlur={e => handleAngleChange(Number(e.target.value))}
               aria-label="Angle in degrees" />
        <span className={styles.unit}>°</span>
      </div>

      {/* Angle indicator — purely visual, no interaction */}
      <div className={styles.angleIndicatorRow} aria-hidden="true">
        <AngleIndicator angle={angle} />
      </div>

      {/* Distance row */}
      <div className={styles.row}>
        <span className={styles.label} id="lbl-dist">Distance</span>
        <input type="range" className={styles.slider}
               min={MIN_DISTANCE} max={MAX_DISTANCE} step={1} value={distance}
               onChange={e => handleDistanceChange(Number(e.target.value))}
               aria-labelledby="lbl-dist"
               style={{ '--pct': `${((distance - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE)) * 100}%` } as React.CSSProperties} />
        <input type="number" className={styles.numberInput}
               min={MIN_DISTANCE} max={MAX_DISTANCE} step={1} value={distance}
               onChange={e => handleDistanceChange(Number(e.target.value))}
               onBlur={e => handleDistanceChange(Number(e.target.value))}
               aria-label="Distance in pixels" />
        <span className={styles.unit}>px</span>
      </div>

      {/* Noise Reduction row */}
      <div className={styles.row}>
        <span className={styles.label} id="lbl-noise">
          Noise
          <span
            className={styles.infoIcon}
            data-tooltip="Higher values reduce ringing but may look softer"
            aria-label="Higher values reduce ringing but may look softer"
            role="img"
            tabIndex={0}
          >ⓘ</span>
        </span>
        <input type="range" className={styles.slider}
               min={MIN_NOISE_REDUCTION} max={MAX_NOISE_REDUCTION} step={1} value={noiseReduction}
               onChange={e => handleNoiseReductionChange(Number(e.target.value))}
               aria-labelledby="lbl-noise"
               style={{ '--pct': `${((noiseReduction - MIN_NOISE_REDUCTION) / (MAX_NOISE_REDUCTION - MIN_NOISE_REDUCTION)) * 100}%` } as React.CSSProperties} />
        <input type="number" className={styles.numberInput}
               min={MIN_NOISE_REDUCTION} max={MAX_NOISE_REDUCTION} step={1} value={noiseReduction}
               onChange={e => handleNoiseReductionChange(Number(e.target.value))}
               onBlur={e => handleNoiseReductionChange(Number(e.target.value))}
               aria-label="Noise Reduction percentage" />
        <span className={styles.unit}>%</span>
      </div>

      {/* Preview indicator (shown while isBusy) */}
      {isBusy && (
        <div className={styles.previewIndicator} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          Previewing…
          <span className={styles.previewParams}>{angle}° · {distance} px · {noiseReduction}%</span>
        </div>
      )}

      {/* Selection note (shown when hasSelection) */}
      {hasSelection && (
        <div className={styles.selectionNote} role="note">
          <span className={styles.selectionNoteIcon} aria-hidden="true">
            <svg viewBox="0 0 11 11" fill="none" width="10" height="10">
              <rect x="1" y="1" width="9" height="9" rx="1"
                    stroke="currentColor" strokeWidth="1"
                    strokeDasharray="2 1.5" fill="none"/>
            </svg>
          </span>
          <span className={styles.selectionNoteText}>
            Selection active — deconvolution applies only within the selected area.
          </span>
        </div>
      )}

      {/* Error message */}
      {errorMessage != null && (
        <div className={styles.errorMessage} role="alert">
          {errorMessage}
        </div>
      )}

    </div>

    {/* Footer */}
    <div className={styles.footer}>
      <button className={styles.btnCancel} onClick={handleCancel}>Cancel</button>
      <button className={styles.btnApply} onClick={() => { void handleApply() }}
              disabled={isBusy}>Apply</button>
    </div>
  </ModalDialog>
)
```

---

### Step 10 — `src/components/dialogs/RemoveMotionBlurDialog/RemoveMotionBlurDialog.module.scss`

Mirror the SCSS from `MotionBlurDialog.module.scss` without modification to the shared structural classes. The only additional class is `.infoIcon` for the Noise Reduction label's tooltip trigger. Add it after the `.label` rule:

```scss
.infoIcon {
  display: inline-block;
  font-size: 9px;
  color: var(--color-text-muted);
  cursor: default;
  vertical-align: middle;
  position: relative;
  margin-left: 1px;
  line-height: 1;

  &::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 5px);
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a1a;
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-md);
    color: var(--color-text-dim);
    font-size: 10px;
    white-space: nowrap;
    padding: 4px 7px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 100ms;
    z-index: 999;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }

  &:hover::after,
  &:focus::after {
    opacity: 1;
  }
}
```

The full list of class names used by the component:

```
.header, .headerIcon, .title, .closeBtn
.body, .row, .label, .infoIcon, .slider, .numberInput, .unit
.angleIndicatorRow
.previewIndicator, .spinner, .previewParams
.selectionNote, .selectionNoteIcon, .selectionNoteText
.errorMessage
.footer, .btnCancel, .btnApply
```

The `.angleIndicatorRow` class uses `padding: 2px 0 4px 52px` to indent the compass to align with the slider track start, matching the UX design and the pattern in `MotionBlurDialog.module.scss`.

---

### Step 11 — `src/components/index.ts`

Add the two new exports alongside the other dialog exports:

```ts
export { RemoveMotionBlurDialog } from './dialogs/RemoveMotionBlurDialog/RemoveMotionBlurDialog'
export type { RemoveMotionBlurDialogProps } from './dialogs/RemoveMotionBlurDialog/RemoveMotionBlurDialog'
```

---

### Step 12 — `src/App.tsx`

**12a. Import**

Add the import after the `MotionBlurDialog` import:

```ts
import { RemoveMotionBlurDialog } from '@/components/dialogs/RemoveMotionBlurDialog/RemoveMotionBlurDialog'
```

**12b. State**

Add the state variable alongside `showMotionBlurDialog`:

```ts
const [showRemoveMotionBlurDialog, setShowRemoveMotionBlurDialog] = useState(false)
```

**12c. `handleOpenFilterDialog`**

Add the case immediately after the `'motion-blur'` case:

```ts
if (key === 'motion-blur')        setShowMotionBlurDialog(true)
if (key === 'remove-motion-blur') setShowRemoveMotionBlurDialog(true)  // ← add
```

**12d. Dialog render**

Add the component render immediately after the `MotionBlurDialog` render block:

```tsx
{showRemoveMotionBlurDialog && (
  <RemoveMotionBlurDialog
    isOpen={showRemoveMotionBlurDialog}
    onClose={() => setShowRemoveMotionBlurDialog(false)}
    canvasHandleRef={canvasHandleRef}
    activeLayerId={state.activeLayerId}
    captureHistory={captureHistory}
    canvasWidth={state.canvas.width}
    canvasHeight={state.canvas.height}
  />
)}
```

---

### Step 13 — `src/hooks/useFilters.ts`

**13a. Add to `UseFiltersReturn`**

```ts
handleOpenRemoveMotionBlur: () => void
```

**13b. Add the callback**

Add immediately after the `handleOpenMotionBlur` callback:

```ts
const handleOpenRemoveMotionBlur = useCallback(
  () => onOpenFilterDialog('remove-motion-blur'),
  [onOpenFilterDialog]
)
```

**13c. Add to the return object**

```ts
return {
  // … existing fields …
  handleOpenMotionBlur,
  handleOpenRemoveMotionBlur,   // ← add
  // … rest …
}
```

---

## Architectural Constraints

- **WASM boundary** (`AGENTS.md` → WASM / C++ Layer): the Richardson-Lucy implementation lives entirely in `wasm/src/filters.cpp`. The TypeScript side calls only through `src/wasm/index.ts`; `src/wasm/generated/` is never imported directly.
- **No new state** (`AGENTS.md` → State): all dialog-local state lives in component `useState`. No new `AppState` fields and no new reducer actions are required.
- **No business logic in `App.tsx`** (`AGENTS.md` → `App.tsx`): the only additions to `App.tsx` are a `useState` flag, a one-line `if` branch in the existing `handleOpenFilterDialog` callback, and the dialog render. All preview/apply/cancel logic lives in `RemoveMotionBlurDialog`.
- **Dialog category** (`AGENTS.md` → Components): `RemoveMotionBlurDialog` is a `dialogs/` component. It wraps `ModalDialog`, composes `AngleIndicator` (file-internal), and accesses `canvasHandleRef` and `captureHistory` via props — not `AppContext`.
- **CSS Modules** (`AGENTS.md` → CSS Modules): the stylesheet is `.module.scss`, not `.scss`.
- **Memory safety** (`AGENTS.md` → Memory rules): `original.slice()` is passed to every WASM call so the input buffer is not mutated. `withInPlaceBuffer` in `src/wasm/index.ts` handles `_malloc`/`_free` automatically.
- **Unified rasterization pipeline** (`AGENTS.md` → Unified Rasterization Pipeline): Remove Motion Blur is a destructive one-shot filter that writes pixels directly to the layer. It does not participate in the adjustment/compositing render plan — consistent with all other filters in the `FILTER_REGISTRY` that are not adjustment layers.

---

## Open Questions

- **Performance on large canvases**: RL deconvolution with 3–6 iterations and a spatial convolution per iteration is O(N · distance · iterations) where N = pixel count. For a 4000×4000 canvas with Distance=200 and noiseReduction=0 (6 iterations), that is ~6 billion float operations. The debounce on the preview mitigates UI jank, but Apply may feel slow. A future optimization could perform the RL pass on the selection bounding box only rather than the full canvas — but this is not required by the spec.
- **RL divergence at noiseReduction=0 with large Distance**: RL can diverge (amplify noise indefinitely) with a high number of iterations and no damping. The floor of 2 iterations and the max of 6 is a practical safeguard; the spec explicitly documents ringing as expected behavior at noiseReduction=0.
- **Angle 0° vs 360° PSF equivalence**: `cos(0) = cos(2π) = 1`, `sin(0) = sin(2π) = 0` — both produce identical horizontal PSFs as required by the spec.
