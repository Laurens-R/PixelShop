#include "dither.h"
#include <cmath>
#include <algorithm>

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
