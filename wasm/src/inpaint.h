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
 * @param patchSize  Patch half-radius in pixels (full patch = (2*patchSize+1)²).
 *                   Recommended: 4 (→ 9×9 patches).
 * @param sourceMask Optional single-channel source-eligibility mask, same size as pixels.
 *                   1 = pixel may be used as a source patch; 0 = excluded.
 *                   Pass nullptr to allow the entire image outside the fill mask.
 * @param out        Pre-allocated RGBA output buffer, same size as pixels.
 *                   Pixels outside the mask are copied from pixels unchanged.
 *                   Pixels inside the mask are replaced with the inpainted result.
 */
void inpaint(
    const uint8_t* pixels, int width, int height,
    const uint8_t* mask, int patchSize,
    const uint8_t* sourceMask,
    uint8_t* out
);
