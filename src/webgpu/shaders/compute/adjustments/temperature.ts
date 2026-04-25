import { MASK_FLAGS_STRUCT } from './helpers'

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
