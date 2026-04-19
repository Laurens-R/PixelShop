import { MASK_FLAGS_STRUCT } from './helpers'

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
