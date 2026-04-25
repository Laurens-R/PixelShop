import { MASK_FLAGS_STRUCT } from './helpers'

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
