import React, { createContext, useContext, useReducer } from 'react'
import type { AppState, Tool, ShapeType, RGBAColor, LayerState, TextLayerState, ShapeLayerState, MaskLayerState, AdjustmentLayerState, BlendMode, BackgroundFill, GridType, SwatchGroup } from '@/types'
import { DEFAULT_SWATCHES } from './tabTypes'

// ─── Actions ──────────────────────────────────────────────────────────────────

export type AppAction =
  | { type: 'SET_TOOL'; payload: Tool }
  | { type: 'SET_SHAPE'; payload: ShapeType }
  | { type: 'SET_PRIMARY_COLOR'; payload: RGBAColor }
  | { type: 'SET_SECONDARY_COLOR'; payload: RGBAColor }
  | { type: 'ADD_SWATCH'; payload: RGBAColor }
  | { type: 'REMOVE_SWATCH'; payload: number }
  | { type: 'ADD_LAYER'; payload: LayerState }
  | { type: 'INSERT_LAYER_ABOVE'; payload: { layer: LayerState; aboveId: string } }
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
  | { type: 'ADD_SHAPE_LAYER'; payload: ShapeLayerState }
  | { type: 'UPDATE_SHAPE_LAYER'; payload: ShapeLayerState }
  | { type: 'ADD_MASK_LAYER'; payload: MaskLayerState }
  | { type: 'ADD_ADJUSTMENT_LAYER'; payload: AdjustmentLayerState }
  | { type: 'UPDATE_ADJUSTMENT_LAYER'; payload: AdjustmentLayerState }
  | { type: 'SET_OPEN_ADJUSTMENT'; payload: string | null }
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
  | { type: 'SET_SWATCHES'; payload: RGBAColor[] }
  | { type: 'SET_SWATCH_GROUPS'; payload: SwatchGroup[] }
  | { type: 'ADD_SWATCH_GROUP'; payload: { name: string; swatchIndices: number[] } }
  | { type: 'ADD_SWATCHES_TO_GROUP'; payload: { id: string; swatchIndices: number[] } }
  | { type: 'REMOVE_SWATCH_GROUP'; payload: string }
  | { type: 'RENAME_SWATCH_GROUP'; payload: { id: string; name: string } }

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState: AppState = {
  activeTool: 'pencil',
  activeShape: 'rectangle',
  primaryColor: { r: 0, g: 0, b: 0, a: 255 },
  secondaryColor: { r: 255, g: 255, b: 255, a: 255 },
  swatches: DEFAULT_SWATCHES,
  swatchGroups: [],
  layers: [{ id: 'layer-0', name: 'Background', visible: true, opacity: 1, locked: false, blendMode: 'normal' }],
  activeLayerId: 'layer-0',
  canvas: { width: 512, height: 512, zoom: 1, panX: 0, panY: 0, showGrid: false, gridSize: 16, gridColor: '#808080', gridType: 'normal' as GridType, backgroundFill: 'white', key: 0 },
  history: { canUndo: false, canRedo: false },
  openAdjustmentLayerId: null,
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

    case 'SET_SWATCHES':
      return { ...state, swatches: action.payload }

    case 'REMOVE_SWATCH': {
      const idx = action.payload
      const nextSwatches = state.swatches.filter((_, i) => i !== idx)
      const nextGroups = state.swatchGroups.map(g => ({
        ...g,
        swatchIndices: g.swatchIndices
          .filter(i => i !== idx)
          .map(i => (i > idx ? i - 1 : i)),
      }))
      return { ...state, swatches: nextSwatches, swatchGroups: nextGroups }
    }

    case 'SET_SWATCH_GROUPS':
      return { ...state, swatchGroups: action.payload }

    case 'ADD_SWATCH_GROUP': {
      const { name, swatchIndices } = action.payload
      const existing = state.swatchGroups.find(g => g.name === name)
      if (existing) {
        const merged = [...new Set([...existing.swatchIndices, ...swatchIndices])]
        return {
          ...state,
          swatchGroups: state.swatchGroups.map(g =>
            g.id === existing.id ? { ...g, swatchIndices: merged } : g
          ),
        }
      }
      return {
        ...state,
        swatchGroups: [
          ...state.swatchGroups,
          { id: crypto.randomUUID(), name, swatchIndices },
        ],
      }
    }

    case 'ADD_SWATCHES_TO_GROUP': {
      const { id, swatchIndices } = action.payload
      return {
        ...state,
        swatchGroups: state.swatchGroups.map(g =>
          g.id === id
            ? { ...g, swatchIndices: [...new Set([...g.swatchIndices, ...swatchIndices])] }
            : g
        ),
      }
    }

    case 'REMOVE_SWATCH_GROUP':
      return { ...state, swatchGroups: state.swatchGroups.filter(g => g.id !== action.payload) }

    case 'RENAME_SWATCH_GROUP':
      return {
        ...state,
        swatchGroups: state.swatchGroups.map(g =>
          g.id === action.payload.id ? { ...g, name: action.payload.name } : g
        ),
      }

    case 'ADD_LAYER':
      return {
        ...state,
        layers: [...state.layers, action.payload],
        activeLayerId: action.payload.id
      }

    case 'INSERT_LAYER_ABOVE': {
      const idx = state.layers.findIndex((l) => l.id === action.payload.aboveId)
      const insertAt = idx >= 0 ? idx + 1 : state.layers.length
      const next = [...state.layers]
      next.splice(insertAt, 0, action.payload.layer)
      return { ...state, layers: next, activeLayerId: action.payload.layer.id }
    }

    case 'REMOVE_LAYER': {
      if (state.layers.length <= 1) return state
      // Also remove any mask or adjustment child whose parent is being removed
      const remaining = state.layers.filter((l) =>
        l.id !== action.payload &&
        !(
          'type' in l &&
          (l.type === 'mask' || l.type === 'adjustment') &&
          (l as MaskLayerState | AdjustmentLayerState).parentId === action.payload
        )
      )
      if (remaining.length === 0) return state
      const newOpenAdjId =
        state.openAdjustmentLayerId !== null && remaining.some(l => l.id === state.openAdjustmentLayerId)
          ? state.openAdjustmentLayerId
          : null
      return {
        ...state,
        layers: remaining,
        activeLayerId:
          state.activeLayerId === action.payload ? (remaining[remaining.length - 1]?.id ?? null) : state.activeLayerId,
        openAdjustmentLayerId: newOpenAdjId,
      }
    }

    case 'ADD_MASK_LAYER': {
      const parentIdx = state.layers.findIndex((l) => l.id === action.payload.parentId)
      if (parentIdx < 0) return state
      const next = [...state.layers]
      next.splice(parentIdx + 1, 0, action.payload)
      return { ...state, layers: next, activeLayerId: action.payload.id }
    }
    case 'ADD_ADJUSTMENT_LAYER': {
      const parentIdx = state.layers.findIndex(l => l.id === action.payload.parentId)
      if (parentIdx < 0) return state
      let insertAt = parentIdx + 1
      while (
        insertAt < state.layers.length &&
        'type' in state.layers[insertAt] &&
        (state.layers[insertAt] as MaskLayerState | AdjustmentLayerState).parentId === action.payload.parentId
      ) { insertAt++ }
      const next = [...state.layers]
      next.splice(insertAt, 0, action.payload)
      return { ...state, layers: next, activeLayerId: action.payload.id }
    }

    case 'UPDATE_ADJUSTMENT_LAYER':
      return {
        ...state,
        layers: state.layers.map((l) => l.id === action.payload.id ? action.payload : l),
      }

    case 'SET_OPEN_ADJUSTMENT':
      return { ...state, openAdjustmentLayerId: action.payload }
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
          l.id === action.payload && !('type' in l && l.type === 'mask')
            ? { ...l, locked: !(l as { locked: boolean }).locked }
            : l
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

    case 'ADD_SHAPE_LAYER':
      return {
        ...state,
        layers: [...state.layers, action.payload],
        activeLayerId: action.payload.id,
      }

    case 'UPDATE_SHAPE_LAYER':
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
