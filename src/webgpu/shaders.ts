// ─── Render shaders ───────────────────────────────────────────────────────────

// Layer compositing pipeline (vertex + fragment in one module)
export const COMPOSITE_SHADER = /* wgsl */ `
struct CompositeUniforms {
  opacity   : f32,
  blendMode : u32,
  dstRect   : vec4f,
  hasMask   : u32,
  _pad      : vec3u,
}

struct VertexOutput {
  @builtin(position) pos : vec4f,
  @location(0)       uv  : vec2f,
}

@group(0) @binding(0) var imageSampler : sampler;
@group(0) @binding(1) var layerTex    : texture_2d<f32>;
@group(0) @binding(2) var dstTex      : texture_2d<f32>;
@group(0) @binding(3) var maskTex     : texture_2d<f32>;
@group(0) @binding(4) var<uniform> u  : CompositeUniforms;
@group(0) @binding(5) var<uniform> res : vec4f;  // xy=resolution, zw=unused

@vertex
fn vs_composite(@location(0) position: vec2f, @location(1) uv: vec2f) -> VertexOutput {
  var out: VertexOutput;
  out.pos = vec4f(
    position.x / res.x * 2.0 - 1.0,
    1.0 - position.y / res.y * 2.0,
    0.0, 1.0
  );
  out.uv = uv;
  return out;
}

fn blendNormal  (s: vec3f, d: vec3f) -> vec3f { return s; }
fn blendMultiply(s: vec3f, d: vec3f) -> vec3f { return s * d; }
fn blendScreen  (s: vec3f, d: vec3f) -> vec3f { return s + d - s * d; }
fn blendOverlay (s: vec3f, d: vec3f) -> vec3f {
  return mix(2.0*s*d, 1.0 - 2.0*(1.0-s)*(1.0-d), step(vec3f(0.5), d));
}
fn blendSoftLight(s: vec3f, d: vec3f) -> vec3f {
  let q = mix(sqrt(d), d, step(vec3f(0.5), s));
  return mix(d - (1.0-2.0*s)*d*(1.0-d), d + (2.0*s-1.0)*(q-d), step(vec3f(0.5), s));
}
fn blendHardLight(s: vec3f, d: vec3f) -> vec3f {
  return mix(2.0*s*d, 1.0 - 2.0*(1.0-s)*(1.0-d), step(vec3f(0.5), s));
}
fn blendDarken  (s: vec3f, d: vec3f) -> vec3f { return min(s, d); }
fn blendLighten (s: vec3f, d: vec3f) -> vec3f { return max(s, d); }
fn blendDiff    (s: vec3f, d: vec3f) -> vec3f { return abs(d - s); }
fn blendExcl    (s: vec3f, d: vec3f) -> vec3f { return s + d - 2.0*s*d; }
fn blendDodge   (s: vec3f, d: vec3f) -> vec3f { return min(d / max(1.0-s, vec3f(0.0001)), vec3f(1.0)); }
fn blendBurn    (s: vec3f, d: vec3f) -> vec3f { return 1.0 - min((1.0-d) / max(s, vec3f(0.0001)), vec3f(1.0)); }

@fragment
fn fs_composite(in: VertexOutput) -> @location(0) vec4f {
  var src = textureSample(layerTex, imageSampler, in.uv);
  src.a *= u.opacity;
  let dstUV = u.dstRect.xy + in.uv * u.dstRect.zw;
  if (u.hasMask != 0u) {
    let maskVal = textureSample(maskTex, imageSampler, dstUV).r;
    src.a *= maskVal;
  }
  let dst = textureSample(dstTex, imageSampler, dstUV);
  if (src.a < 0.0001) { return dst; }

  let s = src.rgb;
  var d = dst.rgb;
  if (dst.a > 0.0001) { d = d / dst.a; }

  var blended: vec3f;
  switch (u.blendMode) {
    case 1u:  { blended = blendMultiply(s, d); }
    case 2u:  { blended = blendScreen(s, d); }
    case 3u:  { blended = blendOverlay(s, d); }
    case 4u:  { blended = blendSoftLight(s, d); }
    case 5u:  { blended = blendHardLight(s, d); }
    case 6u:  { blended = blendDarken(s, d); }
    case 7u:  { blended = blendLighten(s, d); }
    case 8u:  { blended = blendDiff(s, d); }
    case 9u:  { blended = blendExcl(s, d); }
    case 10u: { blended = blendDodge(s, d); }
    case 11u: { blended = blendBurn(s, d); }
    default:  { blended = blendNormal(s, d); }
  }

  let outA   = src.a + dst.a * (1.0 - src.a);
  let outRGB = (blended * src.a + d * dst.a * (1.0 - src.a)) / max(outA, 0.0001);
  return vec4f(outRGB, outA);
}
` as const

// Checkerboard background
export const CHECKER_SHADER = /* wgsl */ `
struct CheckerUniforms {
  tileSize   : f32,
  colorA     : vec3f,
  _pad0      : f32,
  colorB     : vec3f,
  _pad1      : f32,
  resolution : vec2f,
  _pad2      : vec2f,
}

struct VertexOutput {
  @builtin(position) pos : vec4f,
  @location(0)       uv  : vec2f,
}

@group(0) @binding(0) var<uniform> u : CheckerUniforms;

@vertex
fn vs_checker(@location(0) position: vec2f, @location(1) uv: vec2f) -> VertexOutput {
  var out: VertexOutput;
  out.pos = vec4f(
    position.x / u.resolution.x * 2.0 - 1.0,
    1.0 - position.y / u.resolution.y * 2.0,
    0.0, 1.0
  );
  out.uv = uv;
  return out;
}

@fragment
fn fs_checker(in: VertexOutput) -> @location(0) vec4f {
  let pos = floor(in.pos.xy / u.tileSize);
  let pattern = (u32(pos.x) + u32(pos.y)) % 2u;
  let col = select(u.colorA, u.colorB, pattern == 1u);
  return vec4f(col, 1.0);
}
` as const

// Blit shader (both screen and fbo-to-fbo — single Y convention in WebGPU)
export const BLIT_SHADER = /* wgsl */ `
struct BlitRes {
  resolution : vec2f,
  _pad       : vec2f,
}

struct VertexOutput {
  @builtin(position) pos : vec4f,
  @location(0)       uv  : vec2f,
}

@group(0) @binding(0) var blitSampler : sampler;
@group(0) @binding(1) var srcTex      : texture_2d<f32>;
@group(0) @binding(2) var<uniform> u  : BlitRes;

@vertex
fn vs_blit(@location(0) position: vec2f, @location(1) uv: vec2f) -> VertexOutput {
  var out: VertexOutput;
  out.pos = vec4f(
    position.x / u.resolution.x * 2.0 - 1.0,
    1.0 - position.y / u.resolution.y * 2.0,
    0.0, 1.0
  );
  out.uv = uv;
  return out;
}

@fragment
fn fs_blit(in: VertexOutput) -> @location(0) vec4f {
  return textureSample(srcTex, blitSampler, in.uv);
}
` as const

// FBO-to-FBO blit — same shader as BLIT_SHADER (same Y convention in WebGPU)
export const FBO_BLIT_SHADER = BLIT_SHADER

// ─── Compute shaders ──────────────────────────────────────────────────────────

// Common preamble used in every compute shader (maskFlags struct + MaskFlags uniform)
const MASK_FLAGS_STRUCT = /* wgsl */ `
struct MaskFlags {
  hasMask : u32,
  _pad    : vec3u,
}
`

export const BC_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}

struct BCParams {
  brightness : f32,
  contrast   : f32,
  _pad       : vec2f,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : BCParams;
@group(0) @binding(3) var selMask  : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_brightness_contrast(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  var rgb = src.rgb;
  let b = params.brightness / 100.0;
  rgb = clamp(rgb + b, vec3f(0.0), vec3f(1.0));
  let cFactor = (params.contrast + 100.0) / 100.0;
  rgb = clamp((rgb - 0.5) * cFactor + 0.5, vec3f(0.0), vec3f(1.0));

  let adjusted = vec4f(rgb, src.a);
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, adjusted, mask));
}
` as const

const HSL_HELPERS = /* wgsl */ `
fn rgb2hsl(c: vec3f) -> vec3f {
  let maxC  = max(c.r, max(c.g, c.b));
  let minC  = min(c.r, min(c.g, c.b));
  let delta = maxC - minC;
  let L = (maxC + minC) * 0.5;
  var S = 0.0f;
  var H = 0.0f;
  if (delta > 0.00001) {
    S = delta / (1.0 - abs(2.0 * L - 1.0));
    if (maxC == c.r) {
      H = (c.g - c.b) / delta;
      H = H - floor(H / 6.0) * 6.0;
      H = H / 6.0;
    } else if (maxC == c.g) {
      H = ((c.b - c.r) / delta + 2.0) / 6.0;
    } else {
      H = ((c.r - c.g) / delta + 4.0) / 6.0;
    }
  }
  return vec3f(H, S, L);
}

fn hsl2rgb(hsl: vec3f) -> vec3f {
  let H = hsl.x; let S = hsl.y; let L = hsl.z;
  let C = (1.0 - abs(2.0 * L - 1.0)) * S;
  let h6 = H * 6.0;
  let X = C * (1.0 - abs(h6 - floor(h6 / 2.0) * 2.0 - 1.0));
  let m = L - C * 0.5;
  var rgb: vec3f;
  if      (h6 < 1.0) { rgb = vec3f(C, X, 0.0); }
  else if (h6 < 2.0) { rgb = vec3f(X, C, 0.0); }
  else if (h6 < 3.0) { rgb = vec3f(0.0, C, X); }
  else if (h6 < 4.0) { rgb = vec3f(0.0, X, C); }
  else if (h6 < 5.0) { rgb = vec3f(X, 0.0, C); }
  else               { rgb = vec3f(C, 0.0, X); }
  return clamp(rgb + m, vec3f(0.0), vec3f(1.0));
}
`

export const HS_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}
${HSL_HELPERS}

struct HSParams {
  hue        : f32,
  saturation : f32,
  lightness  : f32,
  _pad       : f32,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : HSParams;
@group(0) @binding(3) var selMask  : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_hue_saturation(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  var hsl = rgb2hsl(src.rgb);
  hsl.x = hsl.x + params.hue / 360.0;
  hsl.x = hsl.x - floor(hsl.x);
  hsl.y = clamp(hsl.y + params.saturation / 100.0, 0.0, 1.0);
  hsl.z = clamp(hsl.z + params.lightness  / 100.0, 0.0, 1.0);

  let adjusted = vec4f(hsl2rgb(hsl), src.a);
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, adjusted, mask));
}
` as const

export const VIB_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}
${HSL_HELPERS}

struct VibParams {
  vibrance   : f32,
  saturation : f32,
  _pad       : vec2f,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : VibParams;
@group(0) @binding(3) var selMask  : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_color_vibrance(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  var hsl = rgb2hsl(src.rgb);
  let vib = params.vibrance / 100.0;
  let hasSat = select(0.0f, 1.0f, hsl.y > 0.0001f);
  let w = (1.0 - hsl.y) * abs(vib) * hasSat;
  hsl.y = clamp(hsl.y + w * sign(vib), 0.0, 1.0);
  hsl.y = clamp(hsl.y + params.saturation / 100.0, 0.0, 1.0);

  let adjusted = vec4f(hsl2rgb(hsl), src.a);
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, adjusted, mask));
}
` as const

export const CB_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}

struct CBParams {
  sha_cr : f32,
  sha_mg : f32,
  sha_yb : f32,
  mid_cr : f32,
  mid_mg : f32,
  mid_yb : f32,
  hil_cr : f32,
  hil_mg : f32,
  hil_yb : f32,
  preserveLuminosity : u32,
  _pad   : vec2u,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : CBParams;
@group(0) @binding(3) var selMask  : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_color_balance(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  let rgb = src.rgb;
  let lum = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
  let shadowMask    = 1.0 - lum;
  let highlightMask = lum;
  let midtoneMask   = 1.0 - abs(lum * 2.0 - 1.0);

  let rShift = (params.sha_cr * shadowMask + params.mid_cr * midtoneMask + params.hil_cr * highlightMask) / 100.0;
  let gShift = (params.sha_mg * shadowMask + params.mid_mg * midtoneMask + params.hil_mg * highlightMask) / 100.0;
  let bShift = (params.sha_yb * shadowMask + params.mid_yb * midtoneMask + params.hil_yb * highlightMask) / 100.0;

  var adjusted = clamp(rgb + vec3f(rShift, gShift, bShift), vec3f(0.0), vec3f(1.0));

  if (params.preserveLuminosity != 0u) {
    let newLum = dot(adjusted, vec3f(0.2126, 0.7152, 0.0722));
    if (newLum > 0.0001) {
      adjusted = clamp(adjusted * (lum / newLum), vec3f(0.0), vec3f(1.0));
    }
  }

  let result = vec4f(adjusted, src.a);
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, result, mask));
}
` as const

const HUE_DIST = /* wgsl */ `
fn hueDist(h: f32, center: f32) -> f32 {
  let d = abs(h - center);
  return min(d, 1.0 - d);
}
`

export const BW_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}
${HSL_HELPERS}
${HUE_DIST}

struct BWParams {
  reds     : f32,
  yellows  : f32,
  greens   : f32,
  cyans    : f32,
  blues    : f32,
  magentas : f32,
  _pad     : vec2f,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : BWParams;
@group(0) @binding(3) var selMask  : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_black_and_white(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  let hsl = rgb2hsl(src.rgb);
  let H = hsl.x; let S = hsl.y; let L = hsl.z;

  let wR = max(0.0, 1.0 - 6.0 * hueDist(H, 0.0 / 6.0));
  let wY = max(0.0, 1.0 - 6.0 * hueDist(H, 1.0 / 6.0));
  let wG = max(0.0, 1.0 - 6.0 * hueDist(H, 2.0 / 6.0));
  let wC = max(0.0, 1.0 - 6.0 * hueDist(H, 3.0 / 6.0));
  let wB = max(0.0, 1.0 - 6.0 * hueDist(H, 4.0 / 6.0));
  let wM = max(0.0, 1.0 - 6.0 * hueDist(H, 5.0 / 6.0));

  let uniformSlider = (params.reds + params.yellows + params.greens + params.cyans + params.blues + params.magentas) / 6.0;
  let hueBased      = wR * params.reds + wY * params.yellows + wG * params.greens
                    + wC * params.cyans + wB * params.blues  + wM * params.magentas;
  let satBlend      = clamp(S * 10.0, 0.0, 1.0);
  let weightedSlider = mix(uniformSlider, hueBased, satBlend);
  let gray = clamp(2.0 * L * weightedSlider / 100.0, 0.0, 1.0);

  let adjusted = vec4f(gray, gray, gray, src.a);
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, adjusted, mask));
}
` as const

export const TEMP_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}

struct TempParams {
  temperature : f32,
  tint        : f32,
  _pad        : vec2f,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : TempParams;
@group(0) @binding(3) var selMask  : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_color_temperature(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  let t = params.temperature / 100.0;
  let n = params.tint         / 100.0;
  let dR =  t * 0.2 + n * 0.1;
  let dG = -n * 0.2;
  let dB = -t * 0.2 + n * 0.1;

  let adjusted = clamp(src.rgb + vec3f(dR, dG, dB), vec3f(0.0), vec3f(1.0));
  let result = vec4f(adjusted, src.a);
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, result, mask));
}
` as const

export const INVERT_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var selMask  : texture_2d<f32>;
@group(0) @binding(3) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_color_invert(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  let adjusted = vec4f(1.0 - src.rgb, src.a);
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, adjusted, mask));
}
` as const

export const SEL_COLOR_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}
${HSL_HELPERS}
${HUE_DIST}

struct SelectiveColorParams {
  cyan     : array<vec4f, 3>,   // 9 f32s packed as 3 × vec4f (last elem of [2] is padding)
  magenta  : array<vec4f, 3>,
  yellow   : array<vec4f, 3>,
  black    : array<vec4f, 3>,
  relative : u32,
}

fn scGetF32(arr: array<vec4f, 3>, i: u32) -> f32 {
  let vi = i / 4u;
  let ci = i % 4u;
  if (ci == 0u) { return arr[vi].x; }
  if (ci == 1u) { return arr[vi].y; }
  if (ci == 2u) { return arr[vi].z; }
  return arr[vi].w;
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : SelectiveColorParams;
@group(0) @binding(3) var selMask  : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_selective_color(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  let rgb = src.rgb;
  let hsl = rgb2hsl(rgb);
  let H = hsl.x; let S = hsl.y; let L = hsl.z;

  let maxRGB = max(rgb.r, max(rgb.g, rgb.b));
  let K = 1.0 - maxRGB;
  var C = 0.0f; var M = 0.0f; var Y = 0.0f;
  if (K < 0.9999) {
    let denom = 1.0 - K;
    C = (1.0 - rgb.r - K) / denom;
    M = (1.0 - rgb.g - K) / denom;
    Y = (1.0 - rgb.b - K) / denom;
  }

  let satBlend = clamp(S * 10.0, 0.0, 1.0);

  var wR = max(0.0, 1.0 - 6.0 * hueDist(H, 0.0 / 6.0));
  var wY = max(0.0, 1.0 - 6.0 * hueDist(H, 1.0 / 6.0));
  var wG = max(0.0, 1.0 - 6.0 * hueDist(H, 2.0 / 6.0));
  var wC_h = max(0.0, 1.0 - 6.0 * hueDist(H, 3.0 / 6.0));
  var wB = max(0.0, 1.0 - 6.0 * hueDist(H, 4.0 / 6.0));
  var wM = max(0.0, 1.0 - 6.0 * hueDist(H, 5.0 / 6.0));

  let UNIFORM_W = 1.0 / 6.0;
  wR   = mix(UNIFORM_W, wR,   satBlend);
  wY   = mix(UNIFORM_W, wY,   satBlend);
  wG   = mix(UNIFORM_W, wG,   satBlend);
  wC_h = mix(UNIFORM_W, wC_h, satBlend);
  wB   = mix(UNIFORM_W, wB,   satBlend);
  wM   = mix(UNIFORM_W, wM,   satBlend);

  let wWhite   = clamp((L - 0.8) * 5.0, 0.0, 1.0);
  let wBlack   = clamp((0.2 - L) * 5.0, 0.0, 1.0);
  let wNeutral = clamp(1.0 - satBlend, 0.0, 1.0);

  var weights = array<f32, 9>(wR, wY, wG, wC_h, wB, wM, wWhite, wNeutral, wBlack);

  var dC = 0.0f; var dM_d = 0.0f; var dY_d = 0.0f; var dK_d = 0.0f;
  for (var i = 0u; i < 9u; i++) {
    let w = weights[i];
    if (params.relative != 0u) {
      dC   += w * (scGetF32(params.cyan,    i) / 100.0) * C;
      dM_d += w * (scGetF32(params.magenta, i) / 100.0) * M;
      dY_d += w * (scGetF32(params.yellow,  i) / 100.0) * Y;
      dK_d += w * (scGetF32(params.black,   i) / 100.0) * K;
    } else {
      dC   += w * (scGetF32(params.cyan,    i) / 100.0);
      dM_d += w * (scGetF32(params.magenta, i) / 100.0);
      dY_d += w * (scGetF32(params.yellow,  i) / 100.0);
      dK_d += w * (scGetF32(params.black,   i) / 100.0);
    }
  }

  let C2 = clamp(C + dC,   0.0, 1.0);
  let M2 = clamp(M + dM_d, 0.0, 1.0);
  let Y2 = clamp(Y + dY_d, 0.0, 1.0);
  let K2 = clamp(K + dK_d, 0.0, 1.0);

  let kComp = 1.0 - K2;
  let adjusted = vec4f((1.0-C2)*kComp, (1.0-M2)*kComp, (1.0-Y2)*kComp, src.a);
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, adjusted, mask));
}
` as const

export const CURVES_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}

@group(0) @binding(0) var srcTex    : texture_2d<f32>;
@group(0) @binding(1) var dstTex    : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var selMask   : texture_2d<f32>;
@group(0) @binding(3) var<uniform> maskFlags  : MaskFlags;
@group(0) @binding(4) var lutSampler : sampler;
@group(0) @binding(5) var rgbLut    : texture_2d<f32>;
@group(0) @binding(6) var redLut    : texture_2d<f32>;
@group(0) @binding(7) var greenLut  : texture_2d<f32>;
@group(0) @binding(8) var blueLut   : texture_2d<f32>;

fn sampleLut(lut: texture_2d<f32>, channelValue: f32) -> f32 {
  return textureSampleLevel(lut, lutSampler, vec2f(clamp(channelValue, 0.0, 1.0), 0.5), 0.0).r;
}

@compute @workgroup_size(8, 8)
fn cs_curves(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  let rgb1 = vec3f(
    sampleLut(rgbLut, src.r),
    sampleLut(rgbLut, src.g),
    sampleLut(rgbLut, src.b),
  );
  let adjusted = vec4f(
    sampleLut(redLut,   rgb1.r),
    sampleLut(greenLut, rgb1.g),
    sampleLut(blueLut,  rgb1.b),
    src.a,
  );
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, adjusted, mask));
}
` as const

export const CG_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}
${HSL_HELPERS}

struct CGParams {
  lift       : vec4f,
  gamma      : vec4f,
  gain       : vec4f,
  offset     : vec4f,
  temp       : f32,
  tint       : f32,
  contrast   : f32,
  pivot      : f32,
  midDetail  : f32,
  colorBoost : f32,
  shadows    : f32,
  highlights : f32,
  saturation : f32,
  hue        : f32,
  lumMix     : f32,
  _pad       : f32,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : CGParams;
@group(0) @binding(3) var selMask  : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_color_grading(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  var rgb = src.rgb;
  let origLum = dot(src.rgb, vec3f(0.2126, 0.7152, 0.0722));

  // Stage 1: Temp / Tint
  rgb.r += ((params.temp - 6500.0) / 5500.0) * 0.1;
  rgb.g -= (params.tint / 100.0) * 0.05;
  rgb.b -= ((params.temp - 6500.0) / 5500.0) * 0.1;
  rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));

  // Stage 2: Wheels
  let wShadow    = 1.0 - origLum;
  let wMid       = 4.0 * origLum * (1.0 - origLum);
  let wHighlight = origLum;

  let liftRGB  = vec3f(params.lift.x  + params.lift.w,  params.lift.y  + params.lift.w,  params.lift.z  + params.lift.w);
  let gammaRGB = vec3f(params.gamma.x + params.gamma.w, params.gamma.y + params.gamma.w, params.gamma.z + params.gamma.w);
  let gainRGB  = vec3f(params.gain.x  + params.gain.w,  params.gain.y  + params.gain.w,  params.gain.z  + params.gain.w);
  let offRGB   = vec3f(params.offset.x + params.offset.w, params.offset.y + params.offset.w, params.offset.z + params.offset.w);

  rgb += liftRGB  * wShadow;
  rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
  rgb += gammaRGB * wMid;
  rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
  rgb += gainRGB  * wHighlight;
  rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
  rgb += offRGB;
  rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));

  // Stage 3: Contrast (luma-based to preserve hue/saturation)
  // Apply contrast as a luminance scale around the pivot point, then ratio-scale
  // RGB channels to match — prevents per-channel clipping from shifting hue.
  let lumC = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
  let lumCNew = clamp((lumC - params.pivot) * params.contrast + params.pivot, 0.0, 1.0);
  if (lumC > 0.0001) { rgb = clamp(rgb * (lumCNew / lumC), vec3f(0.0), vec3f(1.0)); }

  // Stage 4: Mid/Detail (luma-based to preserve hue)
  let lum1     = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
  let wMid1    = 4.0 * lum1 * (1.0 - lum1);
  let lum1New  = clamp(lum1 + (params.midDetail / 100.0) * (lum1 - 0.5) * wMid1, 0.0, 1.0);
  if (lum1 > 0.0001) { rgb = clamp(rgb * (lum1New / lum1), vec3f(0.0), vec3f(1.0)); }
  else { rgb = vec3f(lum1New); }

  // Stage 5: Shadows / Highlights (luma-based to preserve hue)
  // Compute target luminance from the additive delta, then ratio-scale RGB channels
  // to reach it — prevents per-channel clipping from shifting hue into pure primaries.
  let lum2    = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
  let wSh     = 1.0 - smoothstep(0.0, 0.5, lum2);
  let wHl     = smoothstep(0.5, 1.0, lum2);
  let lum2New = clamp(lum2 + (params.shadows / 100.0) * 0.5 * wSh + (params.highlights / 100.0) * 0.5 * wHl, 0.0, 1.0);
  if (lum2 > 0.0001) { rgb = clamp(rgb * (lum2New / lum2), vec3f(0.0), vec3f(1.0)); }
  else { rgb = vec3f(lum2New); }

  // Stage 6-7: Saturation + Hue
  var hsl = rgb2hsl(rgb);
  hsl.y = clamp(hsl.y * (params.saturation / 50.0), 0.0, 1.0);
  let hueShift = (params.hue - 50.0) * 3.6 / 360.0;
  hsl.x = hsl.x + hueShift;
  hsl.x = hsl.x - floor(hsl.x);
  rgb = hsl2rgb(hsl);

  // Stage 8: Color Boost (vibrance)
  var hsl2 = rgb2hsl(rgb);
  let boost = (params.colorBoost / 100.0) * (1.0 - hsl2.y);
  hsl2.y = clamp(hsl2.y + boost, 0.0, 1.0);
  rgb = hsl2rgb(hsl2);

  // Stage 9: Lum Mix
  let corrLum     = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
  var lumPreserved = rgb;
  if (corrLum > 0.0001) { lumPreserved = rgb * (origLum / corrLum); }
  rgb = clamp(mix(rgb, lumPreserved, params.lumMix / 100.0), vec3f(0.0), vec3f(1.0));

  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, vec4f(mix(src.rgb, rgb, mask), src.a));
}
` as const
