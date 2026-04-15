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

// ─── Triple box-blur approximation of Gaussian ────────────────────────────────
//
// Three sequential box blurs converge to a Gaussian (Central Limit Theorem).
// Each box blur uses a sliding-window sum — O(1) per pixel regardless of radius.
// This is 10-50× faster than the old separable kernel at large radii.

// Compute three box half-widths that together approximate a Gaussian with
// standard deviation sigma (formula by Ivan Kuckir).
static void boxesForGauss(float sigma, int& r0, int& r1, int& r2) {
    const int n = 3;
    float wIdeal = std::sqrt(12.f * sigma * sigma / n + 1.f);
    int wl = static_cast<int>(wIdeal);
    if (wl % 2 == 0) wl--;          // ensure odd
    const int wu = wl + 2;
    const float mIdeal =
        (12.f * sigma * sigma - n * wl * wl - 4.f * n * wl - 3.f * n)
        / (-4.f * wl - 4.f);
    const int m = static_cast<int>(std::round(mIdeal));
    const int rl = (wl - 1) / 2;
    const int ru = (wu - 1) / 2;
    r0 = (0 < m) ? rl : ru;
    r1 = (1 < m) ? rl : ru;
    r2 = (2 < m) ? rl : ru;
}

// Horizontal box blur: reads src, writes dst. All 4 RGBA channels in one pass.
static void boxBlurH(const uint8_t* src, uint8_t* dst,
                     int width, int height, int r)
{
    const int ksize = 2 * r + 1;
    for (int y = 0; y < height; ++y) {
        // Initialise the sliding-window sum for x = 0
        int s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (int i = 0; i < ksize; ++i) {
            const int xi  = std::clamp(i - r, 0, width - 1);
            const int idx = (y * width + xi) * 4;
            s0 += src[idx];
            s1 += src[idx + 1];
            s2 += src[idx + 2];
            s3 += src[idx + 3];
        }
        {
            const int di = y * width * 4;
            dst[di]     = static_cast<uint8_t>(s0 / ksize);
            dst[di + 1] = static_cast<uint8_t>(s1 / ksize);
            dst[di + 2] = static_cast<uint8_t>(s2 / ksize);
            dst[di + 3] = static_cast<uint8_t>(s3 / ksize);
        }
        for (int x = 1; x < width; ++x) {
            const int ax  = std::min(x + r,     width - 1);
            const int rx  = std::max(x - r - 1, 0);
            const int ai  = (y * width + ax) * 4;
            const int ri  = (y * width + rx) * 4;
            s0 += src[ai]     - src[ri];
            s1 += src[ai + 1] - src[ri + 1];
            s2 += src[ai + 2] - src[ri + 2];
            s3 += src[ai + 3] - src[ri + 3];
            const int di  = (y * width + x) * 4;
            dst[di]     = static_cast<uint8_t>(s0 / ksize);
            dst[di + 1] = static_cast<uint8_t>(s1 / ksize);
            dst[di + 2] = static_cast<uint8_t>(s2 / ksize);
            dst[di + 3] = static_cast<uint8_t>(s3 / ksize);
        }
    }
}

// Vertical box blur: reads src, writes dst. All 4 RGBA channels in one pass.
static void boxBlurV(const uint8_t* src, uint8_t* dst,
                     int width, int height, int r)
{
    const int ksize = 2 * r + 1;
    for (int x = 0; x < width; ++x) {
        int s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (int i = 0; i < ksize; ++i) {
            const int yi  = std::clamp(i - r, 0, height - 1);
            const int idx = (yi * width + x) * 4;
            s0 += src[idx];
            s1 += src[idx + 1];
            s2 += src[idx + 2];
            s3 += src[idx + 3];
        }
        {
            const int di = x * 4;
            dst[di]     = static_cast<uint8_t>(s0 / ksize);
            dst[di + 1] = static_cast<uint8_t>(s1 / ksize);
            dst[di + 2] = static_cast<uint8_t>(s2 / ksize);
            dst[di + 3] = static_cast<uint8_t>(s3 / ksize);
        }
        for (int y = 1; y < height; ++y) {
            const int ay  = std::min(y + r,      height - 1);
            const int ry  = std::max(y - r - 1,  0);
            const int ai  = (ay * width + x) * 4;
            const int ri  = (ry * width + x) * 4;
            s0 += src[ai]     - src[ri];
            s1 += src[ai + 1] - src[ri + 1];
            s2 += src[ai + 2] - src[ri + 2];
            s3 += src[ai + 3] - src[ri + 3];
            const int di  = (y * width + x) * 4;
            dst[di]     = static_cast<uint8_t>(s0 / ksize);
            dst[di + 1] = static_cast<uint8_t>(s1 / ksize);
            dst[di + 2] = static_cast<uint8_t>(s2 / ksize);
            dst[di + 3] = static_cast<uint8_t>(s3 / ksize);
        }
    }
}

void filters_gaussian_blur(
    uint8_t* pixels, int width, int height, int radius
) {
    if (radius <= 0) return;

    const float sigma = radius / 3.f + 1.f;
    int r0, r1, r2;
    boxesForGauss(sigma, r0, r1, r2);

    std::vector<uint8_t> tmp(static_cast<size_t>(width) * height * 4);

    // Each pass: H-blur pixels→tmp, V-blur tmp→pixels
    boxBlurH(pixels, tmp.data(), width, height, r0);
    boxBlurV(tmp.data(), pixels, width, height, r0);

    boxBlurH(pixels, tmp.data(), width, height, r1);
    boxBlurV(tmp.data(), pixels, width, height, r1);

    boxBlurH(pixels, tmp.data(), width, height, r2);
    boxBlurV(tmp.data(), pixels, width, height, r2);
}

void filters_box_blur(
    uint8_t* pixels, int width, int height, int radius
) {
    if (radius <= 0) return;

    std::vector<uint8_t> tmp(static_cast<size_t>(width) * height * 4);
    boxBlurH(pixels, tmp.data(), width, height, radius);
    boxBlurV(tmp.data(), pixels, width, height, radius);
}
