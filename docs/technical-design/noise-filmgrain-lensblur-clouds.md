# Technical Design: Add Noise, Film Grain, Lens Blur, and Clouds Filters

## Overview

Four new destructive parametric filters — **Add Noise**, **Film Grain**, **Lens Blur**, and **Clouds** — are added following the identical floating-panel pattern established by `GaussianBlurDialog`, `RadialBlurDialog`, and `SmartSharpenDialog`. Each filter opens as a `position: fixed` panel, captures the layer's original pixels on open, shows a debounced live preview, and commits a single undo history entry on Apply. All pixel computation runs in C++/WASM via four new `filters_*` functions implemented in `filters.cpp`, wrapped in `pixelops.cpp`, and surfaced to TypeScript through `src/wasm/index.ts`. No new `AppState` fields or reducer actions are required; all panel state is component-local.

The filters are organized into three logical groups within the **Filters** menu: **Noise** (Add Noise, Film Grain), **Blur** (Lens Blur), and **Render** (Clouds). Because the current `FilterRegistryEntry` and TopBar filter menu builder have no grouping support, this design adds an optional `group` field to `FilterRegistryEntry` and updates the TopBar builder to emit separators between group transitions.

---

## Affected Areas

| File | Change |
|---|---|
| `wasm/src/filters.h` | Declare 4 new C++ functions |
| `wasm/src/filters.cpp` | Implement 4 new C++ functions (using existing static helpers `boxBlurH`, `boxBlurV`, `sampleBilinear`) |
| `wasm/src/pixelops.cpp` | Add 4 `EMSCRIPTEN_KEEPALIVE` wrapper functions |
| `wasm/CMakeLists.txt` | Append 4 symbols to `-sEXPORTED_FUNCTIONS` |
| `src/wasm/types.ts` | Add 4 method signatures to `PixelOpsModule` |
| `src/wasm/index.ts` | Add 4 exported async wrapper functions |
| `src/types/index.ts` | Extend `FilterKey` union; add optional `group` to `FilterRegistryEntry` (via registry file — see below) |
| `src/filters/registry.ts` | Add optional `group` field to `FilterRegistryEntry`; add 4 new entries |
| `src/hooks/useFilters.ts` | Add 4 `handleOpen*` callbacks; extend `UseFiltersReturn` |
| `src/App.tsx` | Add 4 `useState` booleans; add 4 `if` branches in `handleOpenFilterDialog`; render 4 new dialog components |
| `src/components/dialogs/AddNoiseDialog/AddNoiseDialog.tsx` | New dialog component |
| `src/components/dialogs/AddNoiseDialog/AddNoiseDialog.module.scss` | New SCSS module |
| `src/components/dialogs/FilmGrainDialog/FilmGrainDialog.tsx` | New dialog component |
| `src/components/dialogs/FilmGrainDialog/FilmGrainDialog.module.scss` | New SCSS module |
| `src/components/dialogs/LensBlurDialog/LensBlurDialog.tsx` | New dialog component |
| `src/components/dialogs/LensBlurDialog/LensBlurDialog.module.scss` | New SCSS module |
| `src/components/dialogs/CloudsDialog/CloudsDialog.tsx` | New dialog component |
| `src/components/dialogs/CloudsDialog/CloudsDialog.module.scss` | New SCSS module |
| `src/components/window/TopBar/TopBar.tsx` | Update filter menu builder to insert separators between groups |
| `src/components/index.ts` | Export 4 new dialog components and their props types |

---

## State Changes

### `src/types/index.ts` — extend `FilterKey`

```ts
export type FilterKey =
  | 'gaussian-blur'
  | 'box-blur'
  | 'radial-blur'
  | 'sharpen'
  | 'sharpen-more'
  | 'unsharp-mask'
  | 'smart-sharpen'
  | 'add-noise'       // ← new
  | 'film-grain'      // ← new
  | 'lens-blur'       // ← new
  | 'clouds'          // ← new
```

No new fields on `AppState`. All four dialogs manage their own local state via `useState` / `useRef`.

---

## New Components / Hooks / Tools

| Name | Category | Responsibility |
|---|---|---|
| `AddNoiseDialog` | dialog | Panel UI for Add Noise filter; manages amount / distribution / monochromatic state; calls `addNoise()` WASM wrapper for preview and apply |
| `FilmGrainDialog` | dialog | Panel UI for Film Grain filter; manages grainSize / intensity / roughness state; calls `filmGrain()` WASM wrapper |
| `LensBlurDialog` | dialog | Panel UI for Lens Blur filter; manages radius / bladeCount / bladeCurvature / rotation state; calls `lensBlur()` WASM wrapper; disables Blade Count row when curvature is 100 |
| `CloudsDialog` | dialog | Panel UI for Clouds filter; manages scale / opacity / colorMode / seed state; accepts `foregroundColor` and `backgroundColor` props; calls `clouds()` WASM wrapper |

No new hooks. Four new `handleOpen*` callbacks are added to the existing `useFilters` hook.

---

## Implementation Steps

### Step 1 — `wasm/src/filters.h`: Add 4 declarations

Append after the existing `filters_smart_sharpen` declaration:

```cpp
/// Add Noise applied in-place.
/// amount:        1–400 (%; 100 → ±127 delta before clamp).
/// distribution:  0 = Uniform, 1 = Gaussian approximation (average of 4 uniform samples).
/// monochromatic: 0 = independent RGB deltas, 1 = single delta for all RGB channels.
/// seed:          LCG initial state.
void filters_add_noise(
    uint8_t* pixels, int width, int height,
    int amount, int distribution, int monochromatic, uint32_t seed
);

/// Film Grain applied in-place.
/// grainSize:  1–100. At >1 the noise field is box-blurred before being added.
/// intensity:  1–200 (%; 100 → full ±127 grain amplitude).
/// roughness:  0–100. 0 = grain strongest in shadows; 100 = uniform amplitude.
/// seed:       LCG initial state.
void filters_film_grain(
    uint8_t* pixels, int width, int height,
    int grainSize, int intensity, int roughness, uint32_t seed
);

/// Lens Blur applied in-place (polygonal aperture convolution).
/// radius:         1–100 (px). Kernel size = 2*radius+1.
/// bladeCount:     3–8. Number of aperture polygon sides.
/// bladeCurvature: 0–100. 0 = straight polygon edges; 100 = perfect circle.
/// rotation:       0–360 (°). Rotates the aperture polygon.
void filters_lens_blur(
    uint8_t* pixels, int width, int height,
    int radius, int bladeCount, int bladeCurvature, int rotation
);

/// Clouds applied in-place (fractional value noise composited over existing pixels).
/// scale:     1–200. Larger values = larger cloud features.
/// opacity:   1–100 (%). 100 = fully replaces existing pixels in affected area.
/// colorMode: 0 = grayscale, 1 = use foreground/background color gradient.
/// fgR/G/B:   Foreground colour (used when colorMode == 1).
/// bgR/G/B:   Background colour (used when colorMode == 1).
/// seed:      0–9999. Same seed always produces the same noise pattern.
void filters_clouds(
    uint8_t* pixels, int width, int height,
    int scale, int opacity, int colorMode,
    uint8_t fgR, uint8_t fgG, uint8_t fgB,
    uint8_t bgR, uint8_t bgG, uint8_t bgB,
    uint32_t seed
);
```

---

### Step 2 — `wasm/src/filters.cpp`: Implement the 4 functions

All four functions are appended after `filters_smart_sharpen`. They share the file-scope static helpers `boxBlurH`, `boxBlurV`, and `sampleBilinear` that already exist in the file. The LCG macro / inline function below is defined once at the top of the new block and shared across all four implementations.

#### 2a. Shared LCG helper (define at the top of the new section)

```cpp
// ─── LCG helper (Numerical Recipes) ──────────────────────────────────────────
static inline uint32_t lcg_next(uint32_t state) {
    return 1664525u * state + 1013904223u;
}
```

#### 2b. `filters_add_noise`

```cpp
void filters_add_noise(
    uint8_t* pixels, int width, int height,
    int amount, int distribution, int monochromatic, uint32_t seed
) {
    if (amount <= 0 || width <= 0 || height <= 0) return;

    const int maxDelta = std::min(127, amount * 127 / 100);
    const int range    = 2 * maxDelta + 1;  // [0, range)

    uint32_t state = seed;
    const int n    = width * height;

    for (int i = 0; i < n; ++i) {
        const int base = i * 4;

        // Compute delta(s) for this pixel.
        // Uniform: single sample in [0, range), shifted to [-maxDelta, maxDelta].
        // Gaussian approx: average of 4 uniform [0, 2*maxDelta] samples minus maxDelta.
        auto sample_uniform = [&]() -> int {
            state = lcg_next(state);
            return (int)(state % (unsigned)range) - maxDelta;
        };

        auto sample_gaussian = [&]() -> int {
            int sum = 0;
            for (int k = 0; k < 4; ++k) {
                state = lcg_next(state);
                sum += (int)(state % (unsigned)(2 * maxDelta + 1));
            }
            return sum / 4 - maxDelta;
        };

        if (monochromatic) {
            const int delta = (distribution == 0) ? sample_uniform() : sample_gaussian();
            pixels[base]     = (uint8_t)std::clamp(pixels[base]     + delta, 0, 255);
            pixels[base + 1] = (uint8_t)std::clamp(pixels[base + 1] + delta, 0, 255);
            pixels[base + 2] = (uint8_t)std::clamp(pixels[base + 2] + delta, 0, 255);
            // Alpha unchanged.
        } else {
            for (int c = 0; c < 3; ++c) {
                const int delta = (distribution == 0) ? sample_uniform() : sample_gaussian();
                pixels[base + c] = (uint8_t)std::clamp(pixels[base + c] + delta, 0, 255);
            }
        }
        // pixels[base + 3] (alpha) is never modified.
    }
}
```

**Range note:** `amount * 127 / 100` intentionally uses integer division. At amount=100, maxDelta=127. At amount=400, maxDelta=min(127,508)=127 — i.e., the cap is 127 regardless. Update: the spec says "at Amount=400, shifts reach up to ±127×4 levels before clamping" which implies maxDelta should scale beyond 127 at high amounts. Correct the formula as: `maxDelta = amount * 127 / 100` with **no** `std::min` cap. The clamp in the pixel loop (`std::clamp(..., 0, 255)`) is what prevents out-of-range byte values. Revised:

```cpp
const int maxDelta = amount * 127 / 100;  // no cap; pixel clamp handles overflow
const int range2   = 2 * maxDelta + 1;
```

#### 2c. `filters_film_grain`

```cpp
void filters_film_grain(
    uint8_t* pixels, int width, int height,
    int grainSize, int intensity, int roughness, uint32_t seed
) {
    if (width <= 0 || height <= 0) return;

    const int n = width * height;

    // 1. Generate float noise field in [-1, 1] via Gaussian approx (4 uniform samples).
    std::vector<float> noise(n);
    uint32_t state = seed;
    for (int i = 0; i < n; ++i) {
        float sum = 0.f;
        for (int k = 0; k < 4; ++k) {
            state = lcg_next(state);
            // Map to [0, 2.0]
            sum += (float)(state & 0xFFFF) / 32767.5f;
        }
        // Average of 4 uniform [0,2] samples minus 1 → approximate N(0, sigma) in [-1, 1]
        noise[i] = sum / 4.f - 1.f;
    }

    // 2. Optionally blur the noise field to produce coarser grain clusters.
    const int blurRadius = (grainSize > 1) ? std::min(5, grainSize / 10) : 0;
    if (blurRadius > 0) {
        // Encode noise into a 4-channel RGBA scratch buffer (all channels = same value).
        std::vector<uint8_t> noisePx(n * 4);
        for (int i = 0; i < n; ++i) {
            const uint8_t v = (uint8_t)std::clamp((int)((noise[i] + 1.f) * 127.5f), 0, 255);
            noisePx[i * 4]     = v;
            noisePx[i * 4 + 1] = v;
            noisePx[i * 4 + 2] = v;
            noisePx[i * 4 + 3] = v;
        }
        std::vector<uint8_t> tmp(n * 4);
        boxBlurH(noisePx.data(), tmp.data(), width, height, blurRadius);
        boxBlurV(tmp.data(), noisePx.data(), width, height, blurRadius);
        // Decode back to float noise (read R channel only).
        for (int i = 0; i < n; ++i) {
            noise[i] = (float)noisePx[i * 4] / 127.5f - 1.f;
        }
    }

    // 3. Apply grain to each pixel.
    const float intensityF  = intensity / 100.f;
    const float roughnessF  = roughness / 100.f;

    for (int i = 0; i < n; ++i) {
        const int base = i * 4;
        const float R  = pixels[base];
        const float G  = pixels[base + 1];
        const float B  = pixels[base + 2];

        // Luminance weight: lerp(1-luma, 1.0, roughnessF)
        const float luma   = (0.299f * R + 0.587f * G + 0.114f * B) / 255.f;
        const float weight = (1.f - roughnessF) * (1.f - luma) + roughnessF * 1.f;

        const float grainVal = noise[i] * 127.f * weight * intensityF;
        pixels[base]     = (uint8_t)std::clamp((int)(R + grainVal), 0, 255);
        pixels[base + 1] = (uint8_t)std::clamp((int)(G + grainVal), 0, 255);
        pixels[base + 2] = (uint8_t)std::clamp((int)(B + grainVal), 0, 255);
        // Alpha unchanged.
    }
}
```

> **Note on roughness formula:** The formula `weight = lerp(1-luma, 1.0, roughnessF)` produces dark-pixel-dominant grain at 0 and uniform grain at 100. The spec acceptance criteria states "With Roughness = 100, the inverse is true — brighter pixels receive stronger grain." A formula that satisfies all three acceptance points (dark at 0, uniform at 50, bright at 100) is `weight = lerp(1-luma, luma, roughnessF)`. This is raised as an open question; the formula above matches the request spec and is what is implemented. See Open Questions.

#### 2d. `filters_lens_blur`

```cpp
void filters_lens_blur(
    uint8_t* pixels, int width, int height,
    int radius, int bladeCount, int bladeCurvature, int rotation
) {
    if (radius <= 0 || width <= 0 || height <= 0) return;

    const int ksize  = 2 * radius + 1;
    const int karea  = ksize * ksize;
    std::vector<float> kernel(karea, 0.f);

    const float PI           = 3.14159265358979323846f;
    const float bladeCurvF   = bladeCurvature / 100.f;
    const float rotRad       = rotation * PI / 180.f;
    const float bladeAngle   = (bladeCurvature < 100)
                                 ? (2.f * PI / (float)bladeCount)
                                 : 0.f;
    const float halfBlade    = bladeAngle / 2.f;
    const float polyInradius = (bladeCurvature < 100)
                                 ? std::cos(PI / (float)bladeCount)
                                 : 1.f;

    // Build the kernel.
    for (int ky = -radius; ky <= radius; ++ky) {
        for (int kx = -radius; kx <= radius; ++kx) {
            const float nx = (radius > 0) ? (float)kx / (float)radius : 0.f;
            const float ny = (radius > 0) ? (float)ky / (float)radius : 0.f;
            const float r  = std::sqrt(nx * nx + ny * ny);

            // Skip corners well outside the unit circle.
            if (r > 1.5f) continue;

            const int idx = (ky + radius) * ksize + (kx + radius);

            if (bladeCurvature >= 100) {
                // Perfect circle.
                kernel[idx] = (r <= 1.f) ? 1.f : 0.f;
            } else {
                const float theta  = std::atan2(ny, nx) + rotRad;
                // Normalize theta into [0, bladeAngle) to find which polygon sector.
                const float sector = std::fmod(theta + 20.f * PI, bladeAngle);
                // Inradius-to-vertex distance of regular polygon at this angle.
                const float polyR  = polyInradius / std::cos(sector - halfBlade);
                // Blend toward circle based on curvature.
                const float effectiveR = polyR * (1.f - bladeCurvF) + 1.f * bladeCurvF;
                kernel[idx] = (r <= effectiveR) ? 1.f : 0.f;
            }
        }
    }

    // Normalise so the kernel sums to 1.
    float kernelSum = 0.f;
    for (float v : kernel) kernelSum += v;
    if (kernelSum > 0.f) {
        for (float& v : kernel) v /= kernelSum;
    }

    // Copy original pixels to a read-only source buffer.
    const std::vector<uint8_t> src(pixels, pixels + (size_t)width * height * 4);

    // Convolve with the aperture kernel.
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            float accR = 0.f, accG = 0.f, accB = 0.f, accA = 0.f;

            for (int ky = -radius; ky <= radius; ++ky) {
                for (int kx = -radius; kx <= radius; ++kx) {
                    const float w = kernel[(ky + radius) * ksize + (kx + radius)];
                    if (w == 0.f) continue;
                    float sR, sG, sB, sA;
                    sampleBilinear(src.data(), width, height,
                                   (float)(x + kx), (float)(y + ky),
                                   sR, sG, sB, sA);
                    accR += sR * w;
                    accG += sG * w;
                    accB += sB * w;
                    accA += sA * w;
                }
            }

            const int dstIdx = (y * width + x) * 4;
            pixels[dstIdx]     = (uint8_t)std::clamp((int)accR, 0, 255);
            pixels[dstIdx + 1] = (uint8_t)std::clamp((int)accG, 0, 255);
            pixels[dstIdx + 2] = (uint8_t)std::clamp((int)accB, 0, 255);
            pixels[dstIdx + 3] = (uint8_t)std::clamp((int)accA, 0, 255);
        }
    }
}
```

**Performance note:** At radius=100 the kernel is 201×201 (~40 k elements). For a 1000×1000 canvas the inner loop executes ~10⁹ iterations; expect several seconds. The spinner communicates progress. No algorithmic optimization is required for this release.

#### 2e. `filters_clouds`

```cpp
void filters_clouds(
    uint8_t* pixels, int width, int height,
    int scale, int opacity, int colorMode,
    uint8_t fgR, uint8_t fgG, uint8_t fgB,
    uint8_t bgR, uint8_t bgG, uint8_t bgB,
    uint32_t seed
) {
    if (width <= 0 || height <= 0) return;

    // ── Build a 256×256 random value grid seeded by LCG ───────────────────
    const int GRID = 256;
    std::vector<float> grid(GRID * GRID);
    uint32_t state = seed ^ 0xDEADBEEFu;  // mix seed so seed=0 is not flat
    for (int i = 0; i < GRID * GRID; ++i) {
        state = lcg_next(state);
        grid[i] = (float)(state & 0xFFFF) / 65535.f;  // [0, 1]
    }

    // Quintic fade: f(t) = t³ (t(6t − 15) + 10)
    auto fade = [](float t) -> float {
        return t * t * t * (t * (t * 6.f - 15.f) + 10.f);
    };

    // Bilinear value-noise sample with wrapping.
    auto valueSample = [&](float fx, float fy) -> float {
        const float gxf = std::fmod(fx * GRID, (float)GRID);
        const float gyf = std::fmod(fy * GRID, (float)GRID);
        const int   gx0 = (int)gxf & (GRID - 1);
        const int   gy0 = (int)gyf & (GRID - 1);
        const int   gx1 = (gx0 + 1) & (GRID - 1);
        const int   gy1 = (gy0 + 1) & (GRID - 1);
        const float tx  = fade(gxf - (float)(int)gxf);
        const float ty  = fade(gyf - (float)(int)gyf);

        const float v00 = grid[gy0 * GRID + gx0];
        const float v10 = grid[gy0 * GRID + gx1];
        const float v01 = grid[gy1 * GRID + gx0];
        const float v11 = grid[gy1 * GRID + gx1];

        const float top    = v00 + tx * (v10 - v00);
        const float bottom = v01 + tx * (v11 - v01);
        return top + ty * (bottom - top);
    };

    const float scaleF = (float)scale;
    const float opacityF = opacity / 100.f;

    for (int py = 0; py < height; ++py) {
        for (int px = 0; px < width; ++px) {
            // 4-octave fractal value noise.
            float total  = 0.f;
            float maxAmp = 0.f;
            float freq   = 1.f / scaleF;
            float amp    = 1.f;
            for (int oct = 0; oct < 4; ++oct) {
                total  += valueSample((float)px * freq, (float)py * freq) * amp;
                maxAmp += amp;
                amp    *= 0.5f;
                freq   *= 2.f;
            }
            const float normalized = total / maxAmp;  // [0, 1]

            // Tone remap.
            const float t = std::pow(std::clamp(normalized, 0.f, 1.f), 1.5f);

            // Cloud colour.
            float cloudR, cloudG, cloudB;
            if (colorMode == 0) {
                cloudR = cloudG = cloudB = 255.f * t;
            } else {
                cloudR = (float)bgR + ((float)fgR - (float)bgR) * t;
                cloudG = (float)bgG + ((float)fgG - (float)bgG) * t;
                cloudB = (float)bgB + ((float)fgB - (float)bgB) * t;
            }

            // Blend over existing pixels.
            const int base = (py * width + px) * 4;
            pixels[base]     = (uint8_t)std::clamp((int)(pixels[base]     + (cloudR - pixels[base])     * opacityF), 0, 255);
            pixels[base + 1] = (uint8_t)std::clamp((int)(pixels[base + 1] + (cloudG - pixels[base + 1]) * opacityF), 0, 255);
            pixels[base + 2] = (uint8_t)std::clamp((int)(pixels[base + 2] + (cloudB - pixels[base + 2]) * opacityF), 0, 255);
            // Alpha unchanged.
        }
    }
}
```

---

### Step 3 — `wasm/src/pixelops.cpp`: Add 4 `EMSCRIPTEN_KEEPALIVE` wrappers

Append inside the `extern "C"` block, after `pixelops_smart_sharpen`:

```cpp
// ─── Add Noise (in-place) ─────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_add_noise(
    uint8_t* pixels, int width, int height,
    int amount, int distribution, int monochromatic, uint32_t seed
) {
    filters_add_noise(pixels, width, height, amount, distribution, monochromatic, seed);
}

// ─── Film Grain (in-place) ────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_film_grain(
    uint8_t* pixels, int width, int height,
    int grainSize, int intensity, int roughness, uint32_t seed
) {
    filters_film_grain(pixels, width, height, grainSize, intensity, roughness, seed);
}

// ─── Lens Blur (in-place) ─────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_lens_blur(
    uint8_t* pixels, int width, int height,
    int radius, int bladeCount, int bladeCurvature, int rotation
) {
    filters_lens_blur(pixels, width, height, radius, bladeCount, bladeCurvature, rotation);
}

// ─── Clouds (in-place) ────────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_clouds(
    uint8_t* pixels, int width, int height,
    int scale, int opacity, int colorMode,
    uint8_t fgR, uint8_t fgG, uint8_t fgB,
    uint8_t bgR, uint8_t bgG, uint8_t bgB,
    uint32_t seed
) {
    filters_clouds(pixels, width, height,
                   scale, opacity, colorMode,
                   fgR, fgG, fgB, bgR, bgG, bgB, seed);
}
```

---

### Step 4 — `wasm/CMakeLists.txt`: Extend `EXPORTED_FUNCTIONS`

In `target_link_options`, append the four new symbols (comma-separated, no space) to the existing `-sEXPORTED_FUNCTIONS` list:

```
,_pixelops_add_noise,_pixelops_film_grain,_pixelops_lens_blur,_pixelops_clouds
```

The full resulting list ends with:
```
...,_pixelops_smart_sharpen,_pixelops_add_noise,_pixelops_film_grain,_pixelops_lens_blur,_pixelops_clouds
```

Run `npm run build:wasm` after this step.

---

### Step 5 — `src/wasm/types.ts`: Add 4 method signatures to `PixelOpsModule`

Append after `_pixelops_smart_sharpen`:

```ts
_pixelops_add_noise(
  pixelsPtr: number, width: number, height: number,
  amount: number, distribution: number, monochromatic: number, seed: number
): void

_pixelops_film_grain(
  pixelsPtr: number, width: number, height: number,
  grainSize: number, intensity: number, roughness: number, seed: number
): void

_pixelops_lens_blur(
  pixelsPtr: number, width: number, height: number,
  radius: number, bladeCount: number, bladeCurvature: number, rotation: number
): void

_pixelops_clouds(
  pixelsPtr: number, width: number, height: number,
  scale: number, opacity: number, colorMode: number,
  fgR: number, fgG: number, fgB: number,
  bgR: number, bgG: number, bgB: number,
  seed: number
): void
```

---

### Step 6 — `src/wasm/index.ts`: Add 4 exported async wrapper functions

Append after `smartSharpen`:

```ts
/** Add Noise (in-place).
 *  amount: 1–400 (%). distribution: 0=Uniform, 1=Gaussian approx. monochromatic: 0|1. seed: LCG seed. */
export async function addNoise(
  pixels: Uint8Array, width: number, height: number,
  amount: number, distribution: number, monochromatic: number, seed: number
): Promise<Uint8Array> {
  const m = await getPixelOps()
  return withInPlaceBuffer(m, pixels, ptr =>
    m._pixelops_add_noise(ptr, width, height, amount, distribution, monochromatic, seed)
  )
}

/** Film Grain (in-place).
 *  grainSize: 1–100. intensity: 1–200 (%). roughness: 0–100. seed: LCG seed. */
export async function filmGrain(
  pixels: Uint8Array, width: number, height: number,
  grainSize: number, intensity: number, roughness: number, seed: number
): Promise<Uint8Array> {
  const m = await getPixelOps()
  return withInPlaceBuffer(m, pixels, ptr =>
    m._pixelops_film_grain(ptr, width, height, grainSize, intensity, roughness, seed)
  )
}

/** Lens Blur (in-place). Polygonal aperture convolution.
 *  radius: 1–100 (px). bladeCount: 3–8. bladeCurvature: 0–100. rotation: 0–360 (°). */
export async function lensBlur(
  pixels: Uint8Array, width: number, height: number,
  radius: number, bladeCount: number, bladeCurvature: number, rotation: number
): Promise<Uint8Array> {
  const m = await getPixelOps()
  return withInPlaceBuffer(m, pixels, ptr =>
    m._pixelops_lens_blur(ptr, width, height, radius, bladeCount, bladeCurvature, rotation)
  )
}

/** Clouds (in-place). Fractional value noise composited over existing pixels.
 *  scale: 1–200. opacity: 1–100 (%). colorMode: 0=grayscale, 1=fg/bg color.
 *  fgR/G/B, bgR/G/B: foreground and background colors. seed: 0–9999. */
export async function clouds(
  pixels: Uint8Array, width: number, height: number,
  scale: number, opacity: number, colorMode: number,
  fgR: number, fgG: number, fgB: number,
  bgR: number, bgG: number, bgB: number,
  seed: number
): Promise<Uint8Array> {
  const m = await getPixelOps()
  return withInPlaceBuffer(m, pixels, ptr =>
    m._pixelops_clouds(ptr, width, height,
      scale, opacity, colorMode,
      fgR, fgG, fgB, bgR, bgG, bgB, seed)
  )
}
```

---

### Step 7 — `src/types/index.ts`: Extend `FilterKey`

Find the `FilterKey` type union (line 172) and add four values:

```ts
export type FilterKey =
  | 'gaussian-blur'
  | 'box-blur'
  | 'radial-blur'
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

### Step 8 — `src/filters/registry.ts`: Add `group` field and 4 entries

The `FilterRegistryEntry` type gains an optional `group` field used by the TopBar builder to insert separators. Existing entries are assigned to `'sharpen'` and `'blur'` groups. Four new entries are added.

```ts
import type { FilterKey } from '@/types'

export interface FilterRegistryEntry {
  key:      FilterKey
  label:    string
  instant?: boolean
  group?:   'blur' | 'sharpen' | 'noise' | 'render'
}

export const FILTER_REGISTRY: FilterRegistryEntry[] = [
  { key: 'gaussian-blur',  label: 'Gaussian Blur…',  group: 'blur'    },
  { key: 'box-blur',       label: 'Box Blur…',        group: 'blur'    },
  { key: 'radial-blur',    label: 'Radial Blur…',     group: 'blur'    },
  { key: 'lens-blur',      label: 'Lens Blur…',       group: 'blur'    },  // ← new
  { key: 'sharpen',        label: 'Sharpen',          group: 'sharpen', instant: true },
  { key: 'sharpen-more',   label: 'Sharpen More',     group: 'sharpen', instant: true },
  { key: 'unsharp-mask',   label: 'Unsharp Mask…',    group: 'sharpen' },
  { key: 'smart-sharpen',  label: 'Smart Sharpen…',   group: 'sharpen' },
  { key: 'add-noise',      label: 'Add Noise…',       group: 'noise'   },  // ← new
  { key: 'film-grain',     label: 'Film Grain…',      group: 'noise'   },  // ← new
  { key: 'clouds',         label: 'Clouds…',          group: 'render'  },  // ← new
]
```

---

### Step 9 — `src/components/window/TopBar/TopBar.tsx`: Support separators between groups

In the `Filters` menu item builder (inside the `useMemo` that constructs `menuConfig`), replace the plain `.map` with a reducer that injects a separator whenever the `group` field changes:

```ts
{
  label: 'Filters',
  items: (() => {
    const result: typeof items = []
    let lastGroup: string | undefined = undefined
    for (const item of (filterMenuItems ?? [])) {
      if (item.group !== undefined && item.group !== lastGroup && lastGroup !== undefined) {
        result.push({ separator: true, label: '' })
      }
      lastGroup = item.group
      result.push({
        label:    item.label,
        disabled: !isFiltersMenuEnabled,
        action:   () => item.instant
          ? onInstantFilter?.(item.key)
          : onOpenFilterDialog?.(item.key),
      })
    }
    return result
  })(),
},
```

The `filterMenuItems` prop type in `TopBarProps` gains the `group` optional field:

```ts
filterMenuItems?: Array<{ key: FilterKey; label: string; instant?: boolean; group?: string }>
```

The `FILTER_MENU_ITEMS` constant in `App.tsx` already passes the full registry entry objects through, so it will automatically carry the `group` field once the registry is updated.

---

### Step 10 — `src/hooks/useFilters.ts`: Add 4 open handlers

Add four `handleOpen*` callbacks to the function body and return them from `UseFiltersReturn`.

**`UseFiltersReturn` additions:**
```ts
handleOpenAddNoise:   () => void
handleOpenFilmGrain:  () => void
handleOpenLensBlur:   () => void
handleOpenClouds:     () => void
```

**Implementations** (each follows the same one-liner pattern as existing openers):
```ts
const handleOpenAddNoise  = useCallback(() => onOpenFilterDialog('add-noise'),   [onOpenFilterDialog])
const handleOpenFilmGrain = useCallback(() => onOpenFilterDialog('film-grain'),  [onOpenFilterDialog])
const handleOpenLensBlur  = useCallback(() => onOpenFilterDialog('lens-blur'),   [onOpenFilterDialog])
const handleOpenClouds    = useCallback(() => onOpenFilterDialog('clouds'),      [onOpenFilterDialog])
```

These are not used directly by callers — `handleOpenFilterDialog` in `App.tsx` dispatches to the correct `useState` setter. The callbacks are included in the return so any future caller that prefers direct access does not need to modify `useFilters`.

---

### Step 11 — `src/App.tsx`: Wire up 4 new dialogs

#### 11a. New imports (add alongside other dialog imports)

```ts
import { AddNoiseDialog }  from '@/components/dialogs/AddNoiseDialog/AddNoiseDialog'
import { FilmGrainDialog } from '@/components/dialogs/FilmGrainDialog/FilmGrainDialog'
import { LensBlurDialog }  from '@/components/dialogs/LensBlurDialog/LensBlurDialog'
import { CloudsDialog }    from '@/components/dialogs/CloudsDialog/CloudsDialog'
```

#### 11b. New `useState` booleans (add alongside existing dialog booleans)

```ts
const [showAddNoiseDialog,   setShowAddNoiseDialog]   = useState(false)
const [showFilmGrainDialog,  setShowFilmGrainDialog]  = useState(false)
const [showLensBlurDialog,   setShowLensBlurDialog]   = useState(false)
const [showCloudsDialog,     setShowCloudsDialog]     = useState(false)
```

#### 11c. Extend `handleOpenFilterDialog`

```ts
const handleOpenFilterDialog = useCallback((key: FilterKey): void => {
  if (key === 'gaussian-blur') setShowGaussianBlurDialog(true)
  if (key === 'box-blur')      setShowBoxBlurDialog(true)
  if (key === 'radial-blur')   setShowRadialBlurDialog(true)
  if (key === 'unsharp-mask')  setShowUnsharpMaskDialog(true)
  if (key === 'smart-sharpen') setShowSmartSharpenDialog(true)
  if (key === 'add-noise')     setShowAddNoiseDialog(true)   // ← new
  if (key === 'film-grain')    setShowFilmGrainDialog(true)  // ← new
  if (key === 'lens-blur')     setShowLensBlurDialog(true)   // ← new
  if (key === 'clouds')        setShowCloudsDialog(true)     // ← new
}, [])
```

#### 11d. Render the 4 new dialogs (after `showSmartSharpenDialog` block)

```tsx
{showAddNoiseDialog && (
  <AddNoiseDialog
    isOpen={showAddNoiseDialog}
    onClose={() => setShowAddNoiseDialog(false)}
    canvasHandleRef={canvasHandleRef}
    activeLayerId={state.activeLayerId}
    captureHistory={captureHistory}
    canvasWidth={state.canvas.width}
    canvasHeight={state.canvas.height}
  />
)}
{showFilmGrainDialog && (
  <FilmGrainDialog
    isOpen={showFilmGrainDialog}
    onClose={() => setShowFilmGrainDialog(false)}
    canvasHandleRef={canvasHandleRef}
    activeLayerId={state.activeLayerId}
    captureHistory={captureHistory}
    canvasWidth={state.canvas.width}
    canvasHeight={state.canvas.height}
  />
)}
{showLensBlurDialog && (
  <LensBlurDialog
    isOpen={showLensBlurDialog}
    onClose={() => setShowLensBlurDialog(false)}
    canvasHandleRef={canvasHandleRef}
    activeLayerId={state.activeLayerId}
    captureHistory={captureHistory}
    canvasWidth={state.canvas.width}
    canvasHeight={state.canvas.height}
  />
)}
{showCloudsDialog && (
  <CloudsDialog
    isOpen={showCloudsDialog}
    onClose={() => setShowCloudsDialog(false)}
    canvasHandleRef={canvasHandleRef}
    activeLayerId={state.activeLayerId}
    captureHistory={captureHistory}
    canvasWidth={state.canvas.width}
    canvasHeight={state.canvas.height}
    foregroundColor={[state.primaryColor.r, state.primaryColor.g, state.primaryColor.b]}
    backgroundColor={[state.secondaryColor.r, state.secondaryColor.g, state.secondaryColor.b]}
  />
)}
```

> **Color source:** `state.primaryColor` is the foreground (tool foreground, top swatch), `state.secondaryColor` is the background. These are `RGBAColor` in `AppState`; the `CloudsDialog` props receive only the RGB tuple since alpha plays no role in cloud colorisation.

---

### Step 12 — `AddNoiseDialog` component

**File:** `src/components/dialogs/AddNoiseDialog/AddNoiseDialog.tsx`

#### Props interface

```ts
export interface AddNoiseDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}
```

#### State

```ts
const [amount,         setAmount]         = useState(25)          // 1–400
const [distribution,   setDistribution]   = useState<'uniform' | 'gaussian'>('gaussian')
const [monochromatic,  setMonochromatic]  = useState(false)
const [isBusy,         setIsBusy]         = useState(false)
const [hasSelection,   setHasSelection]   = useState(false)
const [errorMessage,   setErrorMessage]   = useState<string | null>(null)
```

#### Refs

```ts
const isBusyRef         = useRef(false)
const originalPixelsRef = useRef<Uint8Array | null>(null)
const selectionMaskRef  = useRef<Uint8Array | null>(null)
const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
const seedRef           = useRef(0)  // set once at open

// State mirrors for use inside runPreview (avoid stale closures during busy-retry)
const amountRef         = useRef(25)
const distributionRef   = useRef<'uniform' | 'gaussian'>('gaussian')
const monoRef           = useRef(false)
```

#### Initialization effect

```ts
useEffect(() => {
  if (!isOpen) return
  const handle = canvasHandleRef.current
  if (!handle || activeLayerId == null) return

  originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
  selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null
  // Generate a new seed once per panel open.
  seedRef.current = Math.floor(Math.random() * 0xFFFFFFFF)

  setAmount(25);             amountRef.current       = 25
  setDistribution('gaussian'); distributionRef.current = 'gaussian'
  setMonochromatic(false);    monoRef.current         = false
  setIsBusy(false);           isBusyRef.current       = false
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

#### `runPreview` (async, called after debounce)

```ts
const runPreview = useCallback(async (
  amt: number, dist: 'uniform' | 'gaussian', mono: boolean
): Promise<void> => {
  const handle   = canvasHandleRef.current
  const original = originalPixelsRef.current
  if (!handle || activeLayerId == null || original == null) return

  if (isBusyRef.current) {
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(amountRef.current, distributionRef.current, monoRef.current)
    }, 100)
    return
  }

  isBusyRef.current = true
  setIsBusy(true)
  try {
    const distInt  = dist === 'gaussian' ? 1 : 0
    const monoInt  = mono ? 1 : 0
    const result   = await addNoise(original.slice(), canvasWidth, canvasHeight,
                                    amt, distInt, monoInt, seedRef.current)
    const composed = applySelectionComposite(result, original, selectionMaskRef.current)
    handle.writeLayerPixels(activeLayerId, composed)
  } finally {
    isBusyRef.current = false
    setIsBusy(false)
  }
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])
```

#### `triggerPreview` debounce helper

```ts
const triggerPreview = useCallback((): void => {
  if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
  debounceTimerRef.current = setTimeout(() => {
    debounceTimerRef.current = null
    void runPreview(amountRef.current, distributionRef.current, monoRef.current)
  }, DEBOUNCE_MS)
}, [runPreview])
```

#### Control handlers

```ts
const handleAmountChange = useCallback((value: number): void => {
  const clamped = clamp(value, 1, 400)
  setAmount(clamped);  amountRef.current = clamped
  triggerPreview()
}, [triggerPreview])

const handleDistributionChange = useCallback((value: 'uniform' | 'gaussian'): void => {
  setDistribution(value);  distributionRef.current = value
  triggerPreview()
}, [triggerPreview])

const handleMonochromaticChange = useCallback((checked: boolean): void => {
  setMonochromatic(checked);  monoRef.current = checked
  triggerPreview()
}, [triggerPreview])
```

#### `handleApply`

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
  try {
    const distInt  = distribution === 'gaussian' ? 1 : 0
    const monoInt  = monochromatic ? 1 : 0
    const result   = await addNoise(original.slice(), canvasWidth, canvasHeight,
                                    amount, distInt, monoInt, seedRef.current)
    const composed = applySelectionComposite(result, original, selectionMaskRef.current)
    handle.writeLayerPixels(activeLayerId, composed)
    captureHistory('Add Noise')
    onClose()
  } catch (err) {
    console.error('[AddNoise] Apply failed:', err)
    setErrorMessage(err instanceof Error ? err.message : 'An error occurred.')
    handle.writeLayerPixels(activeLayerId, original)
  } finally {
    isBusyRef.current = false
    setIsBusy(false)
  }
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight,
    amount, distribution, monochromatic, captureHistory, onClose])
```

#### `handleCancel` and Escape key

Identical pattern to `GaussianBlurDialog`: restore `originalPixelsRef.current` to the layer and call `onClose()`. Escape listener attached in a `useEffect` on `[isOpen, handleCancel]`.

#### JSX structure

```tsx
<div className={styles.panel}>
  <div className={styles.header}>
    <span className={styles.headerIcon}><NoiseIcon /></span>
    <span className={styles.title}>Add Noise</span>
    <button className={styles.closeBtn} onClick={handleCancel}><CloseIcon /></button>
  </div>
  <div className={styles.body}>
    {/* Amount row */}
    <div className={styles.row}>
      <span className={styles.label}>Amount</span>
      <input type="range" className={styles.slider} min={1} max={400}
             value={amount} onChange={e => handleAmountChange(Number(e.target.value))} />
      <input type="number" className={styles.numberInput} min={1} max={400}
             value={amount}
             onChange={e => handleAmountChange(Number(e.target.value))}
             onBlur={e => handleAmountChange(Number(e.target.value))} />
      <span className={styles.unit}>%</span>
    </div>
    {/* Distribution row */}
    <div className={styles.row}>
      <span className={styles.label}>Distribution</span>
      <div className={styles.toggleGroup}>
        <button className={`${styles.toggleBtn} ${distribution === 'uniform' ? styles.toggleBtnActive : ''}`}
                onClick={() => handleDistributionChange('uniform')}>Uniform</button>
        <button className={`${styles.toggleBtn} ${distribution === 'gaussian' ? styles.toggleBtnActive : ''}`}
                onClick={() => handleDistributionChange('gaussian')}>Gaussian</button>
      </div>
    </div>
    {/* Monochromatic row */}
    <div className={styles.row}>
      <span className={styles.label}></span>
      <label className={styles.checkboxRow}>
        <input type="checkbox" className={styles.customCheckbox}
               checked={monochromatic}
               onChange={e => handleMonochromaticChange(e.target.checked)} />
        <span className={styles.checkboxLabel}>Monochromatic</span>
      </label>
    </div>
    {/* Busy / selection / error feedback */}
    {isBusy && (
      <div className={styles.previewIndicator}>
        <span className={styles.spinner} />
        Previewing…
      </div>
    )}
    {hasSelection && !isBusy && (
      <div className={styles.selectionNote}>
        Selection active — noise will apply only within the selected area.
      </div>
    )}
    {errorMessage && (
      <div className={styles.errorMessage}>{errorMessage}</div>
    )}
  </div>
  <div className={styles.footer}>
    <button className={styles.btnCancel} onClick={handleCancel}>Cancel</button>
    <button className={styles.btnApply} disabled={isBusy} onClick={() => void handleApply()}>Apply</button>
  </div>
</div>
```

---

### Step 13 — `AddNoiseDialog.module.scss`

Copy `GaussianBlurDialog.module.scss` verbatim. Add the following extra classes:

```scss
// ── Toggle button group (same as RadialBlurDialog) ────────────────────────────

.toggleGroup {
  display: flex;
  flex: 1;
}

.toggleBtn {
  flex: 1;
  height: 20px;
  background: vars.$color-bg;
  border: 1px solid vars.$color-border-light;
  border-right: none;
  font-size: 11px;
  font-family: vars.$font-sans;
  color: vars.$color-text-dim;
  cursor: default;
  padding: 0;
  outline: none;
  &:first-child { border-radius: 2px 0 0 2px; }
  &:last-child  { border-right: 1px solid vars.$color-border-light; border-radius: 0 2px 2px 0; }
}

.toggleBtnActive {
  background: vars.$color-accent-solid;
  border-color: vars.$color-accent-solid;
  color: #fff;
  position: relative;
  z-index: 1;
  &:hover { background: vars.$color-accent-solid; }
}

// ── Custom dark checkbox ───────────────────────────────────────────────────────

.checkboxRow {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  cursor: default;
}

.customCheckbox {
  appearance: none;
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  background: vars.$color-bg;
  border: 1px solid vars.$color-border-light;
  border-radius: 2px;
  cursor: default;
  flex-shrink: 0;
  position: relative;
  &:focus {
    outline: none;
    border-color: vars.$color-accent-solid;
    box-shadow: 0 0 0 1px vars.$color-accent-border;
  }
  &:checked {
    background: vars.$color-accent-solid;
    border-color: vars.$color-accent-solid;
  }
  &:checked::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 1px;
    width: 6px;
    height: 4px;
    border-left: 1.5px solid #fff;
    border-bottom: 1.5px solid #fff;
    transform: rotate(-45deg);
  }
}

.checkboxLabel {
  font-size: 11px;
  color: vars.$color-text-dim;
  cursor: default;
}

// ── Selection note ─────────────────────────────────────────────────────────────

.selectionNote {
  font-size: 10px;
  color: #d4941a;
  padding: 3px 6px;
  background: rgba(212, 148, 26, 0.08);
  border: 1px solid rgba(212, 148, 26, 0.22);
  border-radius: 2px;
}

// ── Error message ──────────────────────────────────────────────────────────────

.errorMessage {
  font-size: 10px;
  color: #e07070;
  padding: 3px 6px;
  background: rgba(192, 64, 64, 0.1);
  border: 1px solid rgba(192, 64, 64, 0.28);
  border-radius: 2px;
}
```

> The base `GaussianBlurDialog.module.scss` already provides `.panel`, `.header`, `.headerIcon`, `.title`, `.closeBtn`, `.body`, `.row`, `.label`, `.slider`, `.numberInput`, `.unit`, `.footer`, `.btnCancel`, `.btnApply`, `.previewIndicator`, `.spinner`. The extras listed above are only the new classes needed by `AddNoiseDialog`. Copy the full base file and append these classes.

---

### Step 14 — `FilmGrainDialog` component

**File:** `src/components/dialogs/FilmGrainDialog/FilmGrainDialog.tsx`

#### Props interface

```ts
export interface FilmGrainDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}
```

#### State and refs

```ts
const [grainSize,    setGrainSize]    = useState(5)    // 1–100
const [intensity,    setIntensity]    = useState(35)   // 1–200
const [roughness,    setRoughness]    = useState(50)   // 0–100
const [isBusy,       setIsBusy]       = useState(false)
const [hasSelection, setHasSelection] = useState(false)
const [errorMessage, setErrorMessage] = useState<string | null>(null)

const isBusyRef         = useRef(false)
const originalPixelsRef = useRef<Uint8Array | null>(null)
const selectionMaskRef  = useRef<Uint8Array | null>(null)
const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
const seedRef           = useRef(0)

// State mirrors for busy-retry
const grainSizeRef  = useRef(5)
const intensityRef  = useRef(35)
const roughnessRef  = useRef(50)
```

#### Initialization effect

Same structure as `AddNoiseDialog`. Defaults: grainSize=5, intensity=35, roughness=50. Seed: `seedRef.current = Math.floor(Math.random() * 0xFFFFFFFF)` once per open.

#### `runPreview`

```ts
const runPreview = useCallback(async (
  gs: number, int_: number, rough: number
): Promise<void> => {
  // ... (standard busy-guard / isBusyRef pattern)
  const result   = await filmGrain(original.slice(), canvasWidth, canvasHeight,
                                   gs, int_, rough, seedRef.current)
  const composed = applySelectionComposite(result, original, selectionMaskRef.current)
  handle.writeLayerPixels(activeLayerId, composed)
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])
```

#### `handleApply` undo label: `'Film Grain'`

#### JSX structure

Three rows: **Grain Size** (1–100, no unit), **Intensity** (1–200, unit `%`), **Roughness** (0–100, no unit). No toggle group, no checkbox. Base SCSS is sufficient; no extra classes required.

---

### Step 15 — `FilmGrainDialog.module.scss`

Copy `GaussianBlurDialog.module.scss` verbatim and add the same `.selectionNote` and `.errorMessage` classes as `AddNoiseDialog.module.scss`. No other extras needed.

---

### Step 16 — `LensBlurDialog` component

**File:** `src/components/dialogs/LensBlurDialog/LensBlurDialog.tsx`

#### Props interface

```ts
export interface LensBlurDialogProps {
  isOpen:          boolean
  onClose:         () => void
  canvasHandleRef: { readonly current: CanvasHandle | null }
  activeLayerId:   string | null
  captureHistory:  (label: string) => void
  canvasWidth:     number
  canvasHeight:    number
}
```

#### State and refs

```ts
const [radius,          setRadius]          = useState(10)   // 1–100
const [bladeCount,      setBladeCount]      = useState(6)    // 3–8
const [bladeCurvature,  setBladeCurvature]  = useState(0)    // 0–100
const [rotation,        setRotation]        = useState(0)    // 0–360
const [isBusy,          setIsBusy]          = useState(false)
const [hasSelection,    setHasSelection]    = useState(false)
const [errorMessage,    setErrorMessage]    = useState<string | null>(null)

const isBusyRef          = useRef(false)
const originalPixelsRef  = useRef<Uint8Array | null>(null)
const selectionMaskRef   = useRef<Uint8Array | null>(null)
const debounceTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

// State mirrors
const radiusRef         = useRef(10)
const bladeCountRef     = useRef(6)
const bladeCurvatureRef = useRef(0)
const rotationRef       = useRef(0)
```

#### Blade Count disabled rule

The **Blade Count** row is visually disabled when `bladeCurvature === 100`:

```tsx
<div className={`${styles.row} ${bladeCurvature === 100 ? styles.rowDisabled : ''}`}>
  <span className={styles.label}>Blade Count</span>
  ...
</div>
```

#### `runPreview` busy-retry reads from refs

```ts
const runPreview = useCallback(async (
  rad: number, bc: number, bCurv: number, rot: number
): Promise<void> => {
  // busy-guard pattern: retry calls runPreview(radiusRef.current, ...)
  const result   = await lensBlur(original.slice(), canvasWidth, canvasHeight,
                                  rad, bc, bCurv, rot)
  // ...
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])
```

#### `handleApply` undo label: `'Lens Blur'`

#### JSX structure

Four rows: **Radius** (1–100, unit `px`), **Blade Count** (3–8, no unit, row gets `rowDisabled` class when curvature=100), **Blade Curvature** (0–100, no unit), **Rotation** (0–360, unit `°`).

---

### Step 17 — `LensBlurDialog.module.scss`

Copy `GaussianBlurDialog.module.scss` verbatim. Add:

```scss
// ── Disabled row (Blade Count when curvature = 100) ───────────────────────────

.rowDisabled {
  opacity: 0.4;
  pointer-events: none;
}
```

Plus `.selectionNote` and `.errorMessage` as in the previous dialogs.

---

### Step 18 — `CloudsDialog` component

**File:** `src/components/dialogs/CloudsDialog/CloudsDialog.tsx`

#### Props interface

```ts
export interface CloudsDialogProps {
  isOpen:           boolean
  onClose:          () => void
  canvasHandleRef:  { readonly current: CanvasHandle | null }
  activeLayerId:    string | null
  captureHistory:   (label: string) => void
  canvasWidth:      number
  canvasHeight:     number
  /** Active foreground color as [R, G, B] — sourced from state.primaryColor. */
  foregroundColor:  [number, number, number]
  /** Active background color as [R, G, B] — sourced from state.secondaryColor. */
  backgroundColor:  [number, number, number]
}
```

#### State and refs

```ts
const [scale,      setScale]      = useState(50)                        // 1–200
const [opacity,    setOpacity]    = useState(100)                       // 1–100
const [colorMode,  setColorMode]  = useState<'grayscale' | 'color'>('grayscale')
const [seed,       setSeed]       = useState(0)                         // 0–9999
const [isBusy,     setIsBusy]     = useState(false)
const [hasSelection, setHasSelection] = useState(false)
const [errorMessage, setErrorMessage] = useState<string | null>(null)

const isBusyRef         = useRef(false)
const originalPixelsRef = useRef<Uint8Array | null>(null)
const selectionMaskRef  = useRef<Uint8Array | null>(null)
const debounceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

// State mirrors for busy-retry
const scaleRef     = useRef(50)
const opacityRef   = useRef(100)
const colorModeRef = useRef<'grayscale' | 'color'>('grayscale')
const seedRef      = useRef(0)

// Color refs — updated every render to reflect current prop values.
// runPreview and handleApply read from these to always use current colors.
const fgColorRef = useRef(foregroundColor)
fgColorRef.current = foregroundColor
const bgColorRef = useRef(backgroundColor)
bgColorRef.current = backgroundColor
```

> **Color ref pattern:** Because `foregroundColor`/`backgroundColor` are live props (the user may change the swatch while the panel is open), the dialog must always use the **current** color at call time — not values captured when the closures were created. Storing pointers into mutable refs and updating them on every render (React guarantees this runs before children and effects) achieves this without listing the color arrays as `useCallback` dependencies.

#### Initialization effect

```ts
useEffect(() => {
  if (!isOpen) return
  const handle = canvasHandleRef.current
  if (!handle || activeLayerId == null) return

  originalPixelsRef.current = handle.getLayerPixels(activeLayerId)
  selectionMaskRef.current  = selectionStore.mask ? selectionStore.mask.slice() : null

  setScale(50);              scaleRef.current     = 50
  setOpacity(100);           opacityRef.current   = 100
  setColorMode('grayscale'); colorModeRef.current = 'grayscale'
  setSeed(0);                seedRef.current      = 0
  setIsBusy(false);          isBusyRef.current    = false
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

#### `runPreview`

```ts
const runPreview = useCallback(async (
  sc: number, op: number, cm: 'grayscale' | 'color', sd: number
): Promise<void> => {
  const handle   = canvasHandleRef.current
  const original = originalPixelsRef.current
  if (!handle || activeLayerId == null || original == null) return

  if (isBusyRef.current) {
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void runPreview(scaleRef.current, opacityRef.current,
                      colorModeRef.current, seedRef.current)
    }, 100)
    return
  }

  isBusyRef.current = true
  setIsBusy(true)
  try {
    const [fgR, fgG, fgB] = fgColorRef.current
    const [bgR, bgG, bgB] = bgColorRef.current
    const colorModeInt = cm === 'color' ? 1 : 0
    const result = await clouds(original.slice(), canvasWidth, canvasHeight,
                                sc, op, colorModeInt,
                                fgR, fgG, fgB, bgR, bgG, bgB, sd)
    const composed = applySelectionComposite(result, original, selectionMaskRef.current)
    handle.writeLayerPixels(activeLayerId, composed)
  } finally {
    isBusyRef.current = false
    setIsBusy(false)
  }
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight])
```

#### Control handlers

```ts
const handleScaleChange = useCallback((value: number): void => {
  const clamped = clamp(value, 1, 200)
  setScale(clamped);  scaleRef.current = clamped
  triggerPreview()
}, [triggerPreview])

const handleOpacityChange = useCallback((value: number): void => {
  const clamped = clamp(value, 1, 100)
  setOpacity(clamped);  opacityRef.current = clamped
  triggerPreview()
}, [triggerPreview])

const handleColorModeChange = useCallback((value: 'grayscale' | 'color'): void => {
  setColorMode(value);  colorModeRef.current = value
  triggerPreview()
}, [triggerPreview])

const handleSeedChange = useCallback((value: number): void => {
  const clamped = clamp(value, 0, 9999)
  setSeed(clamped);  seedRef.current = clamped
  triggerPreview()
}, [triggerPreview])

const handleRandomizeSeed = useCallback((): void => {
  const newSeed = Math.floor(Math.random() * 10000)  // 0–9999
  setSeed(newSeed);  seedRef.current = newSeed
  triggerPreview()
}, [triggerPreview])
```

#### `handleApply`

```ts
const handleApply = useCallback(async (): Promise<void> => {
  // ... (cancel debounce, set busy)
  const [fgR, fgG, fgB] = fgColorRef.current  // current colors at Apply time
  const [bgR, bgG, bgB] = bgColorRef.current
  const colorModeInt = colorMode === 'color' ? 1 : 0
  const result = await clouds(original.slice(), canvasWidth, canvasHeight,
                              scale, opacity, colorModeInt,
                              fgR, fgG, fgB, bgR, bgG, bgB, seed)
  // ... (compose, writeLayerPixels, captureHistory('Clouds'), onClose)
}, [canvasHandleRef, activeLayerId, canvasWidth, canvasHeight,
    scale, opacity, colorMode, seed, captureHistory, onClose])
```

#### Seed row JSX

```tsx
{/* Seed row */}
<div className={styles.row}>
  <span className={styles.label}>Seed</span>
  <input type="range" className={styles.slider} min={0} max={9999}
         value={seed} onChange={e => handleSeedChange(Number(e.target.value))} />
  <input type="number" className={`${styles.numberInput} ${styles.seedInput}`}
         min={0} max={9999} value={seed}
         onChange={e => handleSeedChange(Number(e.target.value))}
         onBlur={e => handleSeedChange(Number(e.target.value))} />
  <button className={styles.randomizeBtn} onClick={handleRandomizeSeed}
          title="Randomize seed">⟳</button>
</div>
```

#### Full JSX structure summary

Five rows: **Scale** (1–200, no unit), **Opacity** (1–100, unit `%`), **Color Mode** (toggle: Grayscale / Color), **Seed** (0–9999, number input + slider, randomize button). Plus busy/selection/error feedback. Footer: Cancel + Apply.

---

### Step 19 — `CloudsDialog.module.scss`

Copy `GaussianBlurDialog.module.scss` verbatim. Add:

```scss
// ── Toggle group and buttons (Color Mode) ────────────────────────────────────
// (same classes as AddNoiseDialog.module.scss)
.toggleGroup { ... }
.toggleBtn { ... }
.toggleBtnActive { ... }

// ── Seed row extras ───────────────────────────────────────────────────────────

.seedInput {
  width: 54px;   // overrides the default 44px width from .numberInput
  text-align: left;
}

.randomizeBtn {
  width: 22px;
  height: 18px;
  background: vars.$color-bg;
  border: 1px solid vars.$color-border-light;
  border-radius: 2px;
  font-size: 13px;
  line-height: 1;
  color: vars.$color-text-dim;
  cursor: default;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  &:hover {
    background: vars.$color-surface-hover;
    color: vars.$color-text;
  }
}
```

Plus `.selectionNote` and `.errorMessage` as in the other dialogs.

---

### Step 20 — `src/components/index.ts`: Export new dialogs

Append after the `SmartSharpenDialog` exports:

```ts
export { AddNoiseDialog }  from './dialogs/AddNoiseDialog/AddNoiseDialog'
export type { AddNoiseDialogProps }  from './dialogs/AddNoiseDialog/AddNoiseDialog'
export { FilmGrainDialog } from './dialogs/FilmGrainDialog/FilmGrainDialog'
export type { FilmGrainDialogProps } from './dialogs/FilmGrainDialog/FilmGrainDialog'
export { LensBlurDialog }  from './dialogs/LensBlurDialog/LensBlurDialog'
export type { LensBlurDialogProps }  from './dialogs/LensBlurDialog/LensBlurDialog'
export { CloudsDialog }    from './dialogs/CloudsDialog/CloudsDialog'
export type { CloudsDialogProps }    from './dialogs/CloudsDialog/CloudsDialog'
```

---

## Architectural Constraints

- **Floating panel pattern:** All four dialogs are `position: fixed` panels, not modal overlays. They do not receive `open` as a boolean prop; instead `App.tsx` conditionally mounts them (`{showXxxDialog && <XxxDialog ... />}`) so the initialization `useEffect` fires naturally on mount regardless of the `isOpen` prop. The `isOpen` prop is still passed (always `true` when mounted) and consumed by the Escape key handler.

- **No AppState mutation during preview:** `writeLayerPixels` writes to the WebGL layer but does not dispatch to the `AppContext` reducer. History is captured only once, in `handleApply`, via `captureHistory()`.

- **Selection compositing:** All four dialogs use the same `applySelectionComposite` helper defined locally (copied from `GaussianBlurDialog`). The selection mask is captured once at dialog open time and held in `selectionMaskRef`. The mask does not update if the selection changes while the panel is open.

- **Seed determinism:** For Add Noise and Film Grain, `seedRef.current` is initialized once in the `useEffect`(`[isOpen, ...]`) cleanup return. The same seed is used for every preview call and for Apply, guaranteeing that "the applied result is identical to the last preview shown" as required by the spec.

- **CSS Modules:** All SCSS files use `.module.scss`. No plain `.scss` default imports.

- **WASM memory:** All four `src/wasm/index.ts` wrappers use `withInPlaceBuffer`. No manual `_malloc`/`_free` required in the TypeScript layer. `HEAPU8` is re-read after the WASM call by `withInPlaceBuffer` automatically via `m.HEAPU8.slice(...)`.

- **Generated WASM files are gitignored:** Developers must run `npm run build:wasm` after applying Steps 1–4.

---

## Open Questions

1. **Film Grain roughness formula mismatch.** The implementation uses `weight = lerp(1-luma, 1.0, roughness/100)`, which produces: dark-pixel-dominant grain at roughness=0, and uniform grain at roughness=100. The spec acceptance criterion states "With Roughness = 100, the inverse is true — brighter pixels receive stronger grain." A formula that satisfies all three checkpoints (dark at 0, uniform at 50, bright at 100) is `weight = lerp(1-luma, luma, roughness/100)`. Confirm which formula is intended before implementation.

2. **Add Noise: maxDelta cap.** The specification states "at Amount=400, shifts reach up to ±127×4 levels before clamping", implying `maxDelta = amount * 127 / 100` with no upper bound. The original request spec simultaneously says `maxDelta = min(127, amount*127/100)`. These conflict. The design above uses the uncapped formula to match the written spec. Confirm.

3. **Lens Blur kernel memory.** At radius=100, `kernel` is a `std::vector<float>` of 201×201 = 40,401 floats (~160 KB). This is allocated on the heap once per call and freed on return, which is acceptable. No stack-size concern.

4. **Clouds: `seed` range.** The spec defines seed as 0–9999. The WASM function receives a `uint32_t` seed, so there is no conflict; all 10,000 values are distinct. The internal LCG mixes the seed with a fixed constant (`^ 0xDEADBEEFu`) to prevent seed=0 from producing a degenerate flat noise field.

5. **TopBar submenu depth.** The spec describes "Filters → Noise → Add Noise…", implying true nested submenus. The current `TopBar` uses a flat menu with separator support. The design implements separator-based grouping, which is visually distinct but is not a true nested submenu. If nested submenus are required, the `TopBar` menu renderer (and the underlying `MenuBar` widget) would need to support a `submenu` item type, which is a larger change tracked separately.
