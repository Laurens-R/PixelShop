#pragma once
#include <cstdint>

/// Floyd-Steinberg error-diffusion dithering.
/// Quantises each pixel to the nearest entry in the supplied RGBA palette,
/// then distributes the residual error to neighbouring pixels.
/// palette: RGBA palette entries (paletteSize * 4 bytes).
void dither_floyd_steinberg(
    uint8_t* pixels, int width, int height,
    const uint8_t* palette, int paletteSize
);

/// Ordered (Bayer) dithering — works per-channel without a palette.
/// matrixSize: 2, 4, or 8 (selects the standard Bayer threshold matrix).
void dither_bayer(
    uint8_t* pixels, int width, int height, int matrixSize
);
