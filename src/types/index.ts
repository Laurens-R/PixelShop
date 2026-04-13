// ─── Tools ────────────────────────────────────────────────────────────────────

export type ShapeType = 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'diamond' | 'star'

export type Tool =
  | 'move'
  | 'select'
  | 'lasso'
  | 'magic-wand'
  | 'crop'
  | 'frame'
  | 'eyedropper'
  | 'pencil'
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'gradient'
  | 'dodge'
  | 'burn'
  | 'text'
  | 'shape'
  | 'hand'
  | 'zoom'

// ─── Colors ───────────────────────────────────────────────────────────────────

export interface RGBColor {
  r: number
  g: number
  b: number
}

export interface RGBAColor extends RGBColor {
  a: number
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

// ─── State ────────────────────────────────────────────────────────────────────

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'color-dodge'
  | 'color-burn'

export interface PixelLayerState {
  id: string
  name: string
  visible: boolean
  opacity: number
  locked: boolean
  blendMode: BlendMode
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export interface TextLayerState {
  id: string
  name: string
  visible: boolean
  opacity: number
  locked: boolean
  blendMode: BlendMode
  type: 'text'
  text: string
  x: number
  y: number
  /** Width of the text bounding box in canvas pixels. 0 = unconstrained. */
  boxWidth: number
  /** Height of the text bounding box in canvas pixels. 0 = unconstrained. */
  boxHeight: number
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  align: TextAlign
  color: RGBAColor
}

/**
 * Vector shape layer — stores parametric shape data; pixels are rasterized on demand.
 * The bounding-box fields (cx/cy/w/h/rotation) drive all shapes except 'line'.
 * 'line' uses x1/y1/x2/y2 endpoints.
 */
export interface ShapeLayerState {
  id: string
  name: string
  visible: boolean
  opacity: number
  locked: boolean
  blendMode: BlendMode
  type: 'shape'
  shapeType: ShapeType
  /** Center X in canvas pixels (non-line shapes). */
  cx: number
  /** Center Y in canvas pixels (non-line shapes). */
  cy: number
  /** Bounding-box width in canvas pixels (non-line shapes). */
  w: number
  /** Bounding-box height in canvas pixels (non-line shapes). */
  h: number
  /** Rotation in degrees, clockwise (non-line shapes). */
  rotation: number
  /** Line start X (line shape only). */
  x1: number
  /** Line start Y (line shape only). */
  y1: number
  /** Line end X (line shape only). */
  x2: number
  /** Line end Y (line shape only). */
  y2: number
  /** null = no stroke */
  strokeColor: RGBAColor | null
  /** null = no fill */
  fillColor: RGBAColor | null
  strokeWidth: number
  /** Corner radius in canvas pixels. Applies to rectangle. */
  cornerRadius: number
  antiAlias: boolean
}

/**
 * Layer mask child — stores a single-channel grayscale mask (0=hide, 255=show)
 * painted directly on by the user. Stored as a full-canvas RGBA WebGLLayer
 * where the R channel is the mask alpha value.  Immediately follows its parent
 * in the layers array and is excluded from independent compositing.
 */
export interface MaskLayerState {
  id: string
  name: string
  visible: boolean
  type: 'mask'
  /** ID of the parent layer this mask belongs to. */
  parentId: string
}

export type LayerState = PixelLayerState | TextLayerState | ShapeLayerState | MaskLayerState

export type BackgroundFill = 'white' | 'black' | 'transparent'

export type GridType = 'normal' | 'thirds' | 'safe-zone'

export interface CanvasState {
  width: number
  height: number
  zoom: number
  panX: number
  panY: number
  showGrid: boolean
  gridSize: number
  gridColor: string
  gridType: GridType
  backgroundFill: BackgroundFill
  key: number
}

export interface AppState {
  activeTool: Tool
  activeShape: ShapeType
  primaryColor: RGBAColor
  secondaryColor: RGBAColor
  swatches: RGBAColor[]
  layers: LayerState[]
  activeLayerId: string | null
  canvas: CanvasState
  history: {
    canUndo: boolean
    canRedo: boolean
  }
}
