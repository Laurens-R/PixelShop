export const BLOOM_EXTRACT_COMPUTE = /* wgsl */ `
struct MaskFlags {
  hasMask : u32,
  _pad    : vec3u,
}

struct BloomExtractParams {
  threshold : f32,
  _pad0     : f32,
  _pad1     : f32,
  _pad2     : f32,
}

@group(0) @binding(0) var srcTex     : texture_2d<f32>;
@group(0) @binding(1) var dstTex     : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : BloomExtractParams;
@group(0) @binding(3) var selMask    : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_bloom_extract(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);

  let lum = dot(src.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let t   = params.threshold;
  let k   = 0.1;
  let w   = smoothstep(t - k, t + k, lum);
  let glow = vec4f(src.rgb * w, src.a * w);

  var out = glow;
  if (maskFlags.hasMask != 0u) {
    let mask = textureLoad(selMask, coord, 0).r;
    out = glow * mask;
  }
  textureStore(dstTex, coord, out);
}
` as const

export const BLOOM_DOWNSAMPLE_COMPUTE = /* wgsl */ `
struct BloomDownsampleParams {
  scale : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
}

@group(0) @binding(0) var srcTex  : texture_2d<f32>;
@group(0) @binding(1) var dstTex  : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : BloomDownsampleParams;

@compute @workgroup_size(8, 8)
fn cs_bloom_downsample(@builtin(global_invocation_id) id: vec3u) {
  let dstDims = textureDimensions(dstTex);
  if (id.x >= dstDims.x || id.y >= dstDims.y) { return; }

  let srcDims = textureDimensions(srcTex);
  let scale = params.scale;
  var acc = vec4f(0.0);
  let count = f32(scale * scale);

  for (var dy: u32 = 0u; dy < scale; dy++) {
    for (var dx: u32 = 0u; dx < scale; dx++) {
      let sx = min(id.x * scale + dx, srcDims.x - 1u);
      let sy = min(id.y * scale + dy, srcDims.y - 1u);
      acc += textureLoad(srcTex, vec2i(i32(sx), i32(sy)), 0);
    }
  }
  textureStore(dstTex, vec2i(id.xy), acc / count);
}
` as const

export const BLOOM_BLUR_H_COMPUTE = /* wgsl */ `
struct BloomBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex  : texture_2d<f32>;
@group(0) @binding(1) var dstTex  : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : BloomBlurParams;

@compute @workgroup_size(8, 8)
fn cs_bloom_blur_h(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let r = i32(params.radius);
  var acc = vec4f(0.0);
  let count = f32(2 * r + 1);
  let y = i32(id.y);

  for (var dx: i32 = -r; dx <= r; dx++) {
    let sx = clamp(i32(id.x) + dx, 0, i32(dims.x) - 1);
    acc += textureLoad(srcTex, vec2i(sx, y), 0);
  }
  textureStore(dstTex, vec2i(id.xy), acc / count);
}
` as const

export const BLOOM_BLUR_V_COMPUTE = /* wgsl */ `
struct BloomBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex  : texture_2d<f32>;
@group(0) @binding(1) var dstTex  : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : BloomBlurParams;

@compute @workgroup_size(8, 8)
fn cs_bloom_blur_v(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let r = i32(params.radius);
  var acc = vec4f(0.0);
  let count = f32(2 * r + 1);
  let x = i32(id.x);

  for (var dy: i32 = -r; dy <= r; dy++) {
    let sy = clamp(i32(id.y) + dy, 0, i32(dims.y) - 1);
    acc += textureLoad(srcTex, vec2i(x, sy), 0);
  }
  textureStore(dstTex, vec2i(id.xy), acc / count);
}
` as const

export const BLOOM_COMPOSITE_COMPUTE = /* wgsl */ `
struct MaskFlags {
  hasMask : u32,
  _pad    : vec3u,
}

struct BloomCompositeParams {
  strength : f32,
  _pad0    : f32,
  _pad1    : f32,
  _pad2    : f32,
}

@group(0) @binding(0) var srcTex       : texture_2d<f32>;
@group(0) @binding(1) var glowTex      : texture_2d<f32>;
@group(0) @binding(2) var dstTex       : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params    : BloomCompositeParams;
@group(0) @binding(4) var selMask      : texture_2d<f32>;
@group(0) @binding(5) var<uniform> maskFlags : MaskFlags;

// textureSample is illegal in compute shaders — implement bilinear manually.
fn sampleBilinear(tex: texture_2d<f32>, uv: vec2f) -> vec4f {
  let sz  = vec2f(textureDimensions(tex));
  let p   = uv * sz - 0.5;
  let p0  = vec2i(floor(p));
  let fr  = fract(p);
  let d   = vec2i(textureDimensions(tex)) - vec2i(1, 1);
  let c00 = textureLoad(tex, clamp(p0,                  vec2i(0), d), 0);
  let c10 = textureLoad(tex, clamp(vec2i(p0.x+1, p0.y), vec2i(0), d), 0);
  let c01 = textureLoad(tex, clamp(vec2i(p0.x, p0.y+1), vec2i(0), d), 0);
  let c11 = textureLoad(tex, clamp(p0 + vec2i(1, 1),    vec2i(0), d), 0);
  return mix(mix(c00, c10, fr.x), mix(c01, c11, fr.x), fr.y);
}

@compute @workgroup_size(8, 8)
fn cs_bloom_composite(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let uv    = (vec2f(f32(id.x), f32(id.y)) + 0.5) / vec2f(f32(dims.x), f32(dims.y));

  let src  = textureLoad(srcTex, coord, 0);
  let glow = sampleBilinear(glowTex, uv);
  let g    = clamp(glow.rgb * params.strength, vec3f(0.0), vec3f(1.0));
  let out  = vec4f(1.0 - (1.0 - src.rgb) * (1.0 - g), src.a);

  if (maskFlags.hasMask != 0u) {
    let mask = textureLoad(selMask, coord, 0).r;
    textureStore(dstTex, coord, mix(src, out, mask));
  } else {
    textureStore(dstTex, coord, out);
  }
}
` as const
