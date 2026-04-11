import React, { createContext, useContext, useReducer } from 'react'
import type { AppState, Tool, RGBAColor, LayerState } from '@/types'

// ─── Actions ──────────────────────────────────────────────────────────────────

type AppAction =
  | { type: 'SET_TOOL'; payload: Tool }
  | { type: 'SET_PRIMARY_COLOR'; payload: RGBAColor }
  | { type: 'SET_SECONDARY_COLOR'; payload: RGBAColor }
  | { type: 'ADD_LAYER'; payload: LayerState }
  | { type: 'REMOVE_LAYER'; payload: string }
  | { type: 'SET_ACTIVE_LAYER'; payload: string }
  | { type: 'TOGGLE_LAYER_VISIBILITY'; payload: string }
  | { type: 'SET_LAYER_OPACITY'; payload: { id: string; opacity: number } }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'TOGGLE_GRID' }
  | { type: 'SET_HISTORY'; payload: { canUndo: boolean; canRedo: boolean } }

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState: AppState = {
  activeTool: 'pencil',
  primaryColor: { r: 0, g: 0, b: 0, a: 255 },
  secondaryColor: { r: 255, g: 255, b: 255, a: 255 },
  layers: [{ id: 'layer-0', name: 'Background', visible: true, opacity: 1, locked: false }],
  activeLayerId: 'layer-0',
  canvas: { width: 512, height: 512, zoom: 1, panX: 0, panY: 0, showGrid: false },
  history: { canUndo: false, canRedo: false }
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_TOOL':
      return { ...state, activeTool: action.payload }

    case 'SET_PRIMARY_COLOR':
      return { ...state, primaryColor: action.payload }

    case 'SET_SECONDARY_COLOR':
      return { ...state, secondaryColor: action.payload }

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

    case 'SET_LAYER_OPACITY':
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.payload.id ? { ...l, opacity: action.payload.opacity } : l
        )
      }

    case 'SET_ZOOM':
      return { ...state, canvas: { ...state.canvas, zoom: action.payload } }

    case 'TOGGLE_GRID':
      return { ...state, canvas: { ...state.canvas, showGrid: !state.canvas.showGrid } }

    case 'SET_HISTORY':
      return { ...state, history: action.payload }

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
