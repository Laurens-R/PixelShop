// Chromatic Aberration compute shader.
//
// Supports two modes selected by CAParams.aberrationType:
//   0 = Radial   — R/B channels displaced outward/inward from image centre
//   1 = Directional — R/B channels displaced along a fixed angle
//
// In both modes the green channel is kept at the original sample position.
// R is displaced by +distance, B by -distance (in the relevant direction).

export const CHROMATIC_ABERRATION_COMPUTE = /* wgsl */ `
struct MaskFlags {
  hasMask : u32,
  _pad    : vec3u,
}

struct CAParams {
  // 0 = radial, 1 = directional
  aberrationType : u32,
  // pixel distance for red/blue channel offset (positive f32 stored as bits via bitcast)
  distanceBits   : u32,
  // angle in degrees for directional mode (f32 stored as bits)
  angleBits      : u32,
  _pad           : u32,
}

@group(0) @binding(0) var srcTex     : texture_2d<f32>;
@group(0) @binding(1) var dstTex     : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : CAParams;
@group(0) @binding(3) var selMask    : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

fn loadClamped(coord: vec2i) -> vec4f {
  let dims = vec2i(textureDimensions(srcTex));
  return textureLoad(srcTex, clamp(coord, vec2i(0), dims - vec2i(1)), 0);
}

@compute @workgroup_size(8, 8)
fn cs_chromatic_aberration(@builtin(global_invocation_id) id: vec3u) {
  let dims   = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord  = vec2i(id.xy);
  let center = vec2f(f32(dims.x), f32(dims.y)) * 0.5;

  let distance = bitcast<f32>(params.distanceBits);
  let src      = textureLoad(srcTex, coord, 0);

  var redOffset   = vec2f(0.0);
  var blueOffset  = vec2f(0.0);

  if (params.aberrationType == 0u) {
    // ── Radial: displace outward from centre ─────────────────────────────────
    let toPixel = vec2f(f32(id.x), f32(id.y)) - center;
    let dist    = length(toPixel);
    if (dist > 0.0) {
      let dir      = toPixel / dist;
      let halfDim  = length(center);
      let normDist = dist / halfDim;      // 0 at centre, 1 at corner
      let offset   = dir * normDist * distance;
      redOffset    =  offset;
      blueOffset   = -offset;
    }
  } else {
    // ── Directional: displace along a fixed angle ─────────────────────────────
    let angleDeg = bitcast<f32>(params.angleBits);
    let angleRad = angleDeg * 3.14159265358979 / 180.0;
    let dir      = vec2f(cos(angleRad), sin(angleRad));
    redOffset    =  dir * distance;
    blueOffset   = -dir * distance;
  }

  let redCoord  = coord + vec2i(i32(round(redOffset.x)),  i32(round(redOffset.y)));
  let blueCoord = coord + vec2i(i32(round(blueOffset.x)), i32(round(blueOffset.y)));

  let redSample  = loadClamped(redCoord);
  let blueSample = loadClamped(blueCoord);

  let result = vec4f(redSample.r, src.g, blueSample.b, src.a);

  if (maskFlags.hasMask != 0u) {
    let mask = textureLoad(selMask, coord, 0).r;
    textureStore(dstTex, coord, mix(src, result, mask));
  } else {
    textureStore(dstTex, coord, result);
  }
}
` as const
