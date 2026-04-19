import { FILTER_GAUSSIAN_H_COMPUTE, FILTER_GAUSSIAN_V_COMPUTE, runGaussianBlur } from './shaders/filters/gaussian-blur'
import { FILTER_BOX_H_COMPUTE, FILTER_BOX_V_COMPUTE, runBoxBlur } from './shaders/filters/box-blur'
import { FILTER_RADIAL_BLUR_COMPUTE, runRadialBlur } from './shaders/filters/radial-blur'
import { FILTER_MOTION_BLUR_COMPUTE, runMotionBlur } from './shaders/filters/motion-blur'
import { FILTER_LENS_BLUR_COMPUTE, buildKernelEntries, runLensBlur } from './shaders/filters/lens-blur'
import { FILTER_SHARPEN_COMPUTE, FILTER_SHARPEN_MORE_COMPUTE, FILTER_UNSHARP_COMBINE_COMPUTE, runSharpen, runSharpenMore, runUnsharpMask } from './shaders/filters/sharpen'
import { FILTER_SMART_SHARPEN_GAUSS_COMBINE_COMPUTE, FILTER_SMART_SHARPEN_LENS_COMPUTE, FILTER_SMART_SHARPEN_BLEND_COMPUTE, runSmartSharpen } from './shaders/filters/smart-sharpen'
import { FILTER_ADD_NOISE_COMPUTE, runAddNoise } from './shaders/filters/add-noise'
import { FILTER_FILM_GRAIN_NOISE_COMPUTE, FILTER_FILM_GRAIN_COMBINE_COMPUTE, runFilmGrain } from './shaders/filters/film-grain'
import { FILTER_CLOUDS_COMPUTE, runClouds } from './shaders/filters/clouds'
import { FILTER_MEDIAN_COMPUTE, runMedian } from './shaders/filters/median'
import { FILTER_BILATERAL_COMPUTE, runBilateral } from './shaders/filters/bilateral'
import { FILTER_REDUCE_NOISE_COMPUTE, runReduceNoise } from './shaders/filters/reduce-noise'
import { FILTER_LENS_FLARE_COMPUTE, runRenderLensFlare } from './shaders/filters/lens-flare'

// ─── Engine ───────────────────────────────────────────────────────────────────

class FilterComputeEngine {
  private readonly device: GPUDevice
  private readonly gaussianHPipeline: GPUComputePipeline
  private readonly gaussianVPipeline: GPUComputePipeline
  private readonly boxHPipeline: GPUComputePipeline
  private readonly boxVPipeline: GPUComputePipeline
  private readonly radialBlurPipeline: GPUComputePipeline
  private readonly motionBlurPipeline: GPUComputePipeline
  private readonly lensBlurPipeline: GPUComputePipeline
  private readonly sharpenPipeline: GPUComputePipeline
  private readonly sharpenMorePipeline: GPUComputePipeline
  private readonly unsharpCombinePipeline: GPUComputePipeline
  private readonly smartSharpenGaussCombinePipeline: GPUComputePipeline
  private readonly smartSharpenLensPipeline: GPUComputePipeline
  private readonly smartSharpenBlendPipeline: GPUComputePipeline
  private readonly addNoisePipeline: GPUComputePipeline
  private readonly filmGrainNoisePipeline: GPUComputePipeline
  private readonly filmGrainCombinePipeline: GPUComputePipeline
  private readonly cloudsPipeline: GPUComputePipeline
  private readonly medianPipeline: GPUComputePipeline
  private readonly bilateralPipeline: GPUComputePipeline
  private readonly reduceNoisePipeline: GPUComputePipeline
  private readonly lensFlareRenderPipeline: GPUComputePipeline
  private readonly intermediate0: GPUTexture
  private cachedKernelKey: string = ''
  private cachedKernelBuf: GPUBuffer | null = null
  private cachedKernelCount: number = 0

  private constructor(device: GPUDevice, width: number, height: number) {
    this.device = device
    this.intermediate0 = device.createTexture({
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })
    this.gaussianHPipeline = this.makePipeline(FILTER_GAUSSIAN_H_COMPUTE, 'cs_gaussian_h')
    this.gaussianVPipeline = this.makePipeline(FILTER_GAUSSIAN_V_COMPUTE, 'cs_gaussian_v')
    this.boxHPipeline = this.makePipeline(FILTER_BOX_H_COMPUTE, 'cs_box_h')
    this.boxVPipeline = this.makePipeline(FILTER_BOX_V_COMPUTE, 'cs_box_v')
    this.radialBlurPipeline = this.makePipeline(FILTER_RADIAL_BLUR_COMPUTE, 'cs_radial_blur')
    this.motionBlurPipeline = this.makePipeline(FILTER_MOTION_BLUR_COMPUTE, 'cs_motion_blur')
    this.lensBlurPipeline = this.makePipeline(FILTER_LENS_BLUR_COMPUTE, 'cs_lens_blur')
    this.sharpenPipeline = this.makePipeline(FILTER_SHARPEN_COMPUTE, 'cs_sharpen')
    this.sharpenMorePipeline = this.makePipeline(FILTER_SHARPEN_MORE_COMPUTE, 'cs_sharpen_more')
    this.unsharpCombinePipeline = this.makePipeline(FILTER_UNSHARP_COMBINE_COMPUTE, 'cs_unsharp_combine')
    this.smartSharpenGaussCombinePipeline = this.makePipeline(FILTER_SMART_SHARPEN_GAUSS_COMBINE_COMPUTE, 'cs_smart_sharpen_gauss')
    this.smartSharpenLensPipeline = this.makePipeline(FILTER_SMART_SHARPEN_LENS_COMPUTE, 'cs_smart_sharpen_lens')
    this.smartSharpenBlendPipeline = this.makePipeline(FILTER_SMART_SHARPEN_BLEND_COMPUTE, 'cs_smart_sharpen_blend')
    this.addNoisePipeline = this.makePipeline(FILTER_ADD_NOISE_COMPUTE, 'cs_add_noise')
    this.filmGrainNoisePipeline = this.makePipeline(FILTER_FILM_GRAIN_NOISE_COMPUTE, 'cs_film_grain_noise')
    this.filmGrainCombinePipeline = this.makePipeline(FILTER_FILM_GRAIN_COMBINE_COMPUTE, 'cs_film_grain_combine')
    this.cloudsPipeline = this.makePipeline(FILTER_CLOUDS_COMPUTE, 'cs_clouds')
    this.medianPipeline = this.makePipeline(FILTER_MEDIAN_COMPUTE, 'cs_median')
    this.bilateralPipeline = this.makePipeline(FILTER_BILATERAL_COMPUTE, 'cs_bilateral')
    this.reduceNoisePipeline = this.makePipeline(FILTER_REDUCE_NOISE_COMPUTE, 'cs_reduce_noise')
    this.lensFlareRenderPipeline = this.makePipeline(FILTER_LENS_FLARE_COMPUTE, 'cs_lens_flare')
  }

  static create(device: GPUDevice, width: number, height: number): FilterComputeEngine {
    return new FilterComputeEngine(device, width, height)
  }

  destroy(): void {
    this.intermediate0.destroy()
    this.cachedKernelBuf?.destroy()
    this.cachedKernelBuf = null
  }

  private makePipeline(wgsl: string, entryPoint: string): GPUComputePipeline {
    const module = this.device.createShaderModule({ code: wgsl })
    return this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } })
  }

  async gaussianBlur(pixels: Uint8Array, width: number, height: number, radius: number): Promise<Uint8Array> {
    return runGaussianBlur(this.device, this.gaussianHPipeline, this.gaussianVPipeline, this.intermediate0, pixels, width, height, radius)
  }

  async boxBlur(pixels: Uint8Array, width: number, height: number, radius: number): Promise<Uint8Array> {
    return runBoxBlur(this.device, this.boxHPipeline, this.boxVPipeline, this.intermediate0, pixels, width, height, radius)
  }

  async radialBlur(pixels: Uint8Array, width: number, height: number, mode: number, amount: number, centerX: number, centerY: number, quality: number): Promise<Uint8Array> {
    return runRadialBlur(this.device, this.radialBlurPipeline, pixels, width, height, mode, amount, centerX, centerY, quality)
  }

  async motionBlur(pixels: Uint8Array, width: number, height: number, angleDeg: number, distance: number): Promise<Uint8Array> {
    return runMotionBlur(this.device, this.motionBlurPipeline, pixels, width, height, angleDeg, distance)
  }

  async lensBlur(pixels: Uint8Array, width: number, height: number, radius: number, bladeCount: number, bladeCurvature: number, rotation: number): Promise<Uint8Array> {
    const key = `${radius}|${bladeCount}|${bladeCurvature}|${rotation}`
    if (this.cachedKernelKey !== key) {
      this.cachedKernelBuf?.destroy()
      const entries = buildKernelEntries(radius, bladeCount, bladeCurvature, rotation)
      const buf = this.device.createBuffer({ size: Math.max(entries.byteLength, 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
      this.device.queue.writeBuffer(buf, 0, entries)
      this.cachedKernelBuf = buf
      this.cachedKernelKey = key
      this.cachedKernelCount = entries.length / 4
    }
    return runLensBlur(this.device, this.lensBlurPipeline, pixels, width, height, this.cachedKernelBuf!, this.cachedKernelCount)
  }

  async sharpen(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    return runSharpen(this.device, this.sharpenPipeline, pixels, width, height)
  }

  async sharpenMore(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    return runSharpenMore(this.device, this.sharpenMorePipeline, pixels, width, height)
  }

  async unsharpMask(pixels: Uint8Array, width: number, height: number, amount: number, radius: number, threshold: number): Promise<Uint8Array> {
    return runUnsharpMask(this.device, this.gaussianHPipeline, this.gaussianVPipeline, this.unsharpCombinePipeline, this.intermediate0, pixels, width, height, amount, radius, threshold)
  }

  async smartSharpen(pixels: Uint8Array, width: number, height: number, amount: number, radius: number, reduceNoise: number, remove: number): Promise<Uint8Array> {
    return runSmartSharpen(this.device, this.gaussianHPipeline, this.gaussianVPipeline, this.boxHPipeline, this.boxVPipeline, this.smartSharpenGaussCombinePipeline, this.smartSharpenLensPipeline, this.smartSharpenBlendPipeline, this.intermediate0, pixels, width, height, amount, radius, reduceNoise, remove)
  }

  async addNoise(pixels: Uint8Array, width: number, height: number, amount: number, distribution: number, monochromatic: number, seed: number): Promise<Uint8Array> {
    return runAddNoise(this.device, this.addNoisePipeline, pixels, width, height, amount, distribution, monochromatic, seed)
  }

  async filmGrain(pixels: Uint8Array, width: number, height: number, grainSize: number, intensity: number, roughness: number, seed: number): Promise<Uint8Array> {
    return runFilmGrain(this.device, this.filmGrainNoisePipeline, this.filmGrainCombinePipeline, this.boxHPipeline, this.boxVPipeline, this.intermediate0, pixels, width, height, grainSize, intensity, roughness, seed)
  }

  async clouds(pixels: Uint8Array, width: number, height: number, scale: number, opacity: number, colorMode: number, fgR: number, fgG: number, fgB: number, bgR: number, bgG: number, bgB: number, seed: number): Promise<Uint8Array> {
    return runClouds(this.device, this.cloudsPipeline, pixels, width, height, scale, opacity, colorMode, fgR, fgG, fgB, bgR, bgG, bgB, seed)
  }

  async median(pixels: Uint8Array, width: number, height: number, radius: number): Promise<Uint8Array> {
    return runMedian(this.device, this.medianPipeline, pixels, width, height, radius)
  }

  async bilateral(pixels: Uint8Array, width: number, height: number, radius: number, sigmaSpatial: number, sigmaColor: number): Promise<Uint8Array> {
    return runBilateral(this.device, this.bilateralPipeline, pixels, width, height, radius, sigmaSpatial, sigmaColor)
  }

  async reduceNoise(pixels: Uint8Array, width: number, height: number, strength: number, preserveDetails: number, reduceColorNoise: number, sharpenDetails: number): Promise<Uint8Array> {
    return runReduceNoise(this.device, this.reduceNoisePipeline, pixels, width, height, strength, preserveDetails, reduceColorNoise, sharpenDetails, (p, w, h, a, r, t) => this.unsharpMask(p, w, h, a, r, t))
  }

  async renderLensFlare(width: number, height: number, centerX: number, centerY: number, brightness: number, lensType: number, ringOpacity: number, streakStrength: number, streakWidth: number, streakRotation: number): Promise<Uint8Array> {
    return runRenderLensFlare(this.device, this.lensFlareRenderPipeline, width, height, centerX, centerY, brightness, lensType, ringOpacity, streakStrength, streakWidth, streakRotation)
  }
}

// ─── Module-level singleton ───────────────────────────────────────────────────

let _engine: FilterComputeEngine | null = null

export function initFilterCompute(device: GPUDevice, width: number, height: number): void {
  _engine?.destroy()
  _engine = FilterComputeEngine.create(device, width, height)
}

export async function gaussianBlur(pixels: Uint8Array, width: number, height: number, radius: number): Promise<Uint8Array> { return _engine!.gaussianBlur(pixels, width, height, radius) }
export async function boxBlur(pixels: Uint8Array, width: number, height: number, radius: number): Promise<Uint8Array> { return _engine!.boxBlur(pixels, width, height, radius) }
export async function radialBlur(pixels: Uint8Array, width: number, height: number, mode: number, amount: number, centerX: number, centerY: number, quality: number): Promise<Uint8Array> { return _engine!.radialBlur(pixels, width, height, mode, amount, centerX, centerY, quality) }
export async function motionBlur(pixels: Uint8Array, width: number, height: number, angleDeg: number, distance: number): Promise<Uint8Array> { return _engine!.motionBlur(pixels, width, height, angleDeg, distance) }
export async function lensBlur(pixels: Uint8Array, width: number, height: number, radius: number, bladeCount: number, bladeCurvature: number, rotation: number): Promise<Uint8Array> { return _engine!.lensBlur(pixels, width, height, radius, bladeCount, bladeCurvature, rotation) }
export async function sharpen(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> { return _engine!.sharpen(pixels, width, height) }
export async function sharpenMore(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> { return _engine!.sharpenMore(pixels, width, height) }
export async function unsharpMask(pixels: Uint8Array, width: number, height: number, amount: number, radius: number, threshold: number): Promise<Uint8Array> { return _engine!.unsharpMask(pixels, width, height, amount, radius, threshold) }
export async function smartSharpen(pixels: Uint8Array, width: number, height: number, amount: number, radius: number, reduceNoise: number, remove: number): Promise<Uint8Array> { return _engine!.smartSharpen(pixels, width, height, amount, radius, reduceNoise, remove) }
export async function addNoise(pixels: Uint8Array, width: number, height: number, amount: number, distribution: number, monochromatic: number, seed: number): Promise<Uint8Array> { return _engine!.addNoise(pixels, width, height, amount, distribution, monochromatic, seed) }
export async function filmGrain(pixels: Uint8Array, width: number, height: number, grainSize: number, intensity: number, roughness: number, seed: number): Promise<Uint8Array> { return _engine!.filmGrain(pixels, width, height, grainSize, intensity, roughness, seed) }
export async function clouds(pixels: Uint8Array, width: number, height: number, scale: number, opacity: number, colorMode: number, fgR: number, fgG: number, fgB: number, bgR: number, bgG: number, bgB: number, seed: number): Promise<Uint8Array> { return _engine!.clouds(pixels, width, height, scale, opacity, colorMode, fgR, fgG, fgB, bgR, bgG, bgB, seed) }
export async function median(pixels: Uint8Array, width: number, height: number, radius: number): Promise<Uint8Array> { return _engine!.median(pixels, width, height, radius) }
export async function bilateral(pixels: Uint8Array, width: number, height: number, radius: number, sigmaSpatial: number, sigmaColor: number): Promise<Uint8Array> { return _engine!.bilateral(pixels, width, height, radius, sigmaSpatial, sigmaColor) }
export async function reduceNoise(pixels: Uint8Array, width: number, height: number, strength: number, preserveDetails: number, reduceColorNoise: number, sharpenDetails: number): Promise<Uint8Array> { return _engine!.reduceNoise(pixels, width, height, strength, preserveDetails, reduceColorNoise, sharpenDetails) }
export async function renderLensFlare(width: number, height: number, centerX: number, centerY: number, brightness: number, lensType: number, ringOpacity: number, streakStrength: number, streakWidth: number, streakRotation: number): Promise<Uint8Array> { return _engine!.renderLensFlare(width, height, centerX, centerY, brightness, lensType, ringOpacity, streakStrength, streakWidth, streakRotation) }
