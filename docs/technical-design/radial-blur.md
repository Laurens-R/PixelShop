# Technical Design: Radial Blur

## Overview

Radial Blur is a destructive filter that smears active-layer pixel data along either concentric arcs (Spin) or radial lines (Zoom) emanating from a user-defined center point. The effect is computed in C++/WASM for performance, previewed live inside the dialog with a debounced update, and committed to the layer's pixel data only on Apply. The feature follows the exact same structural pattern as Gaussian Blur and Box Blur: new WASM function → TypeScript wrapper → `FilterKey` extension → `useFilters` callback → dialog component → App wiring.

---

## Affected Areas

| File | Change |
|---|---|
| `wasm/src/filters.h` | Declare `filters_radial_blur` |
| `wasm/src/filters.cpp` | Implement `filters_radial_blur` (Spin + Zoom) |
| `wasm/src/pixelops.cpp` | Add `EMSCRIPTEN_KEEPALIVE` export `pixelops_radial_blur` |
| `wasm/CMakeLists.txt` | Append `_pixelops_radial_blur` to `-sEXPORTED_FUNCTIONS` |
| `src/wasm/types.ts` | Add `_pixelops_radial_blur` signature to `PixelOpsModule` |
| `src/wasm/index.ts` | Add `radialBlur` async wrapper |
| `src/types/index.ts` | Extend `FilterKey` union with `'radial-blur'` |
| `src/filters/registry.ts` | Add `{ key: 'radial-blur', label: 'Radial Blur…' }` entry |
| `src/hooks/useFilters.ts` | Add `handleOpenRadialBlur` callback; extend return type |
| `src/components/dialogs/RadialBlurDialog/RadialBlurDialog.tsx` | **New** — modal dialog component |
| `src/components/dialogs/RadialBlurDialog/RadialBlurDialog.module.scss` | **New** — dialog styles |
| `src/components/index.ts` | Export `RadialBlurDialog` and `RadialBlurDialogProps` |
| `src/App.tsx` | Import dialog, add `showRadialBlurDialog` state, wire `handleOpenFilterDialog`, render dialog |

---

## State Changes

No new fields are required in `AppState`. All dialog parameters are local to `RadialBlurDialog` via `useState`. No new reducer actions are needed.

---

## New Components / Hooks / Tools

### `RadialBlurDialog` (Dialog)

**Category:** `dialogs/`  
**Single responsibility:** Presents the Radial Blur controls (Mode, Amount, Quality, Center Picker), manages live debounced WASM preview, and commits or discards the effect.  
**Inputs:** `RadialBlurDialogProps` (see below).  
**Outputs:** writes pixels to the canvas via `canvasHandleRef`, calls `captureHistory` and `onClose` on Apply.

---

## Implementation Steps

### Step 1 — `wasm/src/filters.h`

Append the declaration after `filters_box_blur`:

```cpp
/// Radial blur applied in-place.
/// mode: 0 = Spin, 1 = Zoom.
/// amount: 1–100.
/// centerX/centerY: blur origin as fractions of canvas dimensions (0.0–1.0).
/// quality: 0 = Draft (8 samples), 1 = Good (16 samples), 2 = Best (32 samples).
void filters_radial_blur(
    uint8_t* pixels, int width, int height,
    int mode, int amount,
    float centerX, float centerY,
    int quality
);
```

---

### Step 2 — `wasm/src/filters.cpp`

Add `filters_radial_blur` at the end of the file. The function must work in-place: allocate a read-only copy of `pixels` at the start, write results back into the original buffer.

#### Bilinear sample helper (file-scope static)

```cpp
static void sampleBilinear(
    const uint8_t* src, int width, int height,
    float sx, float sy,
    float& outR, float& outG, float& outB, float& outA)
{
    // Clamp to image bounds
    sx = std::clamp(sx, 0.f, (float)(width  - 1));
    sy = std::clamp(sy, 0.f, (float)(height - 1));

    const int x0 = (int)sx,        y0 = (int)sy;
    const int x1 = std::min(x0+1, width-1);
    const int y1 = std::min(y0+1, height-1);
    const float fx = sx - x0,      fy = sy - y0;

    auto px = [&](int x, int y) -> const uint8_t* {
        return src + (y * width + x) * 4;
    };

    const uint8_t* p00 = px(x0,y0); const uint8_t* p10 = px(x1,y0);
    const uint8_t* p01 = px(x0,y1); const uint8_t* p11 = px(x1,y1);

    for (int c = 0; c < 4; ++c) {
        float top    = p00[c] * (1-fx) + p10[c] * fx;
        float bottom = p01[c] * (1-fx) + p11[c] * fx;
        (&outR)[c]   = top * (1-fy) + bottom * fy;
    }
}
```

#### `filters_radial_blur` body

```cpp
void filters_radial_blur(
    uint8_t* pixels, int width, int height,
    int mode, int amount,
    float centerX, float centerY,
    int quality
) {
    if (amount <= 0 || width <= 0 || height <= 0) return;

    // Read-only snapshot used for all sample lookups
    const std::vector<uint8_t> src(pixels, pixels + (size_t)width * height * 4);

    // numSamples by quality: 0=Draft→8, 1=Good→16, 2=Best→32
    const int numSamples = (quality == 0) ? 8 : (quality == 1) ? 16 : 32;

    const float cx = centerX * (float)(width  - 1);
    const float cy = centerY * (float)(height - 1);

    if (mode == 0) {
        // ── Spin mode ────────────────────────────────────────────────────────
        // Map amount 1–100 to rotation arc 0.1°–10.0°.
        // spinAngle = amount * 0.1° = amount * π / 1800 radians.
        // Each pixel samples numSamples angles evenly across
        //   [baseAngle - spinAngle/2, baseAngle + spinAngle/2].
        // Pixels at the center (dist ≈ 0) pass through unmodified.

        const float spinAngle = (float)amount * (float)M_PI / 1800.f;

        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                const float dx = (float)x - cx;
                const float dy = (float)y - cy;
                const float dist = std::sqrt(dx*dx + dy*dy);

                const int dstIdx = (y * width + x) * 4;

                if (dist < 0.5f) {
                    // At the center: no smear, copy through unchanged
                    pixels[dstIdx]   = src[dstIdx];
                    pixels[dstIdx+1] = src[dstIdx+1];
                    pixels[dstIdx+2] = src[dstIdx+2];
                    pixels[dstIdx+3] = src[dstIdx+3];
                    continue;
                }

                const float baseAngle = std::atan2(dy, dx);
                float accR = 0, accG = 0, accB = 0, accA = 0;

                for (int s = 0; s < numSamples; ++s) {
                    // t spans [0, 1] across numSamples; maps to angle offset
                    // from -spinAngle/2 to +spinAngle/2
                    const float t     = (numSamples > 1)
                                          ? (float)s / (float)(numSamples - 1)
                                          : 0.5f;
                    const float theta = baseAngle - spinAngle * 0.5f + t * spinAngle;
                    const float sx    = cx + dist * std::cos(theta);
                    const float sy_   = cy + dist * std::sin(theta);

                    float r, g, b, a;
                    sampleBilinear(src.data(), width, height, sx, sy_, r, g, b, a);
                    accR += r; accG += g; accB += b; accA += a;
                }

                pixels[dstIdx]   = (uint8_t)std::clamp((int)(accR / numSamples), 0, 255);
                pixels[dstIdx+1] = (uint8_t)std::clamp((int)(accG / numSamples), 0, 255);
                pixels[dstIdx+2] = (uint8_t)std::clamp((int)(accB / numSamples), 0, 255);
                pixels[dstIdx+3] = (uint8_t)std::clamp((int)(accA / numSamples), 0, 255);
            }
        }

    } else {
        // ── Zoom mode ────────────────────────────────────────────────────────
        // Map amount 1–100 to a zoom scale 0.005–0.5.
        // For each pixel (x, y) with relative vector (dx, dy) from the center:
        //   sample[s] is at (cx + dx*(1 - t*scale), cy + dy*(1 - t*scale))
        //   where t ∈ [0, 1] across numSamples — i.e. samples travel from
        //   the pixel's position toward the center, up to `scale * dist` pixels.
        // Pixels at the center (dist ≈ 0) pass through unmodified.

        const float scale = (float)amount * 0.005f;   // 0.005 at amount=1, 0.5 at amount=100

        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                const float dx = (float)x - cx;
                const float dy = (float)y - cy;

                const int dstIdx = (y * width + x) * 4;

                if (std::abs(dx) < 0.5f && std::abs(dy) < 0.5f) {
                    pixels[dstIdx]   = src[dstIdx];
                    pixels[dstIdx+1] = src[dstIdx+1];
                    pixels[dstIdx+2] = src[dstIdx+2];
                    pixels[dstIdx+3] = src[dstIdx+3];
                    continue;
                }

                float accR = 0, accG = 0, accB = 0, accA = 0;

                for (int s = 0; s < numSamples; ++s) {
                    // t ∈ [0, 1]: at t=0 we sample at (x, y) itself;
                    // at t=1 we sample scale * dist closer to the center.
                    const float t      = (numSamples > 1)
                                           ? (float)s / (float)(numSamples - 1)
                                           : 0.5f;
                    const float factor = 1.f - t * scale;
                    const float sx     = cx + dx * factor;
                    const float sy_    = cy + dy * factor;

                    float r, g, b, a;
                    sampleBilinear(src.data(), width, height, sx, sy_, r, g, b, a);
                    accR += r; accG += g; accB += b; accA += a;
                }

                pixels[dstIdx]   = (uint8_t)std::clamp((int)(accR / numSamples), 0, 255);
                pixels[dstIdx+1] = (uint8_t)std::clamp((int)(accG / numSamples), 0, 255);
                pixels[dstIdx+2] = (uint8_t)std::clamp((int)(accB / numSamples), 0, 255);
                pixels[dstIdx+3] = (uint8_t)std::clamp((int)(accA / numSamples), 0, 255);
            }
        }
    }
}
```

> **Notes on `M_PI`:** The file already includes `<cmath>`, which provides `M_PI` on all target platforms. No additional include is needed.

---

### Step 3 — `wasm/src/pixelops.cpp`

Add the following block after the `pixelops_box_blur` export:

```cpp
// ─── Radial Blur (in-place) ───────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_radial_blur(
    uint8_t* pixels, int width, int height,
    int mode, int amount, float centerX, float centerY, int quality
) {
    filters_radial_blur(pixels, width, height, mode, amount, centerX, centerY, quality);
}
```

`float` parameters are passed directly from the TypeScript call site as JS `number` values. Emscripten's generated glue coerces them to f32 on the WASM stack — no `HEAPF32` indirection is needed for scalar arguments.

---

### Step 4 — `wasm/CMakeLists.txt`

In the `target_link_options` block, extend the `-sEXPORTED_FUNCTIONS` line by appending `_pixelops_radial_blur`:

```
"-sEXPORTED_FUNCTIONS=_malloc,_free,_pixelops_flood_fill,_pixelops_gaussian_blur,_pixelops_box_blur,_pixelops_convolve,_pixelops_resize_bilinear,_pixelops_resize_nearest,_pixelops_dither_floyd_steinberg,_pixelops_dither_bayer,_pixelops_quantize,_pixelops_curves_histogram,_pixelops_radial_blur"
```

After editing, run `npm run build:wasm` to regenerate `src/wasm/generated/`.

---

### Step 5 — `src/wasm/types.ts`

Add the new signature inside the `PixelOpsModule` interface, after `_pixelops_curves_histogram`:

```ts
_pixelops_radial_blur(
  pixelsPtr: number, width: number, height: number,
  mode: number, amount: number, centerX: number, centerY: number, quality: number
): void
```

---

### Step 6 — `src/wasm/index.ts`

Add the public wrapper after `boxBlur`:

```ts
/**
 * Radial blur (in-place).
 * mode: 0 = Spin, 1 = Zoom.
 * amount: 1–100.
 * centerX/centerY: 0.0–1.0 relative to canvas dimensions.
 * quality: 0 = Draft (8 samples), 1 = Good (16 samples), 2 = Best (32 samples).
 */
export async function radialBlur(
  pixels: Uint8Array, width: number, height: number,
  mode: number, amount: number,
  centerX: number, centerY: number,
  quality: number
): Promise<Uint8Array> {
  const m = await getPixelOps()
  return withInPlaceBuffer(m, pixels, ptr =>
    m._pixelops_radial_blur(ptr, width, height, mode, amount, centerX, centerY, quality)
  )
}
```

> `withInPlaceBuffer` is already defined in `index.ts` and handles both the copy-in and the post-call HEAPU8 re-read for potential memory growth (as documented in AGENTS.md).

---

### Step 7 — `src/types/index.ts`

Extend the `FilterKey` union:

```ts
// Before:
export type FilterKey = 'gaussian-blur' | 'box-blur'

// After:
export type FilterKey = 'gaussian-blur' | 'box-blur' | 'radial-blur'
```

---

### Step 8 — `src/filters/registry.ts`

Append one entry to `FILTER_REGISTRY`:

```ts
export const FILTER_REGISTRY: FilterRegistryEntry[] = [
  { key: 'gaussian-blur', label: 'Gaussian Blur…' },
  { key: 'box-blur',      label: 'Box Blur…' },
  { key: 'radial-blur',   label: 'Radial Blur…' },
]
```

---

### Step 9 — `src/hooks/useFilters.ts`

Add `handleOpenRadialBlur` following the existing pattern. Update the return type and returned object:

```ts
// Updated return type
export interface UseFiltersReturn {
  isFiltersMenuEnabled:   boolean
  handleOpenGaussianBlur: () => void
  handleOpenBoxBlur:      () => void
  handleOpenRadialBlur:   () => void   // ← new
}

// New callback (inside the hook body, after handleOpenBoxBlur):
const handleOpenRadialBlur = useCallback(
  () => onOpenFilterDialog('radial-blur'),
  [onOpenFilterDialog]
)

// Updated return:
return { isFiltersMenuEnabled, handleOpenGaussianBlur, handleOpenBoxBlur, handleOpenRadialBlur }
```

---

### Step 10 — `src/components/dialogs/RadialBlurDialog/RadialBlurDialog.tsx`

Create the file. The component follows the GaussianBlurDialog pattern exactly, extended for the additional controls.

#### Props interface

```ts
export interface RadialBlurDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}
```

#### Internal constants

```ts
const MIN_AMOUNT     = 1
const MAX_AMOUNT     = 100
const DEFAULT_AMOUNT = 10
const DEBOUNCE_MS    = 25
```

#### State

```ts
const [mode,         setMode]         = useState<'spin' | 'zoom'>('spin')
const [amount,       setAmount]       = useState(DEFAULT_AMOUNT)
const [quality,      setQuality]      = useState<'draft' | 'good' | 'best'>('good')
const [centerX,      setCenterX]      = useState(0.5)
const [centerY,      setCenterY]      = useState(0.5)
const [isBusy,       setIsBusy]       = useState(false)
const [hasSelection, setHasSelection] = useState(false)
const [errorMessage, setErrorMessage] = useState<string | null>(null)
```

#### Refs

```ts
const isBusyRef         = useRef(false)
const originalPixelsRef = useRef<Uint8Array | null>(null)
const selectionMaskRef  = useRef<Uint8Array | null>(null)
const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
const gridRef           = useRef<HTMLDivElement>(null)
```

#### Initialization effect

Mirrors GaussianBlurDialog exactly: on `isOpen` change, capture `handle.getLayerPixels(activeLayerId)` into `originalPixelsRef`, capture `selectionStore.mask?.slice()` into `selectionMaskRef`, reset all state to defaults, clear any pending debounce timer on cleanup.

#### `runPreview` callback

```ts
const runPreview = useCallback(async (
  m: 'spin' | 'zoom', amt: number,
  q: 'draft' | 'good' | 'best',
  cx: number, cy: number
): Promise<void> => {
  const handle   = canvasHandleRef.current
  const original = originalPixelsRef.current
  if (!handle || activeLayerId == null || original == null) return

  if (isBusyRef.current) {
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(m, amt, q, cx, cy)
    }, 100)
    return
  }

  isBusyRef.current = true
  setIsBusy(true)
  try {
    const modeInt    = m === 'spin' ? 0 : 1
    const qualityInt = q === 'draft' ? 0 : q === 'good' ? 1 : 2
    const blurred    = await radialBlur(
      original.slice(), canvasWidth, canvasHeight,
      modeInt, amt, cx, cy, qualityInt
    )
    const composed = applySelectionComposite(blurred, original, selectionMaskRef.current)
    handle.writeLayerPixels(activeLayerId, composed)
  } finally {
    isBusyRef.current = false
    setIsBusy(false)
  }
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])
```

> `applySelectionComposite` is a file-scope helper identical to the one in GaussianBlurDialog.

#### Debounced trigger helper

A shared internal function used by all control change handlers:

```ts
function schedulePreview(
  m: 'spin' | 'zoom', amt: number,
  q: 'draft' | 'good' | 'best',
  cx: number, cy: number
): void {
  if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
  debounceTimerRef.current = setTimeout(() => {
    debounceTimerRef.current = null
    void runPreview(m, amt, q, cx, cy)
  }, DEBOUNCE_MS)
}
```

Each change handler (mode, amount, quality, center) calls this with the new values alongside the unchanged current state values. Use `useCallback` per handler.

#### `handleApply`

Mirrors GaussianBlurDialog: cancel pending debounce, run WASM with current parameters on `original.slice()`, apply selection composite, `writeLayerPixels`, call `captureHistory('Radial Blur')`, call `onClose`. On error: log, set `errorMessage`, restore original pixels.

#### `handleCancel`

Cancel pending debounce, restore `originalPixelsRef.current` via `writeLayerPixels`, call `onClose`.

#### Escape key effect

Same as GaussianBlurDialog: `window.addEventListener('keydown', ...)` guarded by `isOpen`.

#### Center picker interaction

```ts
const handleGridMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
  if (e.button !== 0) return             // left button only
  const el = gridRef.current
  if (!el) return

  const updateFromEvent = (clientX: number, clientY: number): void => {
    const rect = el.getBoundingClientRect()
    const nx = Math.max(0, Math.min(1, (clientX - rect.left)  / rect.width))
    const ny = Math.max(0, Math.min(1, (clientY - rect.top)   / rect.height))
    setCenterX(nx)
    setCenterY(ny)
    schedulePreview(mode, amount, quality, nx, ny)
  }

  updateFromEvent(e.clientX, e.clientY)

  const onMove = (me: MouseEvent): void => updateFromEvent(me.clientX, me.clientY)
  const onUp   = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup',   onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup',   onUp)
}, [mode, amount, quality, schedulePreview])
```

> Mouse tracking is attached to `window`, not the grid element, so rapid movement cannot escape the element without losing tracking.

#### Render

```tsx
if (!isOpen) return null

return (
  <div className={styles.panel} role="dialog" aria-label="Radial Blur">
    {/* Header: RadialBlurIcon, title "Radial Blur", close button */}

    <div className={styles.body}>
      {/* Mode row */}
      <div className={styles.row}>
        <label className={styles.label}>Mode</label>
        <div className={styles.toggleGroup}>
          <button className={mode === 'spin' ? styles.toggleBtnActive : styles.toggleBtn}
                  onClick={() => { setMode('spin'); schedulePreview('spin', amount, quality, centerX, centerY) }}>
            Spin
          </button>
          <button className={mode === 'zoom' ? styles.toggleBtnActive : styles.toggleBtn}
                  onClick={() => { setMode('zoom'); schedulePreview('zoom', amount, quality, centerX, centerY) }}>
            Zoom
          </button>
        </div>
      </div>

      {/* Amount row: label + slider + number input + "%" unit */}
      <div className={styles.row}>
        <label className={styles.label}>Amount</label>
        <input type="range"  className={styles.slider}      min={1} max={100} step={1}
               value={amount} onChange={e => handleAmountChange(e.target.valueAsNumber)} />
        <input type="number" className={styles.numberInput} min={1} max={100} step={1}
               value={amount}
               onChange={e => handleAmountChange(e.target.valueAsNumber)}
               onBlur={e  => handleAmountChange(e.target.valueAsNumber)} />
        <span className={styles.unit}>%</span>
      </div>

      {/* Quality row */}
      <div className={styles.row}>
        <label className={styles.label}>Quality</label>
        <div className={styles.toggleGroup}>
          {(['draft', 'good', 'best'] as const).map(q => (
            <button key={q}
                    className={quality === q ? styles.toggleBtnActive : styles.toggleBtn}
                    onClick={() => { setQuality(q); schedulePreview(mode, amount, q, centerX, centerY) }}>
              {q.charAt(0).toUpperCase() + q.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Center picker section */}
      <div className={styles.centerPickerSection}>
        <label className={styles.label}>Center</label>
        <div
          ref={gridRef}
          className={styles.centerGrid}
          onMouseDown={handleGridMouseDown}
        >
          {/* SVG diagonal-line grid background rendered with an <svg> child */}
          <svg className={styles.dotGrid} aria-hidden="true">
            {/* 8 diagonal lines across the 120×90 box, similar to Photoshop's abstract preview */}
            {Array.from({ length: 9 }, (_, i) => {
              const step = 15   // spacing in px
              return (
                <line key={i} x1={i * step - 90} y1="0" x2={i * step + 90} y2="90"
                      stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              )
            })}
          </svg>
          {/* Crosshair positioned at (centerX, centerY) via inline style */}
          <div
            className={styles.crosshair}
            style={{ left: `${centerX * 100}%`, top: `${centerY * 100}%` }}
          >
            <div className={styles.crosshairH} />
            <div className={styles.crosshairV} />
          </div>
        </div>
        <span className={styles.coordinates}>
          X: {Math.round(centerX * 100)}%&nbsp;&nbsp;Y: {Math.round(centerY * 100)}%
        </span>
      </div>

      {isBusy && (
        <div className={styles.previewIndicator}>
          <span className={styles.spinner} />
          Previewing…
        </div>
      )}
      {hasSelection && (
        <div className={styles.selectionNote}>
          Blur will be applied inside the selection only.
        </div>
      )}
      {errorMessage != null && (
        <div className={styles.errorMessage}>{errorMessage}</div>
      )}
    </div>

    <div className={styles.footer}>
      <button className={styles.btnCancel} onClick={handleCancel}>Cancel</button>
      <button className={styles.btnApply}  onClick={() => { void handleApply() }} disabled={isBusy}>Apply</button>
    </div>
  </div>
)
```

---

### Step 11 — `src/components/dialogs/RadialBlurDialog/RadialBlurDialog.module.scss`

Uses the same `@use '@/styles/variables' as vars` and `@use '@/styles/mixins' as m` imports, the same `.panel`, `.header`, `.headerIcon`, `.title`, `.closeBtn`, `.body`, `.row`, `.label`, `.slider`, `.numberInput`, `.unit`, `.footer`, `.btnCancel`, `.btnApply`, `.previewIndicator`, `.spinner`, `.selectionNote`, and `.errorMessage` rules as `GaussianBlurDialog.module.scss`.

Add these additional classes:

```scss
// ── Toggle group ───────────────────────────────────────────────────────────────

.toggleGroup {
  display: flex;
  flex-shrink: 0;
}

.toggleBtn {
  height: 18px;
  padding: 0 10px;
  font-size: 11px;
  font-family: vars.$font-sans;
  color: vars.$color-text-muted;
  background: #1e1e1e;
  border: 1px solid vars.$color-border-light;
  border-right-width: 0;
  cursor: default;
  white-space: nowrap;
  display: flex;
  align-items: center;
  line-height: 1;

  &:first-child { border-radius: vars.$radius-sm 0 0 vars.$radius-sm; }
  &:last-child  { border-radius: 0 vars.$radius-sm vars.$radius-sm 0; border-right-width: 1px; }
  &:hover:not(.toggleBtnActive) {
    background: #2a2a2a;
    color: vars.$color-text-dim;
  }
}

.toggleBtnActive {
  @extend .toggleBtn;
  background: vars.$color-accent-solid;
  border-color: vars.$color-accent-solid;
  color: #fff;
  font-weight: 500;

  & + .toggleBtn { border-left-color: vars.$color-accent-solid; }
}

// ── Center picker ──────────────────────────────────────────────────────────────

.centerPickerSection {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.centerGrid {
  position: relative;
  width: 120px;
  height: 90px;
  background: #1a1a1a;
  border: 1px solid vars.$color-border-light;
  border-radius: vars.$radius-sm;
  overflow: hidden;
  cursor: crosshair;
  flex-shrink: 0;
}

.dotGrid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.crosshair {
  position: absolute;
  width: 14px;
  height: 14px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.crosshairH {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(255, 255, 255, 0.9);
  transform: translateY(-0.5px);
}

.crosshairV {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.9);
  transform: translateX(-0.5px);
}

.coordinates {
  font-size: 10px;
  color: vars.$color-text-muted;
  font-variant-numeric: tabular-nums;
}
```

> The `.body` padding and `gap: 6px` in the inherited rules give the expanded body its height naturally — no explicit height override is needed.

---

### Step 12 — `src/components/index.ts`

Append two lines after the BoxBlurDialog exports:

```ts
export { RadialBlurDialog } from './dialogs/RadialBlurDialog/RadialBlurDialog'
export type { RadialBlurDialogProps } from './dialogs/RadialBlurDialog/RadialBlurDialog'
```

---

### Step 13 — `src/App.tsx`

**a) Import** the new dialog (alongside GaussianBlurDialog and BoxBlurDialog):

```ts
import { RadialBlurDialog } from '@/components/dialogs/RadialBlurDialog/RadialBlurDialog'
```

**b) Add state** alongside `showBoxBlurDialog`:

```ts
const [showRadialBlurDialog, setShowRadialBlurDialog] = useState(false)
```

**c) Extend `handleOpenFilterDialog`** with the new key:

```ts
const handleOpenFilterDialog = useCallback((key: FilterKey): void => {
  if (key === 'gaussian-blur') setShowGaussianBlurDialog(true)
  if (key === 'box-blur')      setShowBoxBlurDialog(true)
  if (key === 'radial-blur')   setShowRadialBlurDialog(true)
}, [])
```

**d) Render the dialog** after the BoxBlurDialog block:

```tsx
{showRadialBlurDialog && (
  <RadialBlurDialog
    isOpen={showRadialBlurDialog}
    onClose={() => setShowRadialBlurDialog(false)}
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

| Rule from AGENTS.md | How this design respects it |
|---|---|
| **`App.tsx` is a thin orchestrator** | All dialog state and WASM logic live inside `RadialBlurDialog`; `App.tsx` adds only a boolean state and a JSX node. |
| **Hooks own one cohesive concern** | `useFilters` gains one callback; it remains a single-concern hook (filter menu enable/disable + open-dialog dispatch). |
| **Dialogs wrap `ModalDialog`-like patterns** | `RadialBlurDialog` follows the established panel-style dialog pattern (fixed position, header, body, footer) identical to `GaussianBlurDialog`. |
| **No raw DOM listeners in tools** | The center picker uses `React.MouseEvent` + imperative `window.addEventListener` attached/removed within `handleGridMouseDown`, which is correct for a dialog drag interaction — tools are not involved. |
| **WASM wrapper handles memory** | `radialBlur` delegates entirely to `withInPlaceBuffer`, which re-reads `HEAPU8` after the call to guard against memory growth. |
| **CSS Modules only** | Both new files use `.module.scss`. |
| **Selection-aware compositing** | `applySelectionComposite` is applied identically to GaussianBlurDialog — blurred pixels are composited with the selection mask before writing to the layer. |
| **One undo entry on Apply** | `captureHistory('Radial Blur')` is called exactly once, immediately before `onClose()`, on the success path only. |

---

## Open Questions

1. **Zoom scale factor** — the design uses `amount * 0.005` (range 0.005–0.5 of pixel distance toward center). This is a reasonable starting point, but the Zoom mode's "feel" at Amount=100 should be validated against the spec's requirement that it produce "longer radial streaks" vs a lower amount. The constant may need tuning.

2. **Spin arc centering** — the design samples symmetrically about the pixel's base angle (`[baseAngle - spinAngle/2, +spinAngle/2]`). An alternative is sampling only in one rotational direction (`[baseAngle, baseAngle + spinAngle]`). The symmetric approach produces a more even smear without a directional bias, which is the Photoshop-style behavior.

3. **Center picker SVG pattern** — the design uses diagonal line strokes to approximate the Photoshop abstract radial preview. An SVG `<pattern>` element with a repeating diagonal unit would be more flexible if a more complex texture is desired, but the simple `Array.from` approach is sufficient for the current spec.

4. **`handleOpenRadialBlur` in `useFilters` return** — the hook's return value now includes `handleOpenRadialBlur`, but no existing call site passes it through (only `TopBar` consumes the menu). Verify that `TopBar` already maps the generic `onOpenFilterDialog` prop rather than individual named callbacks — the current code confirms it does, so no `TopBar` change is required.
