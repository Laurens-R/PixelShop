#pragma once
#include <cstdint>

/**
 * GrabCut segmentation (Rother et al. 2004).
 *
 * Uses a trimap initialised from the SAM selection mask:
 *   inner = definite foreground (eroded selection)
 *   outer = definite background (outside dilated selection)
 *   band  = unknown region (to be classified by GrabCut)
 *
 * @param rgba        RGBA source image, row-major, width × height × 4 bytes.
 * @param width       Image width.
 * @param height      Image height.
 * @param trimap      Per-pixel label, width × height bytes:
 *                    0   = definite background
 *                    128 = unknown (GrabCut will classify)
 *                    255 = definite foreground
 * @param alpha_out   Output alpha mask, width × height bytes (255=FG, 0=BG).
 *                    Must be pre-allocated by caller.
 * @param iterations  EM iterations (3 is typically sufficient).
 * @param k           Number of GMM components per class (5 is standard).
 */
void grabcut(
    const uint8_t* rgba, int width, int height,
    const uint8_t* trimap,
    uint8_t* alpha_out,
    int iterations,
    int k
);

// ─── Hybrid GPU+WASM building blocks ─────────────────────────────────────────
//
// Per-component packed layout (20 floats):
//   [0..2]  mean.r/g/b           [3]   pad
//   [4..6]  invCov row 0         [7]   pad
//   [8..10] invCov row 1         [11]  pad
//   [12..14] invCov row 2        [15]  pad
//   [16]   logCoef = log(pi) - 0.5*log(detCov + GMM_EPS)
//   [17]   pi
//   [18..19] pad
// Buffer layout for both GMMs: 2 * k * 20 floats, FG first then BG.

float grabcut_compute_beta(const uint8_t* rgba, int w, int h);

void grabcut_kmeans_init(const uint8_t* rgba, int w, int h,
                         const uint8_t* trimap, int k, float* paramsOut);

void grabcut_update_gmms(const uint8_t* rgba, int w, int h,
                         const uint8_t* label, int k, float* paramsInOut);

void grabcut_mincut(const float* capS, const float* capT,
                    const float* hW, const float* vW,
                    const uint8_t* trimap, int w, int h, uint8_t* labelOut);
