import React, { createContext, useContext, useReducer } from 'react'
import type { AppState, Tool, ShapeType, RGBAColor, LayerState, TextLayerState, BlendMode, BackgroundFill, GridType } from '@/types'

// ─── Actions ──────────────────────────────────────────────────────────────────

type AppAction =
  | { type: 'SET_TOOL'; payload: Tool }
  | { type: 'SET_SHAPE'; payload: ShapeType }
  | { type: 'SET_PRIMARY_COLOR'; payload: RGBAColor }
  | { type: 'SET_SECONDARY_COLOR'; payload: RGBAColor }
  | { type: 'ADD_SWATCH'; payload: RGBAColor }
  | { type: 'REMOVE_SWATCH'; payload: number }
  | { type: 'ADD_LAYER'; payload: LayerState }
  | { type: 'REMOVE_LAYER'; payload: string }
  | { type: 'SET_ACTIVE_LAYER'; payload: string }
  | { type: 'TOGGLE_LAYER_VISIBILITY'; payload: string }
  | { type: 'TOGGLE_LAYER_LOCK'; payload: string }
  | { type: 'SET_LAYER_OPACITY'; payload: { id: string; opacity: number } }
  | { type: 'SET_LAYER_BLEND'; payload: { id: string; blendMode: BlendMode } }
  | { type: 'RENAME_LAYER'; payload: { id: string; name: string } }
  | { type: 'REORDER_LAYERS'; payload: LayerState[] }
  | { type: 'ADD_TEXT_LAYER'; payload: TextLayerState }
  | { type: 'UPDATE_TEXT_LAYER'; payload: TextLayerState }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'TOGGLE_GRID' }
  | { type: 'SET_GRID_SIZE'; payload: number }
  | { type: 'SET_GRID_COLOR'; payload: string }
  | { type: 'SET_GRID_TYPE'; payload: GridType }
  | { type: 'SET_HISTORY'; payload: { canUndo: boolean; canRedo: boolean } }
  | { type: 'NEW_CANVAS'; payload: { width: number; height: number; backgroundFill: BackgroundFill } }
  | { type: 'OPEN_FILE'; payload: { width: number; height: number; layers: LayerState[]; activeLayerId: string | null } }
  | { type: 'RESTORE_TAB'; payload: { width: number; height: number; backgroundFill: BackgroundFill; layers: LayerState[]; activeLayerId: string | null; zoom: number } }
  | { type: 'SWITCH_TAB';   payload: { width: number; height: number; backgroundFill: BackgroundFill; layers: LayerState[]; activeLayerId: string | null; zoom: number } }
  | { type: 'RESTORE_LAYERS'; payload: { layers: LayerState[]; activeLayerId: string | null } }
  | { type: 'RESIZE_CANVAS'; payload: { width: number; height: number } }

// ─── Initial state ────────────────────────────────────────────────────────────

const DEFAULT_SWATCHES: RGBAColor[] = [
  { r: 0,   g: 0,   b: 0,   a: 255 },
  { r: 255, g: 255, b: 255, a: 255 },
  { r: 192, g: 192, b: 192, a: 255 },
  { r: 128, g: 128, b: 128, a: 255 },
  { r: 255, g: 0,   b: 0,   a: 255 },
  { r: 128, g: 0,   b: 0,   a: 255 },
  { r: 255, g: 255, b: 0,   a: 255 },
  { r: 128, g: 128, b: 0,   a: 255 },
  { r: 0,   g: 255, b: 0,   a: 255 },
  { r: 0,   g: 128, b: 0,   a: 255 },
  { r: 0,   g: 255, b: 255, a: 255 },
  { r: 0,   g: 128, b: 128, a: 255 },
  { r: 0,   g: 0,   b: 255, a: 255 },
  { r: 0,   g: 0,   b: 128, a: 255 },
  { r: 255, g: 0,   b: 255, a: 255 },
  { r: 128, g: 0,   b: 128, a: 255 },
  { r: 255, g: 128, b: 0,   a: 255 },
  { r: 255, g: 200, b: 150, a: 255 },
]

const initialState: AppState = {
  activeTool: 'pencil',
  activeShape: 'rectangle',
  primaryColor: { r: 0, g: 0, b: 0, a: 255 },
  secondaryColor: { r: 255, g: 255, b: 255, a: 255 },
  swatches: DEFAULT_SWATCHES,
  layers: [{ id: 'layer-0', name: 'Background', visible: true, opacity: 1, locked: false, blendMode: 'normal' }],
  activeLayerId: 'layer-0',
  canvas: { width: 512, height: 512, zoom: 1, panX: 0, panY: 0, showGrid: false, gridSize: 16, gridColor: '#808080', gridType: 'normal' as GridType, backgroundFill: 'white', key: 0 },
  history: { canUndo: false, canRedo: false }
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_TOOL':
      return { ...state, activeTool: action.payload }

    case 'SET_SHAPE':
      return { ...state, activeShape: action.payload }

    case 'SET_PRIMARY_COLOR':
      return { ...state, primaryColor: action.payload }

    case 'SET_SECONDARY_COLOR':
      return { ...state, secondaryColor: action.payload }

    case 'ADD_SWATCH':
      return { ...state, swatches: [...state.swatches, action.payload] }

    case 'REMOVE_SWATCH': {
      const next = state.swatches.filter((_, i) => i !== action.payload)
      return { ...state, swatches: next }
    }

    case 'ADD_LAYER':
      return {
        ...state,
        layers: [...state.layers, action.payload],
        activeLayerId: action.payload.id
      }

    case 'REMOVE_LAYER': {
      if (state.layers.length <= 1) return state
      const remaining = state.layers.filter((l) => l.id !== action.payload)
      return {
        ...state,
        layers: remaining,
        activeLayerId:
          state.activeLayerId === action.payload ? (remaining[remaining.length - 1]?.id ?? null) : state.activeLayerId
      }
    }

    case 'SET_ACTIVE_LAYER':
      return { ...state, activeLayerId: action.payload }

    case 'TOGGLE_LAYER_VISIBILITY':
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.payload ? { ...l, visible: !l.visible } : l
        )
      }

    case 'TOGGLE_LAYER_LOCK':
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.payload ? { ...l, locked: !l.locked } : l
        )
      }

    case 'SET_LAYER_OPACITY':
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.payload.id ? { ...l, opacity: action.payload.opacity } : l
        )
      }

    case 'SET_LAYER_BLEND':
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.payload.id ? { ...l, blendMode: action.payload.blendMode } : l
        )
      }

    case 'RENAME_LAYER':
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.payload.id ? { ...l, name: action.payload.name } : l
        )
      }

    case 'REORDER_LAYERS':
      return { ...state, layers: action.payload }

    case 'ADD_TEXT_LAYER':
      return {
        ...state,
        layers: [...state.layers, action.payload],
        activeLayerId: action.payload.id,
      }

    case 'UPDATE_TEXT_LAYER':
      return {
        ...state,
        layers: state.layers.map((l) => l.id === action.payload.id ? action.payload : l),
      }

    case 'SET_ZOOM':
      return { ...state, canvas: { ...state.canvas, zoom: action.payload } }

    case 'TOGGLE_GRID':
      return { ...state, canvas: { ...state.canvas, showGrid: !state.canvas.showGrid } }

    case 'SET_GRID_SIZE':
      return { ...state, canvas: { ...state.canvas, gridSize: Math.max(1, action.payload) } }

    case 'SET_GRID_COLOR':
      return { ...state, canvas: { ...state.canvas, gridColor: action.payload } }

    case 'SET_GRID_TYPE':
      return { ...state, canvas: { ...state.canvas, gridType: action.payload } }

    case 'SET_HISTORY':
      return { ...state, history: action.payload }

    case 'NEW_CANVAS':
      return {
        ...state,
        layers: [{ id: 'layer-0', name: 'Background', visible: true, opacity: 1, locked: false, blendMode: 'normal' }],
        activeLayerId: 'layer-0',
        canvas: {
          ...state.canvas,
          width: action.payload.width,
          height: action.payload.height,
          backgroundFill: action.payload.backgroundFill,
          zoom: 1,
          panX: 0,
          panY: 0,
          key: state.canvas.key + 1
        },
        history: { canUndo: false, canRedo: false }
      }

    case 'OPEN_FILE':
      return {
        ...state,
        layers: action.payload.layers,
        activeLayerId: action.payload.activeLayerId,
        canvas: {
          ...state.canvas,
          width: action.payload.width,
          height: action.payload.height,
          zoom: 1,
          panX: 0,
          panY: 0,
          key: state.canvas.key + 1
        },
        history: { canUndo: false, canRedo: false }
      }

    case 'RESTORE_LAYERS':
      return {
        ...state,
        layers: action.payload.layers,
        activeLayerId: action.payload.activeLayerId,
      }

    case 'RESIZE_CANVAS':
      return {
        ...state,
        canvas: {
          ...state.canvas,
          width: action.payload.width,
          height: action.payload.height,
          // canvas.key intentionally NOT incremented — per-tab canvasKey handles remounting
        }
      }

    case 'RESTORE_TAB':
      return {
        ...state,
        layers: action.payload.layers,
        activeLayerId: action.payload.activeLayerId,
        canvas: {
          ...state.canvas,
          width: action.payload.width,
          height: action.payload.height,
          backgroundFill: action.payload.backgroundFill,
          zoom: action.payload.zoom,
          panX: 0,
          panY: 0,
          key: state.canvas.key + 1
        },
        history: { canUndo: false, canRedo: false }
      }

    case 'SWITCH_TAB':
      // Same as RESTORE_TAB but does NOT increment canvas.key and does NOT reset history.
      // Used for fast tab switching where the Canvas stays mounted.
      return {
        ...state,
        layers: action.payload.layers,
        activeLayerId: action.payload.activeLayerId,
        canvas: {
          ...state.canvas,
          width: action.payload.width,
          height: action.payload.height,
          backgroundFill: action.payload.backgroundFill,
          zoom: action.payload.zoom,
        },
      }

    default:
      return state
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState
  dispatch: React.Dispatch<AppAction>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(appReducer, initialState)
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within an AppProvider')
  return ctx
}
