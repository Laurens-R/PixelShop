#pragma once
#include <cstdint>

/**
 * PatchMatch inpainting.
 *
 * @param pixels    RGBA source image, row-major, width × height × 4 bytes.
 * @param width     Image width in pixels.
 * @param height    Image height in pixels.
 * @param mask      Single-channel mask, width × height bytes.
 *                  255 = fill region (to synthesise), 0 = source region (known).
 * @param patchSize Patch half-radius in pixels (full patch = (2*patchSize+1)²).
 *                  Recommended: 4 (→ 9×9 patches).
 * @param out       Pre-allocated RGBA output buffer, same size as pixels.
 *                  Pixels outside the mask are copied from pixels unchanged.
 *                  Pixels inside the mask are replaced with the inpainted result.
 */
void inpaint(
    const uint8_t* pixels, int width, int height,
    const uint8_t* mask, int patchSize,
    uint8_t* out
);
