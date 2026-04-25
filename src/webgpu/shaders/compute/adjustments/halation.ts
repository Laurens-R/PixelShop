// Halation extract compute shader.
//
// Simulates film halation: bright highlights scatter light back through the
// film emulsion, creating a warm (red-orange) glow around highlights.
//
// This pass extracts highlight pixels (luminance above threshold) and applies
// a warm reddish-orange tint. The result is subsequently blurred by the shared
// bloom H/V blur pipelines, then composited via the bloom composite pipeline.

export const HALATION_EXTRACT_COMPUTE = /* wgsl */ `
struct MaskFlags {
  hasMask : u32,
  _pad    : vec3u,
}

struct HalationExtractParams {
  threshold : f32,
  _pad0     : f32,
  _pad1     : f32,
  _pad2     : f32,
}

@group(0) @binding(0) var srcTex              : texture_2d<f32>;
@group(0) @binding(1) var dstTex              : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params     : HalationExtractParams;
@group(0) @binding(3) var selMask             : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags  : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_halation_extract(@builtin(global_invocation_id) id: vec3u) {
  let dims  = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src   = textureLoad(srcTex, coord, 0);

  // Luminance-based highlight extraction with soft knee
  let lum = dot(src.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let t   = params.threshold;
  let k   = 0.1;
  let w   = smoothstep(t - k, t + k, lum);

  // Classic film halation tint: deep warm red-orange from red-layer back-scatter
  let tint = vec3f(1.0, 0.22, 0.05);
  let glow  = vec4f(src.rgb * tint * w, src.a * w);

  var out = glow;
  if (maskFlags.hasMask != 0u) {
    let mask = textureLoad(selMask, coord, 0).r;
    out = glow * mask;
  }
  textureStore(dstTex, coord, out);
}
` as const
