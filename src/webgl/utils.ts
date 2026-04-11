// ─── Shader helpers ───────────────────────────────────────────────────────────

export function compileShader(
  gl: WebGLRenderingContext,
  type: GLenum,
  source: string
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to create WebGL shader')

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compilation error: ${info}`)
  }

  return shader
}

export function linkProgram(
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('Failed to create WebGL program')

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program link error: ${info}`)
  }

  return program
}

// ─── Texture helpers ──────────────────────────────────────────────────────────

export function createPixelTexture(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
  data?: Uint8Array | null
): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Failed to create WebGL texture')

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  // NEAREST filter preserves pixel-perfect rendering
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data ?? null
  )

  return texture
}

export function uploadTextureData(
  gl: WebGLRenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
  data: Uint8Array
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data)
}

// ─── Buffer helpers ───────────────────────────────────────────────────────────

export function createStaticBuffer(
  gl: WebGLRenderingContext,
  data: Float32Array
): WebGLBuffer {
  const buffer = gl.createBuffer()
  if (!buffer) throw new Error('Failed to create WebGL buffer')

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)

  return buffer
}

export function fillRectBuffer(
  gl: WebGLRenderingContext,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([x, y, x + w, y, x, y + h, x, y + h, x + w, y, x + w, y + h]),
    gl.DYNAMIC_DRAW
  )
}
