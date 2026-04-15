#pragma once
#include <cstdint>

/// Compute histogram for curves adjustment.
/// Returns a pointer to a dynamically allocated array of 4*256 float32 values
/// (layout: rgb[256], red[256], green[256], blue[256]).
/// Caller must release with free/_free (malloc-compatible allocator).
///
/// Algorithm:
/// For each non-transparent pixel:
///   effective_weight = alpha / 255.0
///   if selectionMask provided, weight *= selectionMask[i] / 255.0
///   histogram[channel][value] += weight
float* computeCurvesHistogram(
    const uint8_t* inputPixelData, uint32_t width, uint32_t height,
    const uint8_t* selectionMask
);
