import { MASK_FLAGS_STRUCT, HSL_HELPERS } from './helpers'

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
