#pragma once
#include <cstdint>

/// Ordered (Bayer) dithering — works per-channel without a palette.
/// matrixSize: 2, 4, or 8 (selects the standard Bayer threshold matrix).
void dither_bayer(
    uint8_t* pixels, int width, int height, int matrixSize
);
