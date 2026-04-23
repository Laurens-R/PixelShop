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
#include "transform.h"
#include "inpaint.h"

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


// ─── Remove Motion Blur (in-place) ──────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_remove_motion_blur(
    uint8_t* pixels, int width, int height,
    float angleDeg, int distance, int noiseReduction
) {
    filters_remove_motion_blur(pixels, width, height, angleDeg, distance, noiseReduction);
}

// ─── Affine Transform (src → dst, inverse-mapped) ───────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_affine_transform(
    const uint8_t* src, int srcW, int srcH,
    uint8_t* dst, int dstW, int dstH,
    const float* invMatrix,
    int interp
) {
    transform_affine(src, srcW, srcH, dst, dstW, dstH, invMatrix, interp);
}

// ─── Perspective Transform (src → dst, inverse homography) ──────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_perspective_transform(
    const uint8_t* src, int srcW, int srcH,
    uint8_t* dst, int dstW, int dstH,
    const float* invH,
    int interp
) {
    transform_perspective(src, srcW, srcH, dst, dstW, dstH, invH, interp);
}

// ─── Content-Aware Inpainting (PatchMatch) ───────────────────────────────────

EMSCRIPTEN_KEEPALIVE
void pixelops_inpaint(
    const uint8_t* pixels, int width, int height,
    const uint8_t* mask, int patchSize,
    const uint8_t* sourceMask,  // nullable; 1=eligible source, 0=excluded. null=unconstrained.
    uint8_t* out
) {
    inpaint(pixels, width, height, mask, patchSize, sourceMask, out);
}

} // extern "C"
