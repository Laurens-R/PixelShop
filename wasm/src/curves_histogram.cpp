#include "curves_histogram.h"
#include <cstdlib>
#include <cstring>

float* computeCurvesHistogram(
    const uint8_t* inputPixelData, uint32_t width, uint32_t height,
    const uint8_t* selectionMask
) {
    const uint32_t histogramSize = 4 * 256; // 4 channels × 256 bins
    float* histogram = static_cast<float*>(std::malloc(histogramSize * sizeof(float)));
    if (!histogram) return nullptr;
    std::memset(histogram, 0, histogramSize * sizeof(float));

    const uint32_t pixelCount = width * height;
    
    for (uint32_t i = 0; i < pixelCount; ++i) {
        const uint32_t srcIdx = i * 4; // RGBA
        const uint8_t r = inputPixelData[srcIdx];
        const uint8_t g = inputPixelData[srcIdx + 1];
        const uint8_t b = inputPixelData[srcIdx + 2];
        const uint8_t a = inputPixelData[srcIdx + 3];

        // Skip fully transparent pixels
        if (a == 0) continue;

        // Calculate effective weight
        double weight = static_cast<double>(a) / 255.0;
        if (selectionMask) {
            const uint8_t maskValue = selectionMask[i];
            weight *= static_cast<double>(maskValue) / 255.0;
        }

        // Indices into the histogram array
        uint32_t rgbBase = 0;
        uint32_t redBase = 256;
        uint32_t greenBase = 512;
        uint32_t blueBase = 768;

        // Increment histograms
        histogram[rgbBase + r] += weight;
        histogram[rgbBase + g] += weight;
        histogram[rgbBase + b] += weight;
        histogram[redBase + r] += weight;
        histogram[greenBase + g] += weight;
        histogram[blueBase + b] += weight;
    }

    return histogram;
}
