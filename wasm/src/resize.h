#pragma once
#include <cstdint>

/// Bilinear-interpolation resize.
/// src: RGBA buffer of srcWidth * srcHeight pixels.
/// dst: pre-allocated RGBA output buffer of dstWidth * dstHeight pixels.
void resize_bilinear(
    const uint8_t* src, int srcWidth, int srcHeight,
    uint8_t* dst, int dstWidth, int dstHeight
);

/// Nearest-neighbour resize (preserves hard pixel edges).
void resize_nearest(
    const uint8_t* src, int srcWidth, int srcHeight,
    uint8_t* dst, int dstWidth, int dstHeight
);
