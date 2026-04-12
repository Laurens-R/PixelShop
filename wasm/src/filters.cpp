#include "filters.h"
#include <vector>
#include <cmath>
#include <algorithm>

void filters_convolve(
    const uint8_t* src, uint8_t* dst,
    int width, int height,
    const float* kernel, int kernelSize
) {
    const int half = kernelSize / 2;

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            float r = 0.f, g = 0.f, b = 0.f, a = 0.f;

            for (int ky = 0; ky < kernelSize; ++ky) {
                const int sy = std::clamp(y + ky - half, 0, height - 1);
                for (int kx = 0; kx < kernelSize; ++kx) {
                    const int sx  = std::clamp(x + kx - half, 0, width - 1);
                    const int idx = (sy * width + sx) * 4;
                    const float k = kernel[ky * kernelSize + kx];
                    r += src[idx]     * k;
                    g += src[idx + 1] * k;
                    b += src[idx + 2] * k;
                    a += src[idx + 3] * k;
                }
            }

            const int dstIdx = (y * width + x) * 4;
            dst[dstIdx]     = static_cast<uint8_t>(std::clamp((int)r, 0, 255));
            dst[dstIdx + 1] = static_cast<uint8_t>(std::clamp((int)g, 0, 255));
            dst[dstIdx + 2] = static_cast<uint8_t>(std::clamp((int)b, 0, 255));
            dst[dstIdx + 3] = static_cast<uint8_t>(std::clamp((int)a, 0, 255));
        }
    }
}

// ─── Separable Gaussian ───────────────────────────────────────────────────────

static std::vector<float> makeGaussianKernel1D(int radius) {
    const int size = 2 * radius + 1;
    const float sigma = radius / 3.f + 1.f; // prevent sigma=0 for radius=0
    const float twoSigmaSq = 2.f * sigma * sigma;
    std::vector<float> k(size);
    float sum = 0.f;

    for (int i = 0; i < size; ++i) {
        const float d = static_cast<float>(i - radius);
        k[i] = std::exp(-(d * d) / twoSigmaSq);
        sum += k[i];
    }
    for (auto& v : k) v /= sum;
    return k;
}

void filters_gaussian_blur(
    uint8_t* pixels, int width, int height, int radius
) {
    if (radius <= 0) return;

    const auto k = makeGaussianKernel1D(radius);
    const int kSize = static_cast<int>(k.size());

    // Temporary float buffer to accumulate horizontally blurred values
    std::vector<float> tmp(width * height * 4, 0.f);

    // Horizontal pass: pixels → tmp
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            float r = 0.f, g = 0.f, b = 0.f, a = 0.f;
            for (int ki = 0; ki < kSize; ++ki) {
                const int sx  = std::clamp(x + ki - radius, 0, width - 1);
                const int idx = (y * width + sx) * 4;
                r += pixels[idx]     * k[ki];
                g += pixels[idx + 1] * k[ki];
                b += pixels[idx + 2] * k[ki];
                a += pixels[idx + 3] * k[ki];
            }
            const int oi = (y * width + x) * 4;
            tmp[oi]     = r;
            tmp[oi + 1] = g;
            tmp[oi + 2] = b;
            tmp[oi + 3] = a;
        }
    }

    // Vertical pass: tmp → pixels
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            float r = 0.f, g = 0.f, b = 0.f, a = 0.f;
            for (int ki = 0; ki < kSize; ++ki) {
                const int sy = std::clamp(y + ki - radius, 0, height - 1);
                const int idx = (sy * width + x) * 4;
                r += tmp[idx]     * k[ki];
                g += tmp[idx + 1] * k[ki];
                b += tmp[idx + 2] * k[ki];
                a += tmp[idx + 3] * k[ki];
            }
            const int oi = (y * width + x) * 4;
            pixels[oi]     = static_cast<uint8_t>(std::clamp((int)r, 0, 255));
            pixels[oi + 1] = static_cast<uint8_t>(std::clamp((int)g, 0, 255));
            pixels[oi + 2] = static_cast<uint8_t>(std::clamp((int)b, 0, 255));
            pixels[oi + 3] = static_cast<uint8_t>(std::clamp((int)a, 0, 255));
        }
    }
}
