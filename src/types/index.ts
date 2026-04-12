// ─── Tools ────────────────────────────────────────────────────────────────────

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

export interface LayerState {
  id: string
  name: string
  visible: boolean
  opacity: number
  locked: boolean
  blendMode: BlendMode
}

export type BackgroundFill = 'white' | 'black' | 'transparent'

export interface CanvasState {
  width: number
  height: number
  zoom: number
  panX: number
  panY: number
  showGrid: boolean
  backgroundFill: BackgroundFill
  key: number
}

export interface AppState {
  activeTool: Tool
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
