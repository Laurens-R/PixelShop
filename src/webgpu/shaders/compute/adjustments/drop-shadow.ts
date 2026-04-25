export const DROP_SHADOW_DILATE_H_COMPUTE = /* wgsl */ `
struct ShadowDilateParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : ShadowDilateParams;

@compute @workgroup_size(8, 8)
fn cs_shadow_dilate_h(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let r = i32(params.radius);
  var maxA = 0.0;
  for (var dx: i32 = -r; dx <= r; dx++) {
    let sx = clamp(i32(id.x) + dx, 0, i32(dims.x) - 1);
    maxA = max(maxA, textureLoad(srcTex, vec2i(sx, i32(id.y)), 0).a);
  }
  textureStore(dstTex, vec2i(id.xy), vec4f(maxA, 0.0, 0.0, 1.0));
}
` as const

export const DROP_SHADOW_DILATE_V_COMPUTE = /* wgsl */ `
struct ShadowDilateParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : ShadowDilateParams;

@compute @workgroup_size(8, 8)
fn cs_shadow_dilate_v(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let r = i32(params.radius);
  var maxA = 0.0;
  for (var dy: i32 = -r; dy <= r; dy++) {
    let sy = clamp(i32(id.y) + dy, 0, i32(dims.y) - 1);
    maxA = max(maxA, textureLoad(srcTex, vec2i(i32(id.x), sy), 0).r);
  }
  textureStore(dstTex, vec2i(id.xy), vec4f(maxA, 0.0, 0.0, 1.0));
}
` as const

export const DROP_SHADOW_BLUR_H_COMPUTE = /* wgsl */ `
struct ShadowBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : ShadowBlurParams;

@compute @workgroup_size(8, 8)
fn cs_shadow_blur_h(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let r = i32(params.radius);
  let count = f32(2 * r + 1);
  var acc = 0.0;
  for (var dx: i32 = -r; dx <= r; dx++) {
    let sx = clamp(i32(id.x) + dx, 0, i32(dims.x) - 1);
    acc += textureLoad(srcTex, vec2i(sx, i32(id.y)), 0).r;
  }
  textureStore(dstTex, vec2i(id.xy), vec4f(acc / count, 0.0, 0.0, 1.0));
}
` as const

export const DROP_SHADOW_BLUR_V_COMPUTE = /* wgsl */ `
struct ShadowBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : ShadowBlurParams;

@compute @workgroup_size(8, 8)
fn cs_shadow_blur_v(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let r = i32(params.radius);
  let count = f32(2 * r + 1);
  var acc = 0.0;
  for (var dy: i32 = -r; dy <= r; dy++) {
    let sy = clamp(i32(id.y) + dy, 0, i32(dims.y) - 1);
    acc += textureLoad(srcTex, vec2i(i32(id.x), sy), 0).r;
  }
  textureStore(dstTex, vec2i(id.xy), vec4f(acc / count, 0.0, 0.0, 1.0));
}
` as const

export const DROP_SHADOW_COMPOSITE_COMPUTE = /* wgsl */ `
struct ShadowCompositeParams {
  colorR    : f32,  // offset  0
  colorG    : f32,  // offset  4
  colorB    : f32,  // offset  8
  colorA    : f32,  // offset 12
  opacity   : f32,  // offset 16
  offsetX   : i32,  // offset 20
  offsetY   : i32,  // offset 24
  blendMode : u32,  // offset 28  (0=Normal, 1=Multiply, 2=Screen)
  knockout  : u32,  // offset 32
  _pad0     : u32,  // offset 36
  _pad1     : u32,  // offset 40
  _pad2     : u32,  // offset 44
}

struct MaskFlags {
  hasMask : u32,
  _pad    : vec3u,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var maskTex  : texture_2d<f32>;
@group(0) @binding(2) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params    : ShadowCompositeParams;
@group(0) @binding(4) var selMask  : texture_2d<f32>;
@group(0) @binding(5) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_shadow_composite(@builtin(global_invocation_id) id: vec3u) {
  let dims  = vec2i(textureDimensions(srcTex));
  if (id.x >= u32(dims.x) || id.y >= u32(dims.y)) { return; }
  let coord = vec2i(id.xy);
  let src   = textureLoad(srcTex, coord, 0);

  // Locate the corresponding shadow mask pixel (undo the shadow offset)
  let maskCoord = coord - vec2i(params.offsetX, params.offsetY);
  var rawMask = 0.0;
  if (all(maskCoord >= vec2i(0)) && all(maskCoord < dims)) {
    rawMask = textureLoad(maskTex, maskCoord, 0).r;
  }

  // Combine mask alpha with color alpha and opacity
  var shadowA = rawMask * params.colorA * params.opacity;

  // Knockout: occlude shadow where the source is opaque
  if (params.knockout != 0u) {
    shadowA = shadowA * (1.0 - src.a);
  }

  let shadowRGB = vec3f(params.colorR, params.colorG, params.colorB);

  // Apply blend mode
  var blendedRGB = shadowRGB;
  if (params.blendMode == 1u) {         // Multiply
    let lum = dot(shadowRGB, vec3f(0.2126, 0.7152, 0.0722));
    blendedRGB = shadowRGB * (0.5 + 0.5 * lum);
  } else if (params.blendMode == 2u) {  // Screen
    blendedRGB = 1.0 - (1.0 - shadowRGB) * (1.0 - shadowRGB);
  }

  // Porter-Duff: src OVER shadow (shadow is beneath source pixels)
  let outA   = src.a + shadowA * (1.0 - src.a);
  var outRGB = src.rgb * src.a + blendedRGB * shadowA * (1.0 - src.a);
  if (outA > 0.0001) { outRGB /= outA; }
  var out = vec4f(outRGB, outA);

  // Apply selection mask (blend between original and composited output)
  if (maskFlags.hasMask != 0u) {
    let selA = textureLoad(selMask, coord, 0).r;
    out = mix(src, out, selA);
  }

  textureStore(dstTex, coord, out);
}
` as const
