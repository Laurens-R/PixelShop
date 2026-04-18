// ─── Gaussian Blur ────────────────────────────────────────────────────────────

export const FILTER_GAUSSIAN_H_COMPUTE = /* wgsl */ `
struct GaussianBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex     : texture_2d<f32>;
@group(0) @binding(1) var dstTex     : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params    : GaussianBlurParams;

@compute @workgroup_size(8, 8)
fn cs_gaussian_h(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord    = vec2i(id.xy);
  let sigma    = max(f32(params.radius), 1.0) / 3.0;
  let inv2sig2 = 1.0 / (2.0 * sigma * sigma);
  let maxR     = i32(params.radius);

  var weightSum = 0.0;
  var colorSum  = vec4f(0.0);

  for (var x = -maxR; x <= maxR; x++) {
    let w  = exp(-f32(x * x) * inv2sig2);
    let sx = clamp(coord.x + x, 0, i32(dims.x) - 1);
    colorSum  += textureLoad(srcTex, vec2i(sx, coord.y), 0) * w;
    weightSum += w;
  }

  textureStore(dstTex, coord, colorSum * (1.0 / weightSum));
}
` as const

export const FILTER_GAUSSIAN_V_COMPUTE = /* wgsl */ `
struct GaussianBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex     : texture_2d<f32>;
@group(0) @binding(1) var dstTex     : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : GaussianBlurParams;

@compute @workgroup_size(8, 8)
fn cs_gaussian_v(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord    = vec2i(id.xy);
  let sigma    = max(f32(params.radius), 1.0) / 3.0;
  let inv2sig2 = 1.0 / (2.0 * sigma * sigma);
  let maxR     = i32(params.radius);

  var weightSum = 0.0;
  var colorSum  = vec4f(0.0);

  for (var y = -maxR; y <= maxR; y++) {
    let w  = exp(-f32(y * y) * inv2sig2);
    let sy = clamp(coord.y + y, 0, i32(dims.y) - 1);
    colorSum  += textureLoad(srcTex, vec2i(coord.x, sy), 0) * w;
    weightSum += w;
  }

  let blurred = colorSum * (1.0 / weightSum);

  textureStore(dstTex, coord, blurred);
}
` as const

// ─── Box Blur ─────────────────────────────────────────────────────────────────

export const FILTER_BOX_H_COMPUTE = /* wgsl */ `
struct BoxBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex  : texture_2d<f32>;
@group(0) @binding(1) var dstTex  : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params : BoxBlurParams;

@compute @workgroup_size(8, 8)
fn cs_box_h(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord  = vec2i(id.xy);
  let maxR   = i32(params.radius);
  let weight = 1.0 / f32(2u * params.radius + 1u);

  var colorSum = vec4f(0.0);

  for (var x = -maxR; x <= maxR; x++) {
    let sx = clamp(coord.x + x, 0, i32(dims.x) - 1);
    colorSum += textureLoad(srcTex, vec2i(sx, coord.y), 0) * weight;
  }

  textureStore(dstTex, coord, colorSum);
}
` as const

export const FILTER_BOX_V_COMPUTE = /* wgsl */ `
struct BoxBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex  : texture_2d<f32>;
@group(0) @binding(1) var dstTex  : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : BoxBlurParams;

@compute @workgroup_size(8, 8)
fn cs_box_v(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord  = vec2i(id.xy);
  let maxR   = i32(params.radius);
  let weight = 1.0 / f32(2u * params.radius + 1u);

  var colorSum = vec4f(0.0);

  for (var y = -maxR; y <= maxR; y++) {
    let sy = clamp(coord.y + y, 0, i32(dims.y) - 1);
    colorSum += textureLoad(srcTex, vec2i(coord.x, sy), 0) * weight;
  }

  textureStore(dstTex, coord, colorSum);
}
` as const

// ─── Radial Blur ──────────────────────────────────────────────────────────────

export const FILTER_RADIAL_BLUR_COMPUTE = /* wgsl */ `
struct RadialBlurParams {
  mode    : u32,
  amount  : u32,
  quality : u32,
  _pad0   : u32,
  centerX : f32,
  centerY : f32,
  _pad1   : f32,
  _pad2   : f32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : RadialBlurParams;

fn sampleBilinear(coord: vec2f, dims: vec2u) -> vec4f {
  let clamped = clamp(coord, vec2f(0.0), vec2f(f32(dims.x) - 1.0, f32(dims.y) - 1.0));
  let x0 = i32(clamped.x);
  let y0 = i32(clamped.y);
  let x1 = min(x0 + 1, i32(dims.x) - 1);
  let y1 = min(y0 + 1, i32(dims.y) - 1);
  let fx = clamped.x - f32(x0);
  let fy = clamped.y - f32(y0);
  let p00 = textureLoad(srcTex, vec2i(x0, y0), 0);
  let p10 = textureLoad(srcTex, vec2i(x1, y0), 0);
  let p01 = textureLoad(srcTex, vec2i(x0, y1), 0);
  let p11 = textureLoad(srcTex, vec2i(x1, y1), 0);
  return mix(mix(p00, p10, fx), mix(p01, p11, fx), fy);
}

@compute @workgroup_size(8, 8)
fn cs_radial_blur(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let px = f32(id.x);
  let py = f32(id.y);
  let cx = params.centerX * f32(dims.x - 1u);
  let cy = params.centerY * f32(dims.y - 1u);
  let dx = px - cx;
  let dy = py - cy;

  let numSamples = select(select(8u, 16u, params.quality == 1u), 32u, params.quality == 2u);
  let invN = 1.0 / f32(numSamples - 1u);

  var colorSum = vec4f(0.0);

  if (params.mode == 0u) {
    let dist = sqrt(dx * dx + dy * dy);
    if (dist < 0.5) {
      textureStore(dstTex, vec2i(id.xy), textureLoad(srcTex, vec2i(id.xy), 0));
      return;
    }
    let spinAngle = f32(params.amount) * 3.14159265358979323846 / 1800.0;
    let baseAngle = atan2(dy, dx);
    for (var s = 0u; s < numSamples; s++) {
      let t = f32(s) * invN;
      let theta = baseAngle - spinAngle * 0.5 + t * spinAngle;
      colorSum += sampleBilinear(vec2f(cx + dist * cos(theta), cy + dist * sin(theta)), dims);
    }
  } else {
    if (abs(dx) < 0.5 && abs(dy) < 0.5) {
      textureStore(dstTex, vec2i(id.xy), textureLoad(srcTex, vec2i(id.xy), 0));
      return;
    }
    let scale = f32(params.amount) * 0.005;
    for (var s = 0u; s < numSamples; s++) {
      let t = f32(s) * invN;
      let factor = 1.0 - t * scale;
      colorSum += sampleBilinear(vec2f(cx + dx * factor, cy + dy * factor), dims);
    }
  }

  textureStore(dstTex, vec2i(id.xy), colorSum * (1.0 / f32(numSamples)));
}
` as const

// ─── Motion Blur ─────────────────────────────────────────────────────────────

export const FILTER_MOTION_BLUR_COMPUTE = /* wgsl */ `
struct MotionBlurParams {
  angleDeg : f32,
  distance : u32,
  _pad0    : u32,
  _pad1    : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : MotionBlurParams;

fn sampleBilinear(coord: vec2f, dims: vec2u) -> vec4f {
  let clamped = clamp(coord, vec2f(0.0), vec2f(f32(dims.x) - 1.0, f32(dims.y) - 1.0));
  let x0 = i32(clamped.x);
  let y0 = i32(clamped.y);
  let x1 = min(x0 + 1, i32(dims.x) - 1);
  let y1 = min(y0 + 1, i32(dims.y) - 1);
  let fx = clamped.x - f32(x0);
  let fy = clamped.y - f32(y0);
  let p00 = textureLoad(srcTex, vec2i(x0, y0), 0);
  let p10 = textureLoad(srcTex, vec2i(x1, y0), 0);
  let p01 = textureLoad(srcTex, vec2i(x0, y1), 0);
  let p11 = textureLoad(srcTex, vec2i(x1, y1), 0);
  return mix(mix(p00, p10, fx), mix(p01, p11, fx), fy);
}

@compute @workgroup_size(8, 8)
fn cs_motion_blur(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let px    = f32(id.x);
  let py    = f32(id.y);
  let angle = params.angleDeg * 3.14159265358979323846 / 180.0;
  let stepX = cos(angle);
  let stepY = sin(angle);
  let dist  = params.distance;

  var colorSum = vec4f(0.0);
  for (var i = 0u; i < dist; i++) {
    let offset = f32(i) - f32(dist - 1u) * 0.5;
    colorSum += sampleBilinear(vec2f(px + stepX * offset, py + stepY * offset), dims);
  }

  textureStore(dstTex, vec2i(id.xy), colorSum * (1.0 / f32(dist)));
}
` as const

// ─── Lens Blur ────────────────────────────────────────────────────────────────

export const FILTER_LENS_BLUR_COMPUTE = /* wgsl */ `
struct LensBlurParams {
  kernelCount : u32,
  _pad0       : u32,
  _pad1       : u32,
  _pad2       : u32,
}

struct KernelEntry {
  kx     : f32,
  ky     : f32,
  weight : f32,
  _pad   : f32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : LensBlurParams;
@group(0) @binding(3) var<storage, read> kernelEntries : array<KernelEntry>;

fn sampleBilinear(coord: vec2f, dims: vec2u) -> vec4f {
  let clamped = clamp(coord, vec2f(0.0), vec2f(f32(dims.x) - 1.0, f32(dims.y) - 1.0));
  let x0 = i32(clamped.x); let y0 = i32(clamped.y);
  let x1 = min(x0 + 1, i32(dims.x) - 1);
  let y1 = min(y0 + 1, i32(dims.y) - 1);
  let fx = clamped.x - f32(x0); let fy = clamped.y - f32(y0);
  let p00 = textureLoad(srcTex, vec2i(x0, y0), 0);
  let p10 = textureLoad(srcTex, vec2i(x1, y0), 0);
  let p01 = textureLoad(srcTex, vec2i(x0, y1), 0);
  let p11 = textureLoad(srcTex, vec2i(x1, y1), 0);
  return mix(mix(p00, p10, fx), mix(p01, p11, fx), fy);
}

@compute @workgroup_size(16, 16)
fn cs_lens_blur(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let px = f32(id.x);
  let py = f32(id.y);
  var colorSum = vec4f(0.0);

  for (var i = 0u; i < params.kernelCount; i++) {
    let e = kernelEntries[i];
    colorSum += sampleBilinear(vec2f(px + e.kx, py + e.ky), dims) * e.weight;
  }

  textureStore(dstTex, vec2i(id.xy), colorSum);
}
` as const

// ─── Sharpen ──────────────────────────────────────────────────────────────────

export const FILTER_SHARPEN_COMPUTE = /* wgsl */ `
@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;

const kernel = array<f32, 9>(
   0.0, -1.0,  0.0,
  -1.0,  5.0, -1.0,
   0.0, -1.0,  0.0,
);

@compute @workgroup_size(8, 8)
fn cs_sharpen(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  var colorSum = vec4f(0.0);
  for (var ky = -1; ky <= 1; ky++) {
    for (var kx = -1; kx <= 1; kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      let k  = kernel[(ky + 1) * 3 + (kx + 1)];
      colorSum += textureLoad(srcTex, vec2i(sx, sy), 0) * k;
    }
  }
  // preserve original alpha
  let orig = textureLoad(srcTex, vec2i(id.xy), 0);
  textureStore(dstTex, vec2i(id.xy), vec4f(clamp(colorSum.rgb, vec3f(0.0), vec3f(1.0)), orig.a));
}
`

// ─── Sharpen More ─────────────────────────────────────────────────────────────

export const FILTER_SHARPEN_MORE_COMPUTE = /* wgsl */ `
@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;

const kernel = array<f32, 9>(
  -1.0, -1.0, -1.0,
  -1.0,  9.0, -1.0,
  -1.0, -1.0, -1.0,
);

@compute @workgroup_size(8, 8)
fn cs_sharpen_more(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  var colorSum = vec4f(0.0);
  for (var ky = -1; ky <= 1; ky++) {
    for (var kx = -1; kx <= 1; kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      let k  = kernel[(ky + 1) * 3 + (kx + 1)];
      colorSum += textureLoad(srcTex, vec2i(sx, sy), 0) * k;
    }
  }
  let orig = textureLoad(srcTex, vec2i(id.xy), 0);
  textureStore(dstTex, vec2i(id.xy), vec4f(clamp(colorSum.rgb, vec3f(0.0), vec3f(1.0)), orig.a));
}
`

// ─── Unsharp Mask Combine ─────────────────────────────────────────────────────

export const FILTER_UNSHARP_COMBINE_COMPUTE = /* wgsl */ `
struct UnsharpParams {
  amount    : u32,   // 1–500 (%)
  threshold : u32,   // 0–255 (levels)
  _pad0     : u32,
  _pad1     : u32,
}

@group(0) @binding(0) var origTex    : texture_2d<f32>;
@group(0) @binding(1) var blurredTex : texture_2d<f32>;
@group(0) @binding(2) var dstTex     : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : UnsharpParams;

@compute @workgroup_size(8, 8)
fn cs_unsharp_combine(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(origTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let orig    = textureLoad(origTex,    vec2i(id.xy), 0);
  let blurred = textureLoad(blurredTex, vec2i(id.xy), 0);

  let scale = f32(params.amount) / 100.0;
  let thr   = f32(params.threshold) / 255.0;

  let dR = orig.r - blurred.r;
  let dG = orig.g - blurred.g;
  let dB = orig.b - blurred.b;

  let lumaDiff = abs(0.299 * dR + 0.587 * dG + 0.114 * dB);

  var outColor: vec4f;
  if (lumaDiff > thr) {
    outColor = vec4f(
      clamp(orig.r + scale * dR, 0.0, 1.0),
      clamp(orig.g + scale * dG, 0.0, 1.0),
      clamp(orig.b + scale * dB, 0.0, 1.0),
      orig.a,
    );
  } else {
    outColor = vec4f(orig.rgb, orig.a);
  }

  textureStore(dstTex, vec2i(id.xy), outColor);
}
`

// ─── Smart Sharpen ───────────────────────────────────────────────────────────

export const FILTER_SMART_SHARPEN_GAUSS_COMBINE_COMPUTE = /* wgsl */ `
struct SmartSharpenGaussParams {
  amount : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex     : texture_2d<f32>;
@group(0) @binding(1) var blurredTex : texture_2d<f32>;
@group(0) @binding(2) var dstTex     : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : SmartSharpenGaussParams;

@compute @workgroup_size(8, 8)
fn cs_smart_sharpen_gauss(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let orig    = textureLoad(srcTex,     vec2i(id.xy), 0);
  let blurred = textureLoad(blurredTex, vec2i(id.xy), 0);
  let scale   = f32(params.amount) / 100.0;

  let diff = orig.rgb - blurred.rgb;
  let outRGB = clamp(orig.rgb + scale * diff, vec3f(0.0), vec3f(1.0));

  textureStore(dstTex, vec2i(id.xy), vec4f(outRGB, orig.a));
}
`

export const FILTER_SMART_SHARPEN_LENS_COMPUTE = /* wgsl */ `
struct SmartSharpenLensParams {
  amount : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : SmartSharpenLensParams;

@compute @workgroup_size(8, 8)
fn cs_smart_sharpen_lens(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let s = (f32(params.amount) / 100.0) * 0.5;

  // kernel: [-s,-s,-s, -s, 1+8*s, -s, -s,-s,-s]
  var colorSum = vec3f(0.0);
  for (var ky = -1; ky <= 1; ky++) {
    for (var kx = -1; kx <= 1; kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      let samp = textureLoad(srcTex, vec2i(sx, sy), 0).rgb;
      let isCenter = select(0.0, 1.0, kx == 0 && ky == 0);
      let k = isCenter * (1.0 + 8.0 * s) + (1.0 - isCenter) * (-s);
      colorSum += samp * k;
    }
  }

  let orig = textureLoad(srcTex, vec2i(id.xy), 0);
  textureStore(dstTex, vec2i(id.xy), vec4f(clamp(colorSum, vec3f(0.0), vec3f(1.0)), orig.a));
}
`

export const FILTER_SMART_SHARPEN_BLEND_COMPUTE = /* wgsl */ `
struct SmartSharpenBlendParams {
  reduceNoise : u32,  // 0–100 (%)
  _pad0       : u32,
  _pad1       : u32,
  _pad2       : u32,
}

@group(0) @binding(0) var sharpenedTex : texture_2d<f32>;
@group(0) @binding(1) var smoothedTex  : texture_2d<f32>;
@group(0) @binding(2) var dstTex       : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : SmartSharpenBlendParams;

@compute @workgroup_size(8, 8)
fn cs_smart_sharpen_blend(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(sharpenedTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let sharpened = textureLoad(sharpenedTex, vec2i(id.xy), 0);
  let smoothed  = textureLoad(smoothedTex,  vec2i(id.xy), 0);

  let blendFactor = (f32(params.reduceNoise) / 100.0) * 0.5;
  let outRGB = clamp(
    sharpened.rgb * (1.0 - blendFactor) + smoothed.rgb * blendFactor,
    vec3f(0.0), vec3f(1.0)
  );

  textureStore(dstTex, vec2i(id.xy), vec4f(outRGB, sharpened.a));
}
`

// ─── Add Noise ────────────────────────────────────────────────────────────────

export const FILTER_ADD_NOISE_COMPUTE = /* wgsl */ `
struct AddNoiseParams {
  amount        : u32,  // 1–400 (%)
  distribution  : u32,  // 0=uniform, 1=gaussian
  monochromatic : u32,  // 0|1
  seed          : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : AddNoiseParams;

fn lcg_next(s: u32) -> u32 {
  return 1664525u * s + 1013904223u;
}

fn pcg_hash(v: u32) -> u32 {
  let word = v * 747796405u + 2891336453u;
  return ((word >> ((word >> 28u) + 4u)) ^ word) * 277803737u;
}

fn pixel_rng_seed(seed: u32, idx: u32) -> u32 {
  return pcg_hash(seed ^ pcg_hash(idx));
}

fn sample_uniform(state: ptr<function, u32>, range: u32, maxDelta: u32) -> i32 {
  *state = lcg_next(*state);
  return i32(*state % range) - i32(maxDelta);
}

fn sample_gaussian(state: ptr<function, u32>, range: u32, maxDelta: u32) -> i32 {
  var sum: i32 = 0;
  for (var k = 0u; k < 4u; k++) {
    *state = lcg_next(*state);
    sum += i32(*state % range);
  }
  return sum / 4 - i32(maxDelta);
}

@compute @workgroup_size(8, 8)
fn cs_add_noise(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let maxDelta = params.amount * 127u / 100u;
  if (maxDelta == 0u) {
    let orig = textureLoad(srcTex, vec2i(id.xy), 0);
    textureStore(dstTex, vec2i(id.xy), orig);
    return;
  }
  let range = 2u * maxDelta + 1u;
  let idx   = id.y * dims.x + id.x;
  var state = pixel_rng_seed(params.seed, idx);

  let orig = textureLoad(srcTex, vec2i(id.xy), 0);

  var dR: i32; var dG: i32; var dB: i32;

  if (params.monochromatic != 0u) {
    let d = select(
      sample_gaussian(&state, range, maxDelta),
      sample_uniform(&state, range, maxDelta),
      params.distribution == 0u
    );
    dR = d; dG = d; dB = d;
  } else {
    dR = select(sample_gaussian(&state, range, maxDelta), sample_uniform(&state, range, maxDelta), params.distribution == 0u);
    dG = select(sample_gaussian(&state, range, maxDelta), sample_uniform(&state, range, maxDelta), params.distribution == 0u);
    dB = select(sample_gaussian(&state, range, maxDelta), sample_uniform(&state, range, maxDelta), params.distribution == 0u);
  }

  let outR = clamp(orig.r + f32(dR) / 255.0, 0.0, 1.0);
  let outG = clamp(orig.g + f32(dG) / 255.0, 0.0, 1.0);
  let outB = clamp(orig.b + f32(dB) / 255.0, 0.0, 1.0);

  textureStore(dstTex, vec2i(id.xy), vec4f(outR, outG, outB, orig.a));
}
`

// ─── Film Grain ───────────────────────────────────────────────────────────────

export const FILTER_FILM_GRAIN_NOISE_COMPUTE = /* wgsl */ `
struct FilmGrainNoiseParams {
  seed  : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
}

@group(0) @binding(0) var noiseTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> params : FilmGrainNoiseParams;

fn lcg_next(s: u32) -> u32 {
  return 1664525u * s + 1013904223u;
}

fn pcg_hash(v: u32) -> u32 {
  let word = v * 747796405u + 2891336453u;
  return ((word >> ((word >> 28u) + 4u)) ^ word) * 277803737u;
}

@compute @workgroup_size(8, 8)
fn cs_film_grain_noise(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(noiseTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let idx   = id.y * dims.x + id.x;
  var state = pcg_hash(params.seed ^ pcg_hash(idx));

  var sum = 0.0;
  for (var k = 0u; k < 4u; k++) {
    state = lcg_next(state);
    sum += f32(state >> 16u) / 32767.5;
  }
  let noise    = sum / 4.0 - 1.0;                   // [-1, 1]
  let encoded  = clamp((noise + 1.0) * 0.5, 0.0, 1.0);  // [0, 1]

  textureStore(noiseTex, vec2i(id.xy), vec4f(encoded, encoded, encoded, encoded));
}
`

export const FILTER_FILM_GRAIN_COMBINE_COMPUTE = /* wgsl */ `
struct FilmGrainCombineParams {
  intensity : u32,  // 1–200 (%)
  roughness : u32,  // 0–100
  _pad0     : u32,
  _pad1     : u32,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var noiseTex : texture_2d<f32>;
@group(0) @binding(2) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : FilmGrainCombineParams;

@compute @workgroup_size(8, 8)
fn cs_film_grain_combine(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let orig       = textureLoad(srcTex,   vec2i(id.xy), 0);
  let noiseTexel = textureLoad(noiseTex, vec2i(id.xy), 0);

  let noiseVal   = noiseTexel.r * 2.0 - 1.0;    // decode [0,1] → [-1,1]
  let intensityF = f32(params.intensity) / 100.0;
  let roughnessF = f32(params.roughness) / 100.0;

  let luma   = 0.299 * orig.r + 0.587 * orig.g + 0.114 * orig.b;
  let weight = (1.0 - roughnessF) * (1.0 - luma) + roughnessF * 1.0;

  let grainVal = noiseVal * (127.0 / 255.0) * weight * intensityF;

  let outRGB = clamp(orig.rgb + grainVal, vec3f(0.0), vec3f(1.0));
  textureStore(dstTex, vec2i(id.xy), vec4f(outRGB, orig.a));
}
`

// ─── Clouds ───────────────────────────────────────────────────────────────────

export const FILTER_CLOUDS_COMPUTE = /* wgsl */ `
struct CloudsParams {
  scale     : u32,
  opacity   : u32,
  colorMode : u32,
  fgColor   : u32,
  bgColor   : u32,
  imgWidth  : u32,
  imgHeight : u32,
  _pad      : u32,
}

@group(0) @binding(0) var srcTex  : texture_2d<f32>;
@group(0) @binding(1) var dstTex  : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : CloudsParams;
@group(0) @binding(3) var<storage, read> perm : array<u32>;  // 256 entries, each is u8 value

const GX = array<f32, 8>(  1.0, -1.0,  0.0,  0.0,  0.7071, -0.7071,  0.7071, -0.7071 );
const GY = array<f32, 8>(  0.0,  0.0,  1.0, -1.0,  0.7071,  0.7071, -0.7071, -0.7071 );

fn fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn hsample(ix: i32, iy: i32) -> u32 {
  let a = perm[ix & 255];
  let b = (a + u32(iy & 255)) & 255u;
  return perm[b] & 7u;
}

fn perlin(fx: f32, fy: f32) -> f32 {
  let xi = i32(floor(fx));
  let yi = i32(floor(fy));
  let rx0 = fx - f32(xi);
  let ry0 = fy - f32(yi);
  let u = fade(rx0);
  let v = fade(ry0);

  let h00 = hsample(xi,     yi    );
  let h10 = hsample(xi + 1, yi    );
  let h01 = hsample(xi,     yi + 1);
  let h11 = hsample(xi + 1, yi + 1);

  let d00 = GX[h00] * rx0         + GY[h00] * ry0;
  let d10 = GX[h10] * (rx0 - 1.0) + GY[h10] * ry0;
  let d01 = GX[h01] * rx0         + GY[h01] * (ry0 - 1.0);
  let d11 = GX[h11] * (rx0 - 1.0) + GY[h11] * (ry0 - 1.0);

  let ab = d00 + u * (d10 - d00);
  let cd = d01 + u * (d11 - d01);
  return ab + v * (cd - ab);
}

@compute @workgroup_size(8, 8)
fn cs_clouds(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let featureSize = max(f32(params.scale) / 100.0 * f32(min(params.imgWidth, params.imgHeight)), 1.0);
  let baseFreq    = 256.0 / featureSize;

  var total  = 0.0;
  var maxAmp = 0.0;
  var freq   = baseFreq;
  var amp    = 1.0;
  for (var oct = 0; oct < 6; oct++) {
    total  += perlin(f32(id.x) * freq, f32(id.y) * freq) * amp;
    maxAmp += amp;
    amp    *= 0.5;
    freq   *= 2.0;
  }

  let t = clamp(total / maxAmp * 1.4 + 0.5, 0.0, 1.0);

  var cloudR: f32; var cloudG: f32; var cloudB: f32;
  if (params.colorMode == 0u) {
    cloudR = t; cloudG = t; cloudB = t;
  } else {
    let fgR = f32((params.fgColor)        & 0xFFu) / 255.0;
    let fgG = f32((params.fgColor >>  8u) & 0xFFu) / 255.0;
    let fgB = f32((params.fgColor >> 16u) & 0xFFu) / 255.0;
    let bgR = f32((params.bgColor)        & 0xFFu) / 255.0;
    let bgG = f32((params.bgColor >>  8u) & 0xFFu) / 255.0;
    let bgB = f32((params.bgColor >> 16u) & 0xFFu) / 255.0;
    cloudR = bgR + (fgR - bgR) * t;
    cloudG = bgG + (fgG - bgG) * t;
    cloudB = bgB + (fgB - bgB) * t;
  }

  let orig     = textureLoad(srcTex, vec2i(id.xy), 0);
  let opacityF = f32(params.opacity) / 100.0;

  let outR = clamp(orig.r + (cloudR - orig.r) * opacityF, 0.0, 1.0);
  let outG = clamp(orig.g + (cloudG - orig.g) * opacityF, 0.0, 1.0);
  let outB = clamp(orig.b + (cloudB - orig.b) * opacityF, 0.0, 1.0);

  textureStore(dstTex, vec2i(id.xy), vec4f(outR, outG, outB, orig.a));
}
`
