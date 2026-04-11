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
  uniform sampler2D u_dst;     // composited result so far (dst)
  uniform float u_opacity;
  uniform int u_blendMode;
  // 0=normal 1=multiply 2=screen 3=overlay 4=soft-light 5=hard-light
  // 6=darken 7=lighten 8=difference 9=exclusion 10=color-dodge 11=color-burn

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
    if (src.a < 0.0001) { fragColor = texture(u_dst, v_texCoord); return; }

    vec4 dst = texture(u_dst, v_texCoord);

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

export const BLIT_FRAG = /* glsl */ `#version 300 es
  precision mediump float;
  uniform sampler2D u_tex;
  in vec2 v_texCoord;
  out vec4 fragColor;
  void main() {
    fragColor = texture(u_tex, v_texCoord);
  }
` as const
