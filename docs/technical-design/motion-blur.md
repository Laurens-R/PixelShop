# Technical Design: Motion Blur

## Overview

Motion Blur is a destructive filter that smears the active pixel layer's pixels along a straight directional line, simulating camera/subject motion during an exposure. The blur is computed in C++/WASM as a uniform box-average over a configurable number of samples (Distance) taken symmetrically along a direction vector (Angle). It follows the identical structural pattern as Gaussian Blur and Radial Blur: new WASM function → TypeScript wrapper → `FilterKey` extension → registry entry → dialog component → App.tsx wiring. No new hook, no new reducer action, and no new `AppState` field are required.

---

## Affected Areas

| File | Change |
|---|---|
| `wasm/src/filters.h` | Declare `filters_motion_blur` |
| `wasm/src/filters.cpp` | Implement `filters_motion_blur` |
| `wasm/src/pixelops.cpp` | Add `EMSCRIPTEN_KEEPALIVE` export `pixelops_motion_blur` |
| `wasm/CMakeLists.txt` | Append `_pixelops_motion_blur` to `-sEXPORTED_FUNCTIONS` |
| `src/wasm/types.ts` | Add `_pixelops_motion_blur` signature to `PixelOpsModule` |
| `src/wasm/index.ts` | Add `motionBlur` async wrapper |
| `src/types/index.ts` | Extend `FilterKey` union with `'motion-blur'` |
| `src/filters/registry.ts` | Add `{ key: 'motion-blur', label: 'Motion Blur…', group: 'blur' }` entry |
| `src/components/dialogs/MotionBlurDialog/MotionBlurDialog.tsx` | **New** — modal dialog with Angle, Distance controls and angle indicator |
| `src/components/dialogs/MotionBlurDialog/MotionBlurDialog.module.scss` | **New** — dialog styles |
| `src/components/index.ts` | Export `MotionBlurDialog` and `MotionBlurDialogProps` |
| `src/App.tsx` | Import dialog, add `showMotionBlurDialog` state, add `if` case in `handleOpenFilterDialog`, render dialog |

---

## State Changes

No new fields in `AppState`. No new reducer actions. All dialog-local state (`angle`, `distance`, `isBusy`, `hasSelection`, `errorMessage`) lives inside `MotionBlurDialog` via `useState`. Working refs (`originalPixelsRef`, `selectionMaskRef`, `debounceTimerRef`, `isBusyRef`) are scoped to the component and do not survive unmount.

---

## New Components / Hooks / Tools

### `MotionBlurDialog` (Dialog)

**Category:** `dialogs/`  
**Single responsibility:** Presents the Angle and Distance controls, manages the debounced WASM preview, renders the angle indicator SVG, and commits or discards the effect on Apply/Cancel.  
**Inputs:** `MotionBlurDialogProps` (see Implementation Steps below).  
**Outputs:** writes pixels via `canvasHandleRef.writeLayerPixels`, calls `captureHistory` and `onClose` on Apply.

### `AngleIndicator` (file-internal React component)

**Category:** internal to `MotionBlurDialog.tsx` — not exported.  
**Single responsibility:** renders a 40×40 SVG compass rose showing the current blur direction. Purely visual; `pointer-events: none`.  
**Input:** `angle: number` (degrees, 0–360).

---

## Implementation Steps

### Step 1 — `wasm/src/filters.h`

Append the following declaration after `filters_radial_blur`:

```cpp
/// Motion blur applied in-place.
/// Computes a box-average along a straight line at the given angle.
/// angleDeg: 0–360 (0 = horizontal right, increases clockwise).
/// distance: kernel length in samples (1–999); minimum 1.
void filters_motion_blur(
    uint8_t* pixels, int width, int height,
    float angleDeg, int distance
);
```

---

### Step 2 — `wasm/src/filters.cpp`

Add `filters_motion_blur` at the end of the file. The function works in-place: allocate a read-only copy of `pixels` at the start, write results back into the original buffer.

```cpp
void filters_motion_blur(
    uint8_t* pixels, int width, int height,
    float angleDeg, int distance
) {
    if (distance <= 0 || width <= 0 || height <= 0) return;
    if (distance == 1) return;  // single sample = identity; leave pixels unchanged

    // Read-only snapshot used for all sample lookups
    const std::vector<uint8_t> src(pixels, pixels + (size_t)width * height * 4);

    // Angle convention: 0° = right, increases clockwise (screen coordinates).
    const float angleRad = angleDeg * (float)M_PI / 180.f;
    const float dx = std::cos(angleRad);
    const float dy = std::sin(angleRad);

    // Samples are placed at integer offsets t = s - distance/2, for s = 0..distance-1.
    // This centers the kernel symmetrically (or near-symmetrically) on the output pixel.
    const int halfKernel = distance / 2;

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            float accR = 0.f, accG = 0.f, accB = 0.f, accA = 0.f;

            for (int s = 0; s < distance; ++s) {
                const int t = s - halfKernel;

                // Sample position — clamp to valid image bounds (repeat-edge)
                const int sx = std::clamp((int)std::round((float)x + dx * (float)t),
                                          0, width  - 1);
                const int sy = std::clamp((int)std::round((float)y + dy * (float)t),
                                          0, height - 1);

                const uint8_t* p = src.data() + (sy * width + sx) * 4;
                accR += p[0];
                accG += p[1];
                accB += p[2];
                accA += p[3];
            }

            uint8_t* out = pixels + (y * width + x) * 4;
            out[0] = (uint8_t)std::clamp((int)(accR / distance), 0, 255);
            out[1] = (uint8_t)std::clamp((int)(accG / distance), 0, 255);
            out[2] = (uint8_t)std::clamp((int)(accB / distance), 0, 255);
            out[3] = (uint8_t)std::clamp((int)(accA / distance), 0, 255);
        }
    }
}
```

**Notes:**  
- `halfKernel = distance / 2` gives integer offsets in the range `[-(distance/2), distance - 1 - distance/2]`, which is symmetric for odd distances and asymmetric by one pixel for even distances. This is standard and acceptable for a blur kernel.  
- `std::round` on the sample position avoids systematic drift at non-cardinal angles.  
- `std::clamp` on sample coordinates implements repeat-edge (clamp-to-border) as required by the spec.  
- `M_PI` is available via the `<cmath>` include that is already present in `filters.cpp`.  
- For `distance == 1` the kernel is a no-op (`accX / 1 == src pixel`). The early-return avoids the loop overhead.  
- Angle values 0° and 360° both produce `cos(0) = 1, sin(0) = 0`, giving identical horizontal smear — as required by the spec.

---

### Step 3 — `wasm/src/pixelops.cpp`

Add the following block after the `pixelops_radial_blur` export:

```cpp
// ─── Motion Blur (in-place) ────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_motion_blur(
    uint8_t* pixels, int width, int height,
    float angleDeg, int distance
) {
    filters_motion_blur(pixels, width, height, angleDeg, distance);
}
```

`float angleDeg` is passed directly as a JS `number`; Emscripten coerces it to f32 on the WASM stack — no `HEAPF32` indirection needed for scalar arguments.

---

### Step 4 — `wasm/CMakeLists.txt`

In the `target_link_options` block, extend the `-sEXPORTED_FUNCTIONS` line by appending `_pixelops_motion_blur` at the end:

```
"-sEXPORTED_FUNCTIONS=_malloc,_free,_pixelops_flood_fill,_pixelops_gaussian_blur,_pixelops_box_blur,_pixelops_convolve,_pixelops_resize_bilinear,_pixelops_resize_nearest,_pixelops_dither_floyd_steinberg,_pixelops_dither_bayer,_pixelops_quantize,_pixelops_curves_histogram,_pixelops_radial_blur,_pixelops_sharpen,_pixelops_sharpen_more,_pixelops_unsharp_mask,_pixelops_smart_sharpen,_pixelops_add_noise,_pixelops_film_grain,_pixelops_lens_blur,_pixelops_clouds,_pixelops_motion_blur"
```

After editing, run `npm run build:wasm` to regenerate `src/wasm/generated/`.

---

### Step 5 — `src/wasm/types.ts`

Add the new signature inside the `PixelOpsModule` interface, after `_pixelops_radial_blur`:

```ts
_pixelops_motion_blur(
  pixelsPtr: number, width: number, height: number,
  angleDeg: number, distance: number
): void
```

---

### Step 6 — `src/wasm/index.ts`

Add the public wrapper after `radialBlur`:

```ts
/** Motion blur (in-place).
 *  angleDeg: 0–360 (0 = horizontal right, clockwise).
 *  distance: kernel length in pixels (1–999). */
export async function motionBlur(
  pixels: Uint8Array, width: number, height: number,
  angleDeg: number, distance: number
): Promise<Uint8Array> {
  const m = await getPixelOps()
  return withInPlaceBuffer(m, pixels, ptr =>
    m._pixelops_motion_blur(ptr, width, height, angleDeg, distance)
  )
}
```

---

### Step 7 — `src/types/index.ts`

Extend the `FilterKey` union by appending `'motion-blur'`:

```ts
export type FilterKey =
  | 'gaussian-blur'
  | 'box-blur'
  | 'radial-blur'
  | 'motion-blur'      // ← add
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

Add the new entry to `FILTER_REGISTRY`. Insert it after `'radial-blur'` to keep the Blur group contiguous:

```ts
{ key: 'radial-blur',  label: 'Radial Blur…',  group: 'blur' },
{ key: 'motion-blur',  label: 'Motion Blur…',  group: 'blur' },  // ← add
{ key: 'lens-blur',    label: 'Lens Blur…',    group: 'blur' },
```

---

### Step 9 — `src/components/dialogs/MotionBlurDialog/MotionBlurDialog.tsx`

Create the file. Full structure:

```
src/components/dialogs/MotionBlurDialog/
  MotionBlurDialog.tsx
  MotionBlurDialog.module.scss
```

#### Props

```ts
export interface MotionBlurDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}
```

The same six props used by every other filter dialog. `canvasWidth`/`canvasHeight` are passed from `App.tsx` (from `state.canvas.width/height`) so the component has no `AppContext` dependency.

#### File-level constants

```ts
const MIN_ANGLE      = 0
const MAX_ANGLE      = 360
const DEFAULT_ANGLE  = 0

const MIN_DISTANCE      = 1
const MAX_DISTANCE      = 999
const DEFAULT_DISTANCE  = 10

const DEBOUNCE_MS = 400

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)))
}
```

#### Selection-aware compositing helper (module-level, not exported)

Identical pattern to `GaussianBlurDialog` and `RadialBlurDialog`:

```ts
function applySelectionComposite(
  blurred:  Uint8Array,
  original: Uint8Array,
  mask:     Uint8Array | null,
): Uint8Array {
  if (mask === null) return blurred
  const out = original.slice()
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) {
      const p = i * 4
      out[p]     = blurred[p]
      out[p + 1] = blurred[p + 1]
      out[p + 2] = blurred[p + 2]
      out[p + 3] = blurred[p + 3]
    }
  }
  return out
}
```

The blur input is always the full canvas-size original buffer so that boundary pixels can sample across the selection boundary — identical reasoning as in `GaussianBlurDialog`.

#### SVG icon components (file-internal, not exported)

```tsx
const CloseIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
       strokeLinecap="round" width="10" height="10" aria-hidden="true">
    <line x1="1" y1="1" x2="11" y2="11" />
    <line x1="11" y1="1" x2="1" y2="11" />
  </svg>
)

// Motion blur header icon: horizontal arrow with blur trails above/below
const MotionBlurIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <line x1="1.5" y1="3.4" x2="7.0" y2="3.4"
          stroke="currentColor" strokeWidth="0.7" opacity="0.18" strokeLinecap="round"/>
    <line x1="1.5" y1="4.7" x2="8.4" y2="4.7"
          stroke="currentColor" strokeWidth="0.85" opacity="0.45" strokeLinecap="round"/>
    <line x1="1.5" y1="6.0" x2="9.0" y2="6.0"
          stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    <path d="M7.4 4.5 L9.8 6.0 L7.4 7.5"
          fill="none" stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="1.5" y1="7.3" x2="8.4" y2="7.3"
          stroke="currentColor" strokeWidth="0.85" opacity="0.45" strokeLinecap="round"/>
    <line x1="1.5" y1="8.6" x2="7.0" y2="8.6"
          stroke="currentColor" strokeWidth="0.7" opacity="0.18" strokeLinecap="round"/>
  </svg>
)
```

#### `AngleIndicator` component (file-internal, not exported)

A purely visual 40×40 SVG compass rose that shows the current blur direction as an arrow. `pointer-events: none` — clicking it does nothing.

The SVG coordinate system has its origin at the top-left. The center of the compass is at (20, 20). The direction arrow points from center toward the ring at radius 14.

Angle convention matches the spec and CSS: 0° = East (right), increases clockwise. In SVG screen coordinates, clockwise means increasing `y`. Therefore:

```
tip_x = 20 + 14 * cos(angle_rad)   // angle_rad = angle_deg * Math.PI / 180
tip_y = 20 + 14 * sin(angle_rad)
```

The arrowhead is a small equilateral triangle centered at the tip, pointing in the direction of the angle. Compute it from the tip and the unit vector:

```
ux = cos(angle_rad), uy = sin(angle_rad)
// perpendicular: (-uy, ux)
arrow_base_center = tip + (-ux) * HEAD_LEN
left  = base_center + (-uy, ux) * HEAD_WIDTH/2
right = base_center + ( uy,-ux) * HEAD_WIDTH/2
// polygon: tip, left, right
```

Full component:

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
const runPreview = useCallback(async (a: number, d: number): Promise<void> => {
  const handle   = canvasHandleRef.current
  const original = originalPixelsRef.current
  if (!handle || activeLayerId == null || original == null) return

  if (isBusyRef.current) {
    // WASM call in flight — re-queue with latest values rather than stack a parallel call
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(a, d)
    }, 100)
    return
  }

  isBusyRef.current = true
  setIsBusy(true)
  setErrorMessage(null)
  try {
    const blurred  = await motionBlur(original.slice(), canvasWidth, canvasHeight, a, d)
    const composed = applySelectionComposite(blurred, original, selectionMaskRef.current)
    handle.writeLayerPixels(activeLayerId, composed)
  } catch (err) {
    setErrorMessage('Failed to preview Motion Blur.')
    console.error('[MotionBlur] preview error:', err)
  } finally {
    isBusyRef.current = false
    setIsBusy(false)
  }
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])
```

#### Change handlers

Both angle and distance use the same debounce pattern. Create a shared `schedulePreview` helper inside the component:

```ts
const schedulePreview = useCallback((a: number, d: number): void => {
  if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
  debounceTimerRef.current = setTimeout(() => {
    debounceTimerRef.current = null
    void runPreview(a, d)
  }, DEBOUNCE_MS)
}, [runPreview])

const handleAngleChange = useCallback((value: number): void => {
  const clamped = clamp(value, MIN_ANGLE, MAX_ANGLE)
  setAngle(clamped)
  schedulePreview(clamped, distance)
}, [schedulePreview, distance])

const handleDistanceChange = useCallback((value: number): void => {
  const clamped = clamp(value, MIN_DISTANCE, MAX_DISTANCE)
  setDistance(clamped)
  schedulePreview(angle, clamped)
}, [schedulePreview, angle])
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
    const blurred  = await motionBlur(original.slice(), canvasWidth, canvasHeight, angle, distance)
    const composed = applySelectionComposite(blurred, original, selectionMaskRef.current)
    handle.writeLayerPixels(activeLayerId, composed)
    captureHistory('Motion Blur')
    onClose()
  } catch (err) {
    setErrorMessage('Failed to apply Motion Blur: could not read layer pixels.')
    console.error('[MotionBlur] apply error:', err)
  } finally {
    isBusyRef.current = false
    setIsBusy(false)
  }
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight, angle, distance, captureHistory, onClose])
```

**History semantics:** `captureHistory('Motion Blur')` is called _after_ `writeLayerPixels`. Internally, `captureHistory` calls `canvasHandle.captureAllLayerPixels()` which snapshots `layer.data` — the just-written blurred pixels. The previous history tip (captured before the dialog opened) is the pre-blur state; Ctrl+Z restores to it.

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

The rendered output follows the exact same structure as `GaussianBlurDialog` and `RadialBlurDialog`. High-level shape:

```tsx
return (
  <ModalDialog
    isOpen={isOpen}
    onClose={handleCancel}
    aria-label="Motion Blur"
  >
    {/* Header */}
    <div className={styles.header}>
      <span className={styles.headerIcon}><MotionBlurIcon /></span>
      <span className={styles.title}>Motion Blur</span>
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
               aria-labelledby="lbl-angle" />
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
               aria-labelledby="lbl-dist" />
        <input type="number" className={styles.numberInput}
               min={MIN_DISTANCE} max={MAX_DISTANCE} step={1} value={distance}
               onChange={e => handleDistanceChange(Number(e.target.value))}
               onBlur={e => handleDistanceChange(Number(e.target.value))}
               aria-label="Distance in pixels" />
        <span className={styles.unit}>px</span>
      </div>

      {/* Preview indicator (shown while isBusy) */}
      {isBusy && (
        <div className={styles.previewIndicator} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          Previewing…
          <span className={styles.previewParams}>{angle}° · {distance} px</span>
        </div>
      )}

      {/* Selection note (shown when hasSelection) */}
      {hasSelection && (
        <div className={styles.selectionNote} role="note">
          {/* marching-ants icon */}
          <span className={styles.selectionNoteIcon} aria-hidden="true">
            <svg viewBox="0 0 11 11" fill="none" width="10" height="10">
              <rect x="1" y="1" width="9" height="9" rx="1"
                    stroke="currentColor" strokeWidth="1"
                    strokeDasharray="2 1.5" fill="none"/>
            </svg>
          </span>
          <span className={styles.selectionNoteText}>
            Selection active — blur applies only within the selected area.
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

Note: the `<input type="range">` slider background fill percentage should be updated via a CSS custom property (`--pct`) on the element style, identical to the UX design and the pattern used in other dialogs:

```tsx
style={{ '--pct': `${((angle - MIN_ANGLE) / (MAX_ANGLE - MIN_ANGLE)) * 100}%` } as React.CSSProperties}
```

Same formula for the distance slider.

---

### Step 10 — `src/components/dialogs/MotionBlurDialog/MotionBlurDialog.module.scss`

Mirror the SCSS from `RadialBlurDialog.module.scss` (or any other filter dialog) without modification. All filter dialogs share the same visual structure and token values. The only class names used are:

```
.header, .headerIcon, .title, .closeBtn
.body, .row, .label, .slider, .numberInput, .unit
.angleIndicatorRow
.previewIndicator, .spinner, .previewParams
.selectionNote, .selectionNoteIcon, .selectionNoteText
.errorMessage
.footer, .btnCancel, .btnApply
```

The `.angleIndicatorRow` class corresponds to `.angle-indicator-row` in the UX design:

```scss
.angleIndicatorRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0 4px 52px; // indent to match slider track start (46px label + 6px gap)
}
```

---

### Step 11 — `src/components/index.ts`

Add the two exports after the `RadialBlurDialog` exports:

```ts
export { MotionBlurDialog } from './dialogs/MotionBlurDialog/MotionBlurDialog'
export type { MotionBlurDialogProps } from './dialogs/MotionBlurDialog/MotionBlurDialog'
```

---

### Step 12 — `src/App.tsx`

Three changes are needed:

**a) Import** — add one import after the `RadialBlurDialog` import line:

```ts
import { MotionBlurDialog } from '@/components/dialogs/MotionBlurDialog/MotionBlurDialog'
```

**b) State** — add one `useState` after `showRadialBlurDialog`:

```ts
const [showMotionBlurDialog,     setShowMotionBlurDialog]     = useState(false)
```

**c) `handleOpenFilterDialog`** — add one `if` case after the `'radial-blur'` line:

```ts
if (key === 'radial-blur')   setShowRadialBlurDialog(true)
if (key === 'motion-blur')   setShowMotionBlurDialog(true)   // ← add
```

**d) Render** — add the dialog render after the `RadialBlurDialog` block:

```tsx
{showMotionBlurDialog && (
  <MotionBlurDialog
    isOpen={showMotionBlurDialog}
    onClose={() => setShowMotionBlurDialog(false)}
    canvasHandleRef={canvasHandleRef}
    activeLayerId={state.activeLayerId}
    captureHistory={captureHistory}
    canvasWidth={state.canvas.width}
    canvasHeight={state.canvas.height}
  />
)}
```

---

## Architectural Constraints

| Constraint | How this design respects it |
|---|---|
| **App.tsx is a thin orchestrator** | App.tsx receives three minimal changes: one import, one state, one `if`, one JSX block. All logic lives in the dialog component. |
| **Dialogs do not import `AppContext`** | `MotionBlurDialog` receives `canvasHandleRef`, `activeLayerId`, `captureHistory`, `canvasWidth`, `canvasHeight` as props from `App.tsx`. |
| **WASM boundary** | The C++ function is called exclusively through `src/wasm/index.ts#motionBlur`. No import from `src/wasm/generated/` anywhere outside that file. |
| **In-place buffer pattern** | `withInPlaceBuffer` handles malloc/copy/free; HEAPU8 is re-read after the call. |
| **Unified rasterization pipeline** | Motion Blur is a destructive pixel-data mutation that writes directly to the layer via `writeLayerPixels`. It does not introduce a render-plan entry because it is not an adjustment layer — it permanently modifies the pixel buffer. This is identical to Gaussian Blur, Box Blur, and Radial Blur. |
| **History semantics** | `captureHistory` is called after `writeLayerPixels`, capturing the post-blur pixels as the new current state. Cancel restores originals via `writeLayerPixels` with no history push. |
| **No re-initialization in effects with rendererRef** | The initialization effect depends on `[isOpen, canvasHandleRef, activeLayerId]`, not on `rendererRef.current`. |
| **Selection support** | `applySelectionComposite` blurs the full buffer (for correct boundary pixels) then pastes only selected pixels back, identical to the Gaussian Blur implementation. |

---

## Open Questions

1. **`ModalDialog` import path** — confirm the correct import for `ModalDialog` by checking `src/components/dialogs/` (likely a shared wrapper at `src/components/dialogs/ModalDialog/ModalDialog.tsx` or similar).
2. **SCSS clone vs. shared stylesheet** — all existing filter dialogs duplicate the SCSS. If a shared `_filterDialog.module.scss` partial is introduced before implementing this feature, `MotionBlurDialog.module.scss` should `@use` it instead.
3. **Distance = 1 UX** — the C++ function returns immediately without modifying pixels when `distance == 1`. The dialog should still show the Apply button as enabled so the user can confirm a no-op (matching the spec requirement that Distance=1 is valid and records an undo entry). No special case is needed in the dialog.
4. **Large distance performance** — at Distance=999 on a large canvas the inner loop is O(W × H × 999). The `DEBOUNCE_MS` constant of 400 ms prevents excessive calls during slider drag. If performance is a concern in the future, a separable two-pass optimization is possible but is out of scope.
