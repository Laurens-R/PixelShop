// ─── Vertex shader – image layer compositing (renders to FBO, no Y-flip) ──────

export const IMAGE_VERT = /* glsl */ `#version 300 es
  in vec2 a_position;
  in vec2 a_texCoord;

  uniform vec2 u_resolution;
  uniform mat3 u_transform;

  out vec2 v_texCoord;

  void main() {
    vec3 transformed = u_transform * vec3(a_position, 1.0);
    vec2 clipSpace = ((transformed.xy / u_resolution) * 2.0) - 1.0;
    // No Y-flip: FBO textures share the same V orientation as layer textures
    gl_Position = vec4(clipSpace, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
` as const

// ─── Fragment shader – image layer rendering with blend modes ─────────────────
// Composites src layer over dst (the existing framebuffer content read via u_dst).
// Blend is done in shader so we can support non-separable blend modes.

export const IMAGE_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_image;   // current layer (src)
  uniform sampler2D u_dst;     // composited result so far (dst), full-canvas UV
  uniform float u_opacity;
  uniform int u_blendMode;
  // 0=normal 1=multiply 2=screen 3=overlay 4=soft-light 5=hard-light
  // 6=darken 7=lighten 8=difference 9=exclusion 10=color-dodge 11=color-burn

  // Layer's rect in canvas UV space: (offsetX/W, offsetY/H, layerW/W, layerH/H)
  // Used to remap layer-local v_texCoord → canvas UV for sampling u_dst.
  uniform vec4 u_dstRect;

  // Optional layer mask (full-canvas sized). R channel = grayscale mask alpha.
  uniform sampler2D u_maskTex;
  uniform bool u_hasMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  vec3 blendNormal   (vec3 s, vec3 d) { return s; }
  vec3 blendMultiply (vec3 s, vec3 d) { return s * d; }
  vec3 blendScreen   (vec3 s, vec3 d) { return s + d - s * d; }
  vec3 blendOverlay  (vec3 s, vec3 d) {
    return mix(2.0*s*d, 1.0 - 2.0*(1.0-s)*(1.0-d), step(0.5, d));
  }
  vec3 blendSoftLight(vec3 s, vec3 d) {
    vec3 q = mix(sqrt(d), d, step(0.5, s));
    return mix(d - (1.0-2.0*s)*d*(1.0-d), d + (2.0*s-1.0)*(q-d), step(0.5, s));
  }
  vec3 blendHardLight(vec3 s, vec3 d) {
    return mix(2.0*s*d, 1.0 - 2.0*(1.0-s)*(1.0-d), step(0.5, s));
  }
  vec3 blendDarken   (vec3 s, vec3 d) { return min(s, d); }
  vec3 blendLighten  (vec3 s, vec3 d) { return max(s, d); }
  vec3 blendDiff     (vec3 s, vec3 d) { return abs(d - s); }
  vec3 blendExcl     (vec3 s, vec3 d) { return s + d - 2.0*s*d; }
  vec3 blendDodge    (vec3 s, vec3 d) { return min(d / max(1.0-s, 0.0001), 1.0); }
  vec3 blendBurn     (vec3 s, vec3 d) { return 1.0 - min((1.0-d) / max(s, 0.0001), 1.0); }

  void main() {
    vec4 src = texture(u_image, v_texCoord);
    src.a *= u_opacity;
    // Remap layer-local UV to canvas UV for mask and dst sampling
    vec2 dstUV = u_dstRect.xy + v_texCoord * u_dstRect.zw;
    // Apply layer mask: R channel = grayscale mask alpha (0=hide, 1=show)
    if (u_hasMask) {
      float maskVal = texture(u_maskTex, dstUV).r;
      src.a *= maskVal;
    }
    if (src.a < 0.0001) { fragColor = texture(u_dst, dstUV); return; }

    vec4 dst = texture(u_dst, dstUV);

    vec3 s = src.rgb;
    vec3 d = dst.rgb;

    // un-premultiply dst if needed
    if (dst.a > 0.0001) d /= dst.a;

    vec3 blended;
    if      (u_blendMode == 1)  blended = blendMultiply(s, d);
    else if (u_blendMode == 2)  blended = blendScreen(s, d);
    else if (u_blendMode == 3)  blended = blendOverlay(s, d);
    else if (u_blendMode == 4)  blended = blendSoftLight(s, d);
    else if (u_blendMode == 5)  blended = blendHardLight(s, d);
    else if (u_blendMode == 6)  blended = blendDarken(s, d);
    else if (u_blendMode == 7)  blended = blendLighten(s, d);
    else if (u_blendMode == 8)  blended = blendDiff(s, d);
    else if (u_blendMode == 9)  blended = blendExcl(s, d);
    else if (u_blendMode == 10) blended = blendDodge(s, d);
    else if (u_blendMode == 11) blended = blendBurn(s, d);
    else                        blended = blendNormal(s, d);

    // Porter-Duff src-over with blended rgb
    float outA = src.a + dst.a * (1.0 - src.a);
    vec3  outRGB = (blended * src.a + d * dst.a * (1.0 - src.a)) / max(outA, 0.0001);

    fragColor = vec4(outRGB, outA);
  }
` as const

// ─── Vertex shader – checkerboard background ──────────────────────────────────

export const CHECKER_VERT = /* glsl */ `#version 300 es
  in vec2 a_position;

  uniform vec2 u_resolution;

  void main() {
    vec2 clipSpace = ((a_position / u_resolution) * 2.0) - 1.0;
    gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
  }
` as const

// ─── Fragment shader – checkerboard background ────────────────────────────────

export const CHECKER_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform float u_tileSize;
  uniform vec3 u_colorA;
  uniform vec3 u_colorB;

  out vec4 fragColor;

  void main() {
    vec2 pos = floor(gl_FragCoord.xy / u_tileSize);
    float pattern = mod(pos.x + pos.y, 2.0);
    fragColor = vec4(mix(u_colorA, u_colorB, pattern), 1.0);
  }
` as const

// ─── Vertex / Fragment shader – blit a texture to the screen ──────────────────

export const BLIT_VERT = /* glsl */ `#version 300 es
  in vec2 a_position;
  in vec2 a_texCoord;
  uniform vec2 u_resolution;
  out vec2 v_texCoord;
  void main() {
    vec2 clipSpace = ((a_position / u_resolution) * 2.0) - 1.0;
    gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
` as const

// ─── Vertex shader – blit a texture to an FBO (no Y-flip) ─────────────────────

export const FBO_BLIT_VERT = /* glsl */ `#version 300 es
  in vec2 a_position;
  in vec2 a_texCoord;
  uniform vec2 u_resolution;
  out vec2 v_texCoord;
  void main() {
    vec2 clipSpace = ((a_position / u_resolution) * 2.0) - 1.0;
    gl_Position = vec4(clipSpace, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
` as const

export const BLIT_FRAG = /* glsl */ `#version 300 es
  precision mediump float;
  uniform sampler2D u_tex;
  in vec2 v_texCoord;
  out vec4 fragColor;
  void main() {
    fragColor = texture(u_tex, v_texCoord);
  }
` as const

// ─── Vertex / Fragment shader – brightness/contrast post-process pass ──────────

export const BC_VERT = /* glsl */ `#version 300 es
  in vec2 a_position;
  uniform vec2 u_resolution;
  out vec2 v_texCoord;
  void main() {
    v_texCoord = a_position / u_resolution;
    gl_Position = vec4(a_position / u_resolution * 2.0 - 1.0, 0.0, 1.0);
  }
` as const

export const BC_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;
  uniform float u_brightness;
  uniform float u_contrast;
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  void main() {
    vec4 src = texture(u_src, v_texCoord);

    if (src.a < 0.0001) { fragColor = src; return; }

    vec3 rgb = src.rgb;

    float b = u_brightness / 100.0;
    rgb = clamp(rgb + b, 0.0, 1.0);

    float cFactor = (u_contrast + 100.0) / 100.0;
    rgb = clamp((rgb - 0.5) * cFactor + 0.5, 0.0, 1.0);

    vec4 adjusted = vec4(rgb, src.a);

    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor = mix(src, adjusted, mask);
  }
` as const

// ─── Vertex / Fragment shader – hue/saturation post-process pass ───────────────

export const HS_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;
  uniform float u_hue;
  uniform float u_saturation;
  uniform float u_lightness;
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  vec3 rgb2hsl(vec3 c) {
    float maxC  = max(c.r, max(c.g, c.b));
    float minC  = min(c.r, min(c.g, c.b));
    float delta = maxC - minC;
    float L = (maxC + minC) * 0.5;
    float S = 0.0;
    float H = 0.0;
    if (delta > 0.00001) {
      S = delta / (1.0 - abs(2.0 * L - 1.0));
      if (maxC == c.r)      H = mod((c.g - c.b) / delta, 6.0) / 6.0;
      else if (maxC == c.g) H = ((c.b - c.r) / delta + 2.0)   / 6.0;
      else                  H = ((c.r - c.g) / delta + 4.0)   / 6.0;
    }
    return vec3(H, S, L);
  }

  vec3 hsl2rgb(vec3 hsl) {
    float H = hsl.x, S = hsl.y, L = hsl.z;
    float C = (1.0 - abs(2.0 * L - 1.0)) * S;
    float X = C * (1.0 - abs(mod(H * 6.0, 2.0) - 1.0));
    float m = L - C * 0.5;
    vec3 rgb;
    float h6 = H * 6.0;
    if      (h6 < 1.0) rgb = vec3(C, X, 0.0);
    else if (h6 < 2.0) rgb = vec3(X, C, 0.0);
    else if (h6 < 3.0) rgb = vec3(0.0, C, X);
    else if (h6 < 4.0) rgb = vec3(0.0, X, C);
    else if (h6 < 5.0) rgb = vec3(X, 0.0, C);
    else               rgb = vec3(C, 0.0, X);
    return clamp(rgb + m, 0.0, 1.0);
  }

  void main() {
    vec4 src = texture(u_src, v_texCoord);

    if (src.a < 0.0001) { fragColor = src; return; }

    vec3 hsl = rgb2hsl(src.rgb);

    hsl.x = fract(hsl.x + u_hue / 360.0);
    hsl.y = clamp(hsl.y + u_saturation / 100.0, 0.0, 1.0);
    hsl.z = clamp(hsl.z + u_lightness  / 100.0, 0.0, 1.0);

    vec3 adjustedRGB = hsl2rgb(hsl);
    vec4 adjusted = vec4(adjustedRGB, src.a);

    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor = mix(src, adjusted, mask);
  }
` as const

// ─── Fragment shader – color vibrance post-process pass ───────────────────────

export const VIB_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;
  uniform float u_vibrance;
  uniform float u_saturation;
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  vec3 rgb2hsl(vec3 c) {
    float maxC  = max(c.r, max(c.g, c.b));
    float minC  = min(c.r, min(c.g, c.b));
    float delta = maxC - minC;
    float L = (maxC + minC) * 0.5;
    float S = 0.0;
    float H = 0.0;
    if (delta > 0.00001) {
      S = delta / (1.0 - abs(2.0 * L - 1.0));
      if (maxC == c.r)      H = mod((c.g - c.b) / delta, 6.0) / 6.0;
      else if (maxC == c.g) H = ((c.b - c.r) / delta + 2.0)   / 6.0;
      else                  H = ((c.r - c.g) / delta + 4.0)   / 6.0;
    }
    return vec3(H, S, L);
  }

  vec3 hsl2rgb(vec3 hsl) {
    float H = hsl.x, S = hsl.y, L = hsl.z;
    float C = (1.0 - abs(2.0 * L - 1.0)) * S;
    float X = C * (1.0 - abs(mod(H * 6.0, 2.0) - 1.0));
    float m = L - C * 0.5;
    vec3 rgb;
    float h6 = H * 6.0;
    if      (h6 < 1.0) rgb = vec3(C, X, 0.0);
    else if (h6 < 2.0) rgb = vec3(X, C, 0.0);
    else if (h6 < 3.0) rgb = vec3(0.0, C, X);
    else if (h6 < 4.0) rgb = vec3(0.0, X, C);
    else if (h6 < 5.0) rgb = vec3(X, 0.0, C);
    else               rgb = vec3(C, 0.0, X);
    return clamp(rgb + m, 0.0, 1.0);
  }

  void main() {
    vec4 src = texture(u_src, v_texCoord);

    if (src.a < 0.0001) { fragColor = src; return; }

    vec3 hsl = rgb2hsl(src.rgb);

    float vib = u_vibrance / 100.0;
    float w   = (1.0 - hsl.y) * abs(vib) * step(0.0001, hsl.y);
    hsl.y = clamp(hsl.y + w * sign(vib), 0.0, 1.0);

    hsl.y = clamp(hsl.y + u_saturation / 100.0, 0.0, 1.0);

    vec4 adjusted = vec4(hsl2rgb(hsl), src.a);

    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor = mix(src, adjusted, mask);
  }
` as const

// ─── Fragment shader – color balance post-process pass ────────────────────────

export const CB_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;

  // Shadows tonal range (lum bias toward dark pixels)
  uniform float u_sha_cr;   // Cyan↔Red:      −100 … +100
  uniform float u_sha_mg;   // Magenta↔Green: −100 … +100
  uniform float u_sha_yb;   // Yellow↔Blue:   −100 … +100

  // Midtones tonal range (lum bias toward mid-gray pixels)
  uniform float u_mid_cr;
  uniform float u_mid_mg;
  uniform float u_mid_yb;

  // Highlights tonal range (lum bias toward bright pixels)
  uniform float u_hil_cr;
  uniform float u_hil_mg;
  uniform float u_hil_yb;

  uniform bool u_preserveLuminosity;
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  void main() {
    vec4 src = texture(u_src, v_texCoord);
    if (src.a < 0.0001) { fragColor = src; return; }

    vec3 rgb = src.rgb;

    // ── Step 1: luminance-based tonal masks ──────────────────────────────
    float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

    float shadowMask    = 1.0 - lum;
    float highlightMask = lum;
    float midtoneMask   = 1.0 - abs(lum * 2.0 - 1.0);

    // ── Step 2: weighted per-channel shifts ──────────────────────────────
    float rShift = (u_sha_cr * shadowMask + u_mid_cr * midtoneMask + u_hil_cr * highlightMask) / 100.0;
    float gShift = (u_sha_mg * shadowMask + u_mid_mg * midtoneMask + u_hil_mg * highlightMask) / 100.0;
    float bShift = (u_sha_yb * shadowMask + u_mid_yb * midtoneMask + u_hil_yb * highlightMask) / 100.0;

    vec3 adjusted = clamp(rgb + vec3(rShift, gShift, bShift), 0.0, 1.0);

    // ── Step 3: preserve luminosity ──────────────────────────────────────
    if (u_preserveLuminosity) {
      float newLum = dot(adjusted, vec3(0.2126, 0.7152, 0.0722));
      if (newLum > 0.0001) {
        adjusted = clamp(adjusted * (lum / newLum), 0.0, 1.0);
      }
    }

    // ── Step 4: selection mask blend ─────────────────────────────────────
    vec4 result = vec4(adjusted, src.a);
    float mask  = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor   = mix(src, result, mask);
  }
` as const

// ─── Fragment shader – black and white post-process pass ─────────────────────

export const BW_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;
  uniform float u_reds;
  uniform float u_yellows;
  uniform float u_greens;
  uniform float u_cyans;
  uniform float u_blues;
  uniform float u_magentas;
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  // ── RGB → HSL (identical to HS_FRAG / VIB_FRAG) ──────────────────────
  vec3 rgb2hsl(vec3 c) {
    float maxC  = max(c.r, max(c.g, c.b));
    float minC  = min(c.r, min(c.g, c.b));
    float delta = maxC - minC;
    float L = (maxC + minC) * 0.5;
    float S = 0.0;
    float H = 0.0;
    if (delta > 0.00001) {
      S = delta / (1.0 - abs(2.0 * L - 1.0));
      if (maxC == c.r)      H = mod((c.g - c.b) / delta, 6.0) / 6.0;
      else if (maxC == c.g) H = ((c.b - c.r) / delta + 2.0)   / 6.0;
      else                  H = ((c.r - c.g) / delta + 4.0)   / 6.0;
    }
    return vec3(H, S, L);
  }

  // ── Hue circular distance ────────────────────────────────────────────
  float hueDist(float h, float center) {
    float d = abs(h - center);
    return min(d, 1.0 - d);
  }

  void main() {
    vec4 src = texture(u_src, v_texCoord);
    if (src.a < 0.0001) { fragColor = src; return; }

    vec3 hsl = rgb2hsl(src.rgb);
    float H = hsl.x;
    float S = hsl.y;
    float L = hsl.z;

    float wR = max(0.0, 1.0 - 6.0 * hueDist(H, 0.0 / 6.0));
    float wY = max(0.0, 1.0 - 6.0 * hueDist(H, 1.0 / 6.0));
    float wG = max(0.0, 1.0 - 6.0 * hueDist(H, 2.0 / 6.0));
    float wC = max(0.0, 1.0 - 6.0 * hueDist(H, 3.0 / 6.0));
    float wB = max(0.0, 1.0 - 6.0 * hueDist(H, 4.0 / 6.0));
    float wM = max(0.0, 1.0 - 6.0 * hueDist(H, 5.0 / 6.0));

    float uniformSlider = (u_reds + u_yellows + u_greens + u_cyans + u_blues + u_magentas) / 6.0;
    float hueBased      = wR * u_reds + wY * u_yellows + wG * u_greens
                        + wC * u_cyans + wB * u_blues  + wM * u_magentas;
    float satBlend      = clamp(S * 10.0, 0.0, 1.0);
    float weightedSlider = mix(uniformSlider, hueBased, satBlend);

    float gray = clamp(2.0 * L * weightedSlider / 100.0, 0.0, 1.0);

    vec4 adjusted = vec4(gray, gray, gray, src.a);

    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor   = mix(src, adjusted, mask);
  }
` as const

// ─── Fragment shader – color temperature post-process pass ────────────────────

export const TEMP_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;
  uniform float u_temperature;
  uniform float u_tint;
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  void main() {
    vec4 src = texture(u_src, v_texCoord);

    if (src.a < 0.0001) { fragColor = src; return; }

    float t = u_temperature / 100.0;
    float n = u_tint         / 100.0;

    float dR = t * 0.2 + n * 0.1;
    float dG = -n * 0.2;
    float dB = -t * 0.2 + n * 0.1;

    vec3 adjusted = clamp(src.rgb + vec3(dR, dG, dB), 0.0, 1.0);
    vec4 result   = vec4(adjusted, src.a);

    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor   = mix(src, result, mask);
  }
` as const

// ─── Fragment shader – color invert post-process pass ─────────────────────────

export const INVERT_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;
  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  void main() {
    vec4 src = texture(u_src, v_texCoord);

    if (src.a < 0.0001) { fragColor = src; return; }

    vec4 adjusted = vec4(1.0 - src.rgb, src.a);

    float mask = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor   = mix(src, adjusted, mask);
  }
` as const

// ─── Fragment shader – selective color post-process pass ──────────────────────

export const SEL_COLOR_FRAG = /* glsl */ `#version 300 es
  precision mediump float;

  uniform sampler2D u_src;

  uniform float u_cyan[9];
  uniform float u_magenta[9];
  uniform float u_yellow[9];
  uniform float u_black[9];

  uniform bool u_relative;

  uniform sampler2D u_selMask;
  uniform bool u_hasSelMask;

  in vec2 v_texCoord;
  out vec4 fragColor;

  vec3 rgb2hsl(vec3 c) {
    float maxC  = max(c.r, max(c.g, c.b));
    float minC  = min(c.r, min(c.g, c.b));
    float delta = maxC - minC;
    float L = (maxC + minC) * 0.5;
    float S = 0.0;
    float H = 0.0;
    if (delta > 0.00001) {
      S = delta / (1.0 - abs(2.0 * L - 1.0));
      if (maxC == c.r)      H = mod((c.g - c.b) / delta, 6.0) / 6.0;
      else if (maxC == c.g) H = ((c.b - c.r) / delta + 2.0)   / 6.0;
      else                  H = ((c.r - c.g) / delta + 4.0)   / 6.0;
    }
    return vec3(H, S, L);
  }

  float hueDist(float h, float center) {
    float d = abs(h - center);
    return min(d, 1.0 - d);
  }

  void main() {
    vec4 src = texture(u_src, v_texCoord);
    if (src.a < 0.0001) { fragColor = src; return; }

    vec3 rgb = src.rgb;

    vec3 hsl = rgb2hsl(rgb);
    float H = hsl.x;
    float S = hsl.y;
    float L = hsl.z;

    float maxRGB = max(rgb.r, max(rgb.g, rgb.b));
    float K = 1.0 - maxRGB;
    float C = 0.0, M = 0.0, Y = 0.0;
    if (K < 0.9999) {
      float denom = 1.0 - K;
      C = (1.0 - rgb.r - K) / denom;
      M = (1.0 - rgb.g - K) / denom;
      Y = (1.0 - rgb.b - K) / denom;
    }

    float satBlend = clamp(S * 10.0, 0.0, 1.0);

    float wR = max(0.0, 1.0 - 6.0 * hueDist(H, 0.0 / 6.0));
    float wY = max(0.0, 1.0 - 6.0 * hueDist(H, 1.0 / 6.0));
    float wG = max(0.0, 1.0 - 6.0 * hueDist(H, 2.0 / 6.0));
    float wC = max(0.0, 1.0 - 6.0 * hueDist(H, 3.0 / 6.0));
    float wB = max(0.0, 1.0 - 6.0 * hueDist(H, 4.0 / 6.0));
    float wM = max(0.0, 1.0 - 6.0 * hueDist(H, 5.0 / 6.0));

    const float UNIFORM_W = 1.0 / 6.0;
    wR = mix(UNIFORM_W, wR, satBlend);
    wY = mix(UNIFORM_W, wY, satBlend);
    wG = mix(UNIFORM_W, wG, satBlend);
    wC = mix(UNIFORM_W, wC, satBlend);
    wB = mix(UNIFORM_W, wB, satBlend);
    wM = mix(UNIFORM_W, wM, satBlend);

    float wWhite   = clamp((L - 0.8) * 5.0, 0.0, 1.0);
    float wBlack   = clamp((0.2 - L) * 5.0, 0.0, 1.0);
    float wNeutral = clamp(1.0 - satBlend, 0.0, 1.0);

    float weights[9];
    weights[0] = wR;
    weights[1] = wY;
    weights[2] = wG;
    weights[3] = wC;
    weights[4] = wB;
    weights[5] = wM;
    weights[6] = wWhite;
    weights[7] = wNeutral;
    weights[8] = wBlack;

    float dC = 0.0, dM = 0.0, dY = 0.0, dK = 0.0;
    for (int i = 0; i < 9; i++) {
      float w = weights[i];
      if (u_relative) {
        dC += w * (u_cyan[i]    / 100.0) * C;
        dM += w * (u_magenta[i] / 100.0) * M;
        dY += w * (u_yellow[i]  / 100.0) * Y;
        dK += w * (u_black[i]   / 100.0) * K;
      } else {
        dC += w * (u_cyan[i]    / 100.0);
        dM += w * (u_magenta[i] / 100.0);
        dY += w * (u_yellow[i]  / 100.0);
        dK += w * (u_black[i]   / 100.0);
      }
    }

    C = clamp(C + dC, 0.0, 1.0);
    M = clamp(M + dM, 0.0, 1.0);
    Y = clamp(Y + dY, 0.0, 1.0);
    K = clamp(K + dK, 0.0, 1.0);

    float kComp = 1.0 - K;
    vec3 adjusted = vec3((1.0 - C) * kComp, (1.0 - M) * kComp, (1.0 - Y) * kComp);

    vec4 result = vec4(adjusted, src.a);
    float mask  = u_hasSelMask ? texture(u_selMask, v_texCoord).r : 1.0;
    fragColor   = mix(src, result, mask);
  }
` as const
