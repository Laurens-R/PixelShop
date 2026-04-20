import { MASK_FLAGS_STRUCT } from './helpers'

export const CK_COMPUTE = /* wgsl */ `
${MASK_FLAGS_STRUCT}

// ── RGB → HSV conversion (H in 0..1) ────────────────────────────────────────
fn rgb2hsv(c: vec3f) -> vec3f {
  let maxC  = max(c.r, max(c.g, c.b));
  let minC  = min(c.r, min(c.g, c.b));
  let delta = maxC - minC;
  let v = maxC;
  var s = 0.0f;
  var h = 0.0f;
  if (delta > 0.00001) {
    s = delta / maxC;
    if (maxC == c.r) {
      h = (c.g - c.b) / delta;
      h = h - floor(h / 6.0) * 6.0;
      h = h / 6.0;
    } else if (maxC == c.g) {
      h = ((c.b - c.r) / delta + 2.0) / 6.0;
    } else {
      h = ((c.r - c.g) / delta + 4.0) / 6.0;
    }
  }
  return vec3f(h, s, v);
}

// ── Uniform struct (32 bytes) ─────────────────────────────────────────────────
struct CKParams {
  keyColor  : vec3f,   // sRGB 0..1 key color  (bytes  0–11)
  tolerance : f32,     // 0..100               (byte  12)
  softness  : f32,     // 0..100               (byte  16)
  // tail-padded to 32 bytes by WGSL (next multiple of vec3f's 16-byte alignment)
}

@group(0) @binding(0) var srcTex    : texture_2d<f32>;
@group(0) @binding(1) var dstTex    : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : CKParams;
@group(0) @binding(3) var selMask   : texture_2d<f32>;
@group(0) @binding(4) var<uniform> maskFlags : MaskFlags;

@compute @workgroup_size(8, 8)
fn cs_color_key(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord = vec2i(id.xy);
  let src = textureLoad(srcTex, coord, 0);

  // Already transparent — nothing to key; preserve as-is.
  if (src.a < 0.0001) { textureStore(dstTex, coord, src); return; }

  let pHsv = rgb2hsv(src.rgb);
  let kHsv = rgb2hsv(params.keyColor);

  let dH_raw = abs(pHsv.x - kHsv.x);
  let dH     = min(dH_raw, 1.0 - dH_raw) * 2.0;
  let dS     = abs(pHsv.y - kHsv.y);
  let dV     = abs(pHsv.z - kHsv.z);
  let satW   = min(pHsv.y, kHsv.y);
  let dist   = ((dH * satW) + dS + dV) / 3.0 * 100.0;

  let tol  = params.tolerance;
  let soft = params.softness;
  var alpha = src.a;
  if (dist <= tol) {
    alpha = 0.0;
  } else if (soft > 0.0001 && dist < tol + soft) {
    alpha = src.a * (dist - tol) / soft;
  }

  let adjusted = vec4f(src.rgb, alpha);
  var mask = 1.0f;
  if (maskFlags.hasMask != 0u) { mask = textureLoad(selMask, coord, 0).r; }
  textureStore(dstTex, coord, mix(src, adjusted, mask));
}
` as const
