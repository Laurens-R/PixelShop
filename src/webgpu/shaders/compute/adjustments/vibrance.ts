import { MASK_FLAGS_STRUCT, HSL_HELPERS } from './helpers'

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
