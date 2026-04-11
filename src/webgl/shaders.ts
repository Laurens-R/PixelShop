// ─── Vertex shader – image layer rendering ────────────────────────────────────

export const IMAGE_VERT = /* glsl */ `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;

  uniform vec2 u_resolution;
  uniform mat3 u_transform;

  varying vec2 v_texCoord;

  void main() {
    vec3 transformed = u_transform * vec3(a_position, 1.0);
    vec2 clipSpace = ((transformed.xy / u_resolution) * 2.0) - 1.0;
    gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
` as const

// ─── Fragment shader – image layer rendering ──────────────────────────────────

export const IMAGE_FRAG = /* glsl */ `
  precision mediump float;

  uniform sampler2D u_image;
  uniform float u_opacity;

  varying vec2 v_texCoord;

  void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    gl_FragColor = vec4(color.rgb, color.a * u_opacity);
  }
` as const

// ─── Vertex shader – checkerboard background ──────────────────────────────────

export const CHECKER_VERT = /* glsl */ `
  attribute vec2 a_position;

  uniform vec2 u_resolution;

  void main() {
    vec2 clipSpace = ((a_position / u_resolution) * 2.0) - 1.0;
    gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
  }
` as const

// ─── Fragment shader – checkerboard background ────────────────────────────────

export const CHECKER_FRAG = /* glsl */ `
  precision mediump float;

  uniform float u_tileSize;
  uniform vec3 u_colorA;
  uniform vec3 u_colorB;

  void main() {
    vec2 pos = floor(gl_FragCoord.xy / u_tileSize);
    float pattern = mod(pos.x + pos.y, 2.0);
    gl_FragColor = vec4(mix(u_colorA, u_colorB, pattern), 1.0);
  }
` as const
