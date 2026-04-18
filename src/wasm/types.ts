/**
 * Types for the Emscripten-generated pixelops WASM module.
 *
 * The module is compiled with:
 *   -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPixelOps
 *   -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32
 *   -sEXPORTED_FUNCTIONS=_malloc,_free,...
 */

export interface PixelOpsModule {
  // Memory management
  _malloc(size: number): number
  _free(ptr: number): void

  // Live view of WASM linear memory (re-read after any call that may grow memory)
  HEAPU8: Uint8Array
  HEAPF32: Float32Array

  // ── Operations ────────────────────────────────────────────────────────────
  _pixelops_flood_fill(
    pixelsPtr: number, width: number, height: number,
    startX: number, startY: number,
    fillR: number, fillG: number, fillB: number, fillA: number,
    tolerance: number
  ): void

  _pixelops_convolve(
    srcPtr: number, dstPtr: number,
    width: number, height: number,
    kernelPtr: number, kernelSize: number
  ): void

  _pixelops_resize_bilinear(
    srcPtr: number, srcWidth: number, srcHeight: number,
    dstPtr: number, dstWidth: number, dstHeight: number
  ): void

  _pixelops_resize_nearest(
    srcPtr: number, srcWidth: number, srcHeight: number,
    dstPtr: number, dstWidth: number, dstHeight: number
  ): void

  _pixelops_dither_floyd_steinberg(
    pixelsPtr: number, width: number, height: number,
    palettePtr: number, paletteSize: number
  ): void

  _pixelops_dither_bayer(
    pixelsPtr: number, width: number, height: number, matrixSize: number
  ): void

  /**
   * Returns the actual number of palette entries produced (≤ maxColors).
   * palettePtr must point to a buffer of at least maxColors * 4 bytes.
   */
  _pixelops_quantize(
    pixelsPtr: number, pixelCount: number,
    paletteOutPtr: number, maxColors: number
  ): number

  /**
   * Computes histogram for curves adjustment.
    * Returns pointer to 4*256 float32 array (rgb, red, green, blue channels).
   * maskPtr may be null for no selection mask.
   */
  _pixelops_curves_histogram(
    inputPtr: number, width: number, height: number,
    maskPtr: number
  ): number

_pixelops_remove_motion_blur(
    pixelsPtr: number, width: number, height: number,
    angleDeg: number, distance: number, noiseReduction: number
  ): void
}

/** Factory function exported by the Emscripten-generated ES module */
export type PixelOpsFactory = (options: {
  locateFile: (filename: string) => string
}) => Promise<PixelOpsModule>

/** Result of histogram computation for curves adjustment */
export interface CurvesHistogramResult {
  rgb: Float32Array
  red: Float32Array
  green: Float32Array
  blue: Float32Array
}
