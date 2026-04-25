export const OUTLINE_DILATE_H_COMPUTE = /* wgsl */ `
struct OutlineMorphParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : OutlineMorphParams;

@compute @workgroup_size(8, 8)
fn cs_outline_dilate_h(@builtin(global_invocation_id) id: vec3u) {
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

export const OUTLINE_DILATE_V_COMPUTE = /* wgsl */ `
struct OutlineMorphParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : OutlineMorphParams;

@compute @workgroup_size(8, 8)
fn cs_outline_dilate_v(@builtin(global_invocation_id) id: vec3u) {
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

export const OUTLINE_ERODE_H_COMPUTE = /* wgsl */ `
struct OutlineMorphParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : OutlineMorphParams;

@compute @workgroup_size(8, 8)
fn cs_outline_erode_h(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let r = i32(params.radius);
  var minA = 1.0;
  for (var dx: i32 = -r; dx <= r; dx++) {
    let sx = clamp(i32(id.x) + dx, 0, i32(dims.x) - 1);
    minA = min(minA, textureLoad(srcTex, vec2i(sx, i32(id.y)), 0).a);
  }
  textureStore(dstTex, vec2i(id.xy), vec4f(minA, 0.0, 0.0, 1.0));
}
` as const

export const OUTLINE_ERODE_V_COMPUTE = /* wgsl */ `
struct OutlineMorphParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : OutlineMorphParams;

@compute @workgroup_size(8, 8)
fn cs_outline_erode_v(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let r = i32(params.radius);
  var minA = 1.0;
  for (var dy: i32 = -r; dy <= r; dy++) {
    let sy = clamp(i32(id.y) + dy, 0, i32(dims.y) - 1);
    minA = min(minA, textureLoad(srcTex, vec2i(i32(id.x), sy), 0).r);
  }
  textureStore(dstTex, vec2i(id.xy), vec4f(minA, 0.0, 0.0, 1.0));
}
` as const

export const OUTLINE_MASK_COMPUTE = /* wgsl */ `
struct OutlineMaskParams {
  mode  : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
}

@group(0) @binding(0) var srcTex    : texture_2d<f32>;
@group(0) @binding(1) var morphATex : texture_2d<f32>;
@group(0) @binding(2) var morphBTex : texture_2d<f32>;
@group(0) @binding(3) var dstTex    : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> params : OutlineMaskParams;

@compute @workgroup_size(8, 8)
fn cs_outline_mask(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);

  let src_alpha = textureLoad(srcTex,    coord, 0).a;
  let morph_a   = textureLoad(morphATex, coord, 0).r;
  let morph_b   = textureLoad(morphBTex, coord, 0).r;

  var mask: f32;
  if (params.mode == 0u) {
    mask = max(0.0, morph_a - src_alpha);
  } else if (params.mode == 1u) {
    mask = max(0.0, src_alpha - morph_b);
  } else {
    mask = max(0.0, morph_a - morph_b);
  }
  textureStore(dstTex, coord, vec4f(mask, 0.0, 0.0, 1.0));
}
` as const

export const OUTLINE_BLUR_H_COMPUTE = /* wgsl */ `
struct OutlineBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : OutlineBlurParams;

@compute @workgroup_size(8, 8)
fn cs_outline_blur_h(@builtin(global_invocation_id) id: vec3u) {
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

export const OUTLINE_BLUR_V_COMPUTE = /* wgsl */ `
struct OutlineBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : OutlineBlurParams;

@compute @workgroup_size(8, 8)
fn cs_outline_blur_v(@builtin(global_invocation_id) id: vec3u) {
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

export const OUTLINE_COMPOSITE_COMPUTE = /* wgsl */ `
struct OutlineCompositeParams {
  colorR  : f32,   // offset  0
  colorG  : f32,   // offset  4
  colorB  : f32,   // offset  8
  colorA  : f32,   // offset 12
  opacity : f32,   // offset 16
  _pad0   : u32,   // offset 20
  _pad1   : u32,   // offset 24
  _pad2   : u32,   // offset 28
}

struct MaskFlags {
  hasMask : u32,
  _pad    : vec3u,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var maskTex  : texture_2d<f32>;
@group(0) @binding(2) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params    : OutlineCompositeParams;
@group(0) @binding(4) var selMask  : texture_2d<f32>;
@group(0) @binding(5) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_outline_composite(@builtin(global_invocation_id) id: vec3u) {
  let dims = vec2i(textureDimensions(srcTex));
  if (id.x >= u32(dims.x) || id.y >= u32(dims.y)) { return; }
  let coord = vec2i(id.xy);

  let src     = textureLoad(srcTex,  coord, 0);
  let rawMask = textureLoad(maskTex, coord, 0).r;

  let strokeA   = rawMask * params.colorA * params.opacity;
  let strokeRGB = vec3f(params.colorR, params.colorG, params.colorB);

  // Porter-Duff: src OVER stroke (stroke is behind source pixels)
  let outA   = src.a + strokeA * (1.0 - src.a);
  var outRGB = src.rgb * src.a + strokeRGB * strokeA * (1.0 - src.a);
  if (outA > 0.0001) { outRGB /= outA; }
  var out = vec4f(outRGB, outA);

  if (maskFlags.hasMask != 0u) {
    let selA = textureLoad(selMask, coord, 0).r;
    out = mix(src, out, selA);
  }

  textureStore(dstTex, coord, out);
}
` as const
