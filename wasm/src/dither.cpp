#include "dither.h"
#include <vector>
#include <cmath>
#include <algorithm>
#include <limits>

// ─── Helpers ─────────────────────────────────────────────────────────────────

static int colorDist2RGBA(
    int r1, int g1, int b1, int a1,
    int r2, int g2, int b2, int a2
) {
    return (r1-r2)*(r1-r2) + (g1-g2)*(g1-g2) +
           (b1-b2)*(b1-b2) + (a1-a2)*(a1-a2);
}

// Find index of the nearest RGBA entry in the palette
static int nearestPalette(
    int r, int g, int b, int a,
    const uint8_t* palette, int paletteSize
) {
    int best = 0;
    int bestDist = std::numeric_limits<int>::max();
    for (int i = 0; i < paletteSize; ++i) {
        const int d = colorDist2RGBA(
            r, g, b, a,
            palette[i*4], palette[i*4+1], palette[i*4+2], palette[i*4+3]);
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

// ─── Floyd-Steinberg ─────────────────────────────────────────────────────────

void dither_floyd_steinberg(
    uint8_t* pixels, int width, int height,
    const uint8_t* palette, int paletteSize
) {
    // Work in float to accumulate error; initialise from the uint8 buffer
    const int n = width * height * 4;
    std::vector<float> buf(n);
    for (int i = 0; i < n; ++i) buf[i] = static_cast<float>(pixels[i]);

    auto clamp8 = [](float v) { return std::clamp(v, 0.f, 255.f); };

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const int idx = (y * width + x) * 4;
            const int ir = static_cast<int>(buf[idx]);
            const int ig = static_cast<int>(buf[idx + 1]);
            const int ib = static_cast<int>(buf[idx + 2]);
            const int ia = static_cast<int>(buf[idx + 3]);

            const int pi = nearestPalette(ir, ig, ib, ia, palette, paletteSize);
            const int pr = palette[pi*4],  pg = palette[pi*4+1];
            const int pb = palette[pi*4+2], pa = palette[pi*4+3];

            // Write quantised colour
            pixels[idx]     = static_cast<uint8_t>(pr);
            pixels[idx + 1] = static_cast<uint8_t>(pg);
            pixels[idx + 2] = static_cast<uint8_t>(pb);
            pixels[idx + 3] = static_cast<uint8_t>(pa);

            // Compute error per channel
            const float er = ir - pr, eg = ig - pg, eb = ib - pb, ea = ia - pa;

            // Distribute error to neighbours (Floyd-Steinberg weights)
            auto spread = [&](int nx, int ny, float weight) {
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
                const int ni = (ny * width + nx) * 4;
                buf[ni]     = clamp8(buf[ni]     + er * weight);
                buf[ni + 1] = clamp8(buf[ni + 1] + eg * weight);
                buf[ni + 2] = clamp8(buf[ni + 2] + eb * weight);
                buf[ni + 3] = clamp8(buf[ni + 3] + ea * weight);
            };

            spread(x + 1, y,     7.f / 16.f);
            spread(x - 1, y + 1, 3.f / 16.f);
            spread(x,     y + 1, 5.f / 16.f);
            spread(x + 1, y + 1, 1.f / 16.f);
        }
    }
}

// ─── Bayer Ordered Dithering ────────────────────────────────────────────────

// Standard Bayer matrices (normalised to [0, 1])
static const float BAYER2[4]  = {
    0/4.f, 2/4.f,
    3/4.f, 1/4.f
};
static const float BAYER4[16] = {
     0/16.f,  8/16.f,  2/16.f, 10/16.f,
    12/16.f,  4/16.f, 14/16.f,  6/16.f,
     3/16.f, 11/16.f,  1/16.f,  9/16.f,
    15/16.f,  7/16.f, 13/16.f,  5/16.f
};
static const float BAYER8[64] = {
     0/64.f, 32/64.f,  8/64.f, 40/64.f,  2/64.f, 34/64.f, 10/64.f, 42/64.f,
    48/64.f, 16/64.f, 56/64.f, 24/64.f, 50/64.f, 18/64.f, 58/64.f, 26/64.f,
    12/64.f, 44/64.f,  4/64.f, 36/64.f, 14/64.f, 46/64.f,  6/64.f, 38/64.f,
    60/64.f, 28/64.f, 52/64.f, 20/64.f, 62/64.f, 30/64.f, 54/64.f, 22/64.f,
     3/64.f, 35/64.f, 11/64.f, 43/64.f,  1/64.f, 33/64.f,  9/64.f, 41/64.f,
    51/64.f, 19/64.f, 59/64.f, 27/64.f, 49/64.f, 17/64.f, 57/64.f, 25/64.f,
    15/64.f, 47/64.f,  7/64.f, 39/64.f, 13/64.f, 45/64.f,  5/64.f, 37/64.f,
    63/64.f, 31/64.f, 55/64.f, 23/64.f, 61/64.f, 29/64.f, 53/64.f, 21/64.f
};

void dither_bayer(
    uint8_t* pixels, int width, int height, int matrixSize
) {
    const float* matrix;
    int mSize;
    if (matrixSize <= 2)       { matrix = BAYER2; mSize = 2; }
    else if (matrixSize <= 4)  { matrix = BAYER4; mSize = 4; }
    else                       { matrix = BAYER8; mSize = 8; }

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const float threshold = matrix[(y % mSize) * mSize + (x % mSize)] - 0.5f;
            const int idx = (y * width + x) * 4;
            // Apply threshold to R, G, B; leave alpha unchanged
            for (int c = 0; c < 3; ++c) {
                const float adjusted = pixels[idx + c] / 255.f + threshold;
                pixels[idx + c] = adjusted >= 0.5f ? 255 : 0;
            }
        }
    }
}
