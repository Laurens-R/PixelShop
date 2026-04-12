#pragma once
#include <cstdint>

/// Generic 2-D convolution.  src and dst must be separate buffers of size width*height*4.
/// kernel is a row-major float array of size kernelSize*kernelSize (must be odd).
/// Border pixels use clamp-to-edge.
void filters_convolve(
    const uint8_t* src, uint8_t* dst,
    int width, int height,
    const float* kernel, int kernelSize
);

/// Separable Gaussian blur applied in-place.
/// radius controls kernel half-size; sigma = radius / 3.
void filters_gaussian_blur(
    uint8_t* pixels, int width, int height, int radius
);
