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
