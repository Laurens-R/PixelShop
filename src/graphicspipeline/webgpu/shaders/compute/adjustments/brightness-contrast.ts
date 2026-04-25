import { MASK_FLAGS_STRUCT } from './helpers'

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
