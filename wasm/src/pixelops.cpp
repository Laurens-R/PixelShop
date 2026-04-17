/**
 * pixelops.cpp
 *
 * Exported C interface for all WASM pixel operations.
 * Each function is declared EMSCRIPTEN_KEEPALIVE so the linker retains it
 * even if it would otherwise be dead-stripped.
 *
 * Memory convention:
 *   Callers allocate buffers via malloc / free (exported by Emscripten).
 *   Pixel buffers are always RGBA, row-major, 4 bytes per pixel.
 */

#include <emscripten/emscripten.h>
#include <cstdint>

#include "fill.h"
#include "filters.h"
#include "quantize.h"
#include "resize.h"
#include "dither.h"
#include "curves_histogram.h"

extern "C" {

// ─── Flood Fill ───────────────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_flood_fill(
    uint8_t* pixels, int width, int height,
    int startX, int startY,
    uint8_t fillR, uint8_t fillG, uint8_t fillB, uint8_t fillA,
    int tolerance
) {
    fill_flood(pixels, width, height, startX, startY,
               fillR, fillG, fillB, fillA, tolerance);
}

// ─── Gaussian Blur (in-place) ─────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_gaussian_blur(
    uint8_t* pixels, int width, int height, int radius
) {
    filters_gaussian_blur(pixels, width, height, radius);
}

// ─── Box Blur (in-place) ──────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_box_blur(
    uint8_t* pixels, int width, int height, int radius
) {
    filters_box_blur(pixels, width, height, radius);
}

// ─── Generic Convolution (src → dst) ─────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_convolve(
    const uint8_t* src, uint8_t* dst,
    int width, int height,
    const float* kernel, int kernelSize
) {
    filters_convolve(src, dst, width, height, kernel, kernelSize);
}

// ─── Bilinear Resize ─────────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_resize_bilinear(
    const uint8_t* src, int srcWidth, int srcHeight,
    uint8_t* dst, int dstWidth, int dstHeight
) {
    resize_bilinear(src, srcWidth, srcHeight, dst, dstWidth, dstHeight);
}

// ─── Nearest-Neighbour Resize ────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_resize_nearest(
    const uint8_t* src, int srcWidth, int srcHeight,
    uint8_t* dst, int dstWidth, int dstHeight
) {
    resize_nearest(src, srcWidth, srcHeight, dst, dstWidth, dstHeight);
}

// ─── Floyd-Steinberg Dithering ────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_dither_floyd_steinberg(
    uint8_t* pixels, int width, int height,
    const uint8_t* palette, int paletteSize
) {
    dither_floyd_steinberg(pixels, width, height, palette, paletteSize);
}

// ─── Bayer Ordered Dithering ─────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_dither_bayer(
    uint8_t* pixels, int width, int height, int matrixSize
) {
    dither_bayer(pixels, width, height, matrixSize);
}

// ─── Median-Cut Palette Quantisation ─────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
int pixelops_quantize(
    const uint8_t* pixels, int pixelCount,
    uint8_t* paletteOut, int maxColors
) {
    return quantize_median_cut(pixels, pixelCount, paletteOut, maxColors);
}

// ─── Curves Histogram ────────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
float* pixelops_curves_histogram(
    const uint8_t* inputPtr, uint32_t width, uint32_t height,
    const uint8_t* maskPtr
) {
    return computeCurvesHistogram(inputPtr, width, height, maskPtr);
}

// ─── Radial Blur (in-place) ───────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_radial_blur(
    uint8_t* pixels, int width, int height,
    int mode, int amount, float centerX, float centerY, int quality
) {
    filters_radial_blur(pixels, width, height, mode, amount, centerX, centerY, quality);
}

// ─── Sharpen (in-place) ───────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_sharpen(uint8_t* pixels, int width, int height) {
    filters_sharpen(pixels, width, height);
}

// ─── Sharpen More (in-place) ──────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_sharpen_more(uint8_t* pixels, int width, int height) {
    filters_sharpen_more(pixels, width, height);
}

// ─── Unsharp Mask (in-place) ──────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_unsharp_mask(uint8_t* pixels, int width, int height,
                            int amount, int radius, int threshold) {
    filters_unsharp_mask(pixels, width, height, amount, radius, threshold);
}

// ─── Smart Sharpen (in-place) ─────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_smart_sharpen(uint8_t* pixels, int width, int height,
                              int amount, int radius, int reduceNoise, int remove) {
    filters_smart_sharpen(pixels, width, height, amount, radius, reduceNoise, remove);
}

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

} // extern "C"
