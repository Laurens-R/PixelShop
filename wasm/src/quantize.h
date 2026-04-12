#pragma once
#include <cstdint>

/// Median-cut palette quantization.
/// pixels: RGBA row-major buffer, pixelCount = width * height.
/// paletteOut: output buffer of size maxColors * 4 (RGBA).
/// Returns the actual number of palette entries produced (≤ maxColors).
int quantize_median_cut(
    const uint8_t* pixels, int pixelCount,
    uint8_t* paletteOut, int maxColors
);
