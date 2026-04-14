# Technical Design: Adjustment Menu

## Overview

The **Image** top-level menu provides a data-driven, extensible entry point for all non-destructive image adjustment operations. Selecting an item creates a new `AdjustmentLayerState` child record parented to the active pixel layer, then opens a floating panel for that adjustment type. This design establishes the shared type system — discriminated union + params map + registry — that all three sibling adjustment tech designs (`brightness-contrast`, `hue-saturation`, `color-vibrance`) must implement consistently.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `AdjustmentType`, `AdjustmentParamsMap`, per-type adjustment layer interfaces, `AdjustmentLayerState` union, extend `LayerState`, add `openAdjustmentLayerId` to `AppState` |
| `src/store/AppContext.tsx` | Import new types; add `ADD_ADJUSTMENT_LAYER` and `SET_OPEN_ADJUSTMENT` actions; update `REMOVE_LAYER` cascade for adjustment children |
| `src/adjustments/registry.ts` | **New file.** Exports `ADJUSTMENT_REGISTRY` constant array and associated types |
| `src/hooks/useAdjustments.ts` | **New file.** Owns "create adjustment layer" and "open/close panel" logic |
| `src/components/window/TopBar/TopBar.tsx` | Add `onCreateAdjustmentLayer` + `isAdjustmentMenuEnabled` props; build Image menu from registry |
| `src/components/panels/LayerPanel/LayerPanel.tsx` | Render nested adjustment layer rows; click-to-reopen panel dispatch |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx` | **New file.** Floating panel shell; delegates rendering to the correct adjustment sub-panel |
| `src/components/panels/AdjustmentPanel/AdjustmentPanel.module.scss` | **New file.** Floating panel styles |
| `src/components/index.ts` | Export `AdjustmentPanel` |
| `src/App.tsx` | Compose `useAdjustments`; pass new props to `TopBar`; render `AdjustmentPanel` |

---

## Type System Changes

### New types in `src/types/index.ts`

#### 1. `AdjustmentType` — the discriminant string union

```ts
export type AdjustmentType =
  | 'brightness-contrast'
  | 'hue-saturation'
  | 'color-vibrance'
```

Adding a new adjustment type in the future requires only adding a string literal here and a corresponding entry in `AdjustmentParamsMap`.

#### 2. `AdjustmentParamsMap` — params shape keyed by type

```ts
export interface AdjustmentParamsMap {
  'brightness-contrast': { brightness: number; contrast: number }
  'hue-saturation':      { hue: number; saturation: number; lightness: number }
  'color-vibrance':      { vibrance: number; saturation: number }
}
```

This is the **single source of truth** for what parameters each adjustment stores. The individual panel tech designs derive their state from entries in this map. It also enables the registry (below) to be fully type-safe with no loose `Record<string, number>` casts.

#### 3. Per-type adjustment layer interfaces

A shared base avoids repetition across the three concrete subtypes:

```ts
interface AdjustmentLayerBase {
  id:        string
  name:      string
  visible:   boolean
  type:      'adjustment'     // discriminant shared by all adjustment subtypes
  parentId:  string           // ID of the parent pixel layer
}

export interface BrightnessContrastAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'brightness-contrast'
  params: AdjustmentParamsMap['brightness-contrast']
}

export interface HueSaturationAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'hue-saturation'
  params: AdjustmentParamsMap['hue-saturation']
}

export interface ColorVibranceAdjustmentLayer extends AdjustmentLayerBase {
  adjustmentType: 'color-vibrance'
  params: AdjustmentParamsMap['color-vibrance']
}

export type AdjustmentLayerState =
  | BrightnessContrastAdjustmentLayer
  | HueSaturationAdjustmentLayer
  | ColorVibranceAdjustmentLayer
```

Narrowing anywhere in the codebase: `layer.type === 'adjustment'` confirms it is an `AdjustmentLayerState`; then `layer.adjustmentType === 'brightness-contrast'` narrows to the concrete subtype with fully typed `params`.

#### 4. Extend `LayerState`

```ts
export type LayerState =
  | PixelLayerState
  | TextLayerState
  | ShapeLayerState
  | MaskLayerState
  | AdjustmentLayerState
```

#### 5. Type guard helper (export from `src/types/index.ts`)

Because `PixelLayerState` has no `type` field, add an explicit guard:

```ts
export function isPixelLayer(l: LayerState): l is PixelLayerState {
  return !('type' in l)
}
```

This replaces ad-hoc `!('type' in l)` checks scattered throughout the codebase and will be used in the disabled-state logic for the Image menu.

---

## State Changes

### New field in `AppState`

```ts
export interface AppState {
  // …existing fields…
  openAdjustmentLayerId: string | null   // ID of the AdjustmentLayerState whose panel is open; null = no panel
}
```

`openAdjustmentLayerId` is the sole pointer from global state into the open adjustment panel. The panel component looks up the layer by this ID to know which type to render and what the current params are.

Initial value in `AppContext.tsx`: `openAdjustmentLayerId: null`.

### New AppContext actions

```ts
| { type: 'ADD_ADJUSTMENT_LAYER'; payload: AdjustmentLayerState }
| { type: 'SET_OPEN_ADJUSTMENT';  payload: string | null }
```

### Reducer changes in `AppContext.tsx`

**`ADD_ADJUSTMENT_LAYER`** — inserts after all existing children (masks and prior adjustments) of the parent, following the same positional contract as `ADD_MASK_LAYER`:

```ts
case 'ADD_ADJUSTMENT_LAYER': {
  const parentIdx = state.layers.findIndex(l => l.id === action.payload.parentId)
  if (parentIdx < 0) return state
  // Advance past any existing children of this parent
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
```

**`SET_OPEN_ADJUSTMENT`**:

```ts
case 'SET_OPEN_ADJUSTMENT':
  return { ...state, openAdjustmentLayerId: action.payload }
```

**`REMOVE_LAYER` cascade** — extend the existing child cleanup to also remove adjustment layer children:

```ts
// Before (mask only):
!('type' in l && l.type === 'mask' && (l as MaskLayerState).parentId === action.payload)

// After (mask + adjustment):
!(
  'type' in l &&
  (l.type === 'mask' || l.type === 'adjustment') &&
  (l as MaskLayerState | AdjustmentLayerState).parentId === action.payload
)
```

Additionally, if `state.openAdjustmentLayerId === action.payload`, reset it to `null` in the same `REMOVE_LAYER` case.

---

## Adjustment Registry

### New file: `src/adjustments/registry.ts`

```ts
import type { AdjustmentType, AdjustmentParamsMap } from '@/types'

export interface AdjustmentRegistrationEntry<T extends AdjustmentType = AdjustmentType> {
  adjustmentType: T
  label: string                          // menu item text, e.g. 'Brightness/Contrast…'
  defaultParams: AdjustmentParamsMap[T]  // values used when creating a new adjustment layer
}

export const ADJUSTMENT_REGISTRY = [
  {
    adjustmentType: 'brightness-contrast' as const,
    label: 'Brightness/Contrast…',
    defaultParams: { brightness: 0, contrast: 0 },
  },
  {
    adjustmentType: 'hue-saturation' as const,
    label: 'Hue/Saturation…',
    defaultParams: { hue: 0, saturation: 0, lightness: 0 },
  },
  {
    adjustmentType: 'color-vibrance' as const,
    label: 'Color Vibrance…',
    defaultParams: { vibrance: 0, saturation: 0 },
  },
] as const satisfies readonly AdjustmentRegistrationEntry[]
```

**Extensibility rule:** adding a new adjustment type in the future requires:
1. Adding the literal to `AdjustmentType` in `src/types/index.ts`
2. Adding the params shape to `AdjustmentParamsMap`
3. Adding the concrete layer interface + extending `AdjustmentLayerState`
4. Appending one entry to `ADJUSTMENT_REGISTRY`
5. Adding the sub-panel component and registering it in `AdjustmentPanel`

The Image menu component is **never touched**.

---

## New Hook: `useAdjustments`

**File:** `src/hooks/useAdjustments.ts`

Single cohesive concern: the lifecycle of an adjustment layer from creation to panel close.

```ts
interface UseAdjustmentsOptions {
  stateRef:        MutableRefObject<AppState>
  captureHistory:  (label: string) => void
  dispatch:        Dispatch<AppAction>
}

export interface UseAdjustmentsReturn {
  handleCreateAdjustmentLayer: (adjustmentType: AdjustmentType) => void
  handleOpenAdjustmentPanel:   (layerId: string) => void
  handleCloseAdjustmentPanel:  () => void
}
```

**`handleCreateAdjustmentLayer(adjustmentType)`**:
1. Reads `activeLayerId` from `stateRef.current`.
2. Finds the active layer; returns early if it is not a pixel layer (`isPixelLayer` guard).
3. Looks up the registry entry for `adjustmentType` to get `defaultParams` and the display label.
4. Dispatches `ADD_ADJUSTMENT_LAYER` with a new ID, name derived from the registry label, the `adjustmentType`, `defaultParams`, and `parentId = activeLayerId`.
5. Dispatches `SET_OPEN_ADJUSTMENT` with the new layer's ID.
6. Does **not** capture history here — history is captured on panel close.

**`handleOpenAdjustmentPanel(layerId)`**:
1. Dispatches `SET_ACTIVE_LAYER` with `layerId`.
2. Dispatches `SET_OPEN_ADJUSTMENT` with `layerId`.

**`handleCloseAdjustmentPanel()`**:
1. Calls `captureHistory('Adjustment')`.
2. Dispatches `SET_OPEN_ADJUSTMENT` with `null`.

---

## Component Changes

### `TopBar` — new props

```ts
interface TopBarProps {
  // …existing props…
  onCreateAdjustmentLayer?: (type: AdjustmentType) => void
  isAdjustmentMenuEnabled?: boolean   // true only when active layer is a pixel layer
}
```

Inside the `useMemo` that builds `menus`, import `ADJUSTMENT_REGISTRY` and insert the Image menu **between Edit and View**:

```ts
{
  label: 'Image',
  items: ADJUSTMENT_REGISTRY.map(entry => ({
    label:    entry.label,
    disabled: !isAdjustmentMenuEnabled,
    action:   () => onCreateAdjustmentLayer?.(entry.adjustmentType),
  })),
},
```

The menu is fully data-driven; the `TopBar` component has zero knowledge of individual adjustment types.

### `App.tsx` — orchestration

Two additions:
1. Compose `useAdjustments` (alongside `useLayers`, `useHistory`, etc.).
2. Derive `isAdjustmentMenuEnabled`:
   ```ts
   const activeLayer = state.layers.find(l => l.id === state.activeLayerId) ?? null
   const isAdjustmentMenuEnabled = activeLayer !== null && isPixelLayer(activeLayer)
   ```
3. Pass `onCreateAdjustmentLayer={adjustments.handleCreateAdjustmentLayer}` and `isAdjustmentMenuEnabled` to `TopBar`.
4. Render `<AdjustmentPanel onOpenPanel={adjustments.handleOpenAdjustmentPanel} onClose={adjustments.handleCloseAdjustmentPanel} />` in the layout (floats over the canvas, visible only when `openAdjustmentLayerId !== null`).

### `LayerPanel` — adjustment layer rows

Adjustment layers are rendered identically to mask layers in terms of nesting (existing `styles.maskItem` CSS class handles the indent). Two changes are needed:

1. **Row rendering:** treat `type === 'adjustment'` the same as `type === 'mask'` for the purposes of `isMask`-driven rendering (non-draggable, indented, no opacity/blend controls). Rename the local variable to `isChild` for clarity.

2. **Click-to-reopen:** in `handleLayerClick`, when the clicked layer is an adjustment layer and it is already the active layer, also dispatch `SET_OPEN_ADJUSTMENT` with its ID. This implements the "click adjustment layer row to reopen panel" interaction.

3. **Icon:** render a distinct adjustment layer icon (e.g. a sliders/tuning icon) instead of the mask circle icon for `type === 'adjustment'` rows.

### New component: `AdjustmentPanel`

**Category:** `panels/` (reads `AppContext` directly)  
**Path:** `src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`  
**Single responsibility:** render the floating adjustment panel for whichever adjustment layer is currently open.

```ts
interface AdjustmentPanelProps {
  onClose: () => void
}
```

Internally:
- Reads `openAdjustmentLayerId` and `layers` from `AppContext`.
- Finds the open `AdjustmentLayerState` by ID; returns `null` if not found.
- Switches on `layer.adjustmentType` to render the correct sub-panel component (defined in each adjustment's own tech design).
- Renders a close button that calls `onClose`.
- Positioned with CSS `position: fixed` anchored near the upper-right of the canvas viewport area.

The panel dispatches `UPDATE_ADJUSTMENT_LAYER` (defined in individual adjustment tech designs) as the user moves sliders; `onClose` is called when the user presses the close button or Escape.

Export from `src/components/index.ts`.

---

## Implementation Steps

1. **`src/types/index.ts`** — Add `AdjustmentType`, `AdjustmentParamsMap`, `AdjustmentLayerBase`, three concrete adjustment layer interfaces, `AdjustmentLayerState` union, extend `LayerState`, add `isPixelLayer` guard, add `openAdjustmentLayerId: string | null` to `AppState`.

2. **`src/store/AppContext.tsx`** — Import new types. Add `ADD_ADJUSTMENT_LAYER` and `SET_OPEN_ADJUSTMENT` to the `AppAction` union. Add both reducer cases. Update `REMOVE_LAYER` to cascade-delete adjustment children and reset `openAdjustmentLayerId`. Set `openAdjustmentLayerId: null` in `initialState`.

3. **`src/adjustments/registry.ts`** — Create the file with `AdjustmentRegistrationEntry`, `ADJUSTMENT_REGISTRY`.

4. **`src/hooks/useAdjustments.ts`** — Create the hook per the spec above.

5. **`src/components/panels/AdjustmentPanel/AdjustmentPanel.tsx`** + `.module.scss` — Create the floating panel shell. At this stage the switch on `adjustmentType` can render placeholder text for each type; the sibling tech designs fill in the actual sub-panels.

6. **`src/components/index.ts`** — Export `AdjustmentPanel`.

7. **`src/components/window/TopBar/TopBar.tsx`** — Add `onCreateAdjustmentLayer` and `isAdjustmentMenuEnabled` props. Import `ADJUSTMENT_REGISTRY`. Insert Image menu (between Edit and View) built from the registry.

8. **`src/components/panels/LayerPanel/LayerPanel.tsx`** — Extend row rendering to handle `type === 'adjustment'` with indent + no-drag + click-to-reopen dispatch.

9. **`src/App.tsx`** — Compose `useAdjustments`; derive `isAdjustmentMenuEnabled`; pass new props to `TopBar`; render `<AdjustmentPanel>`.

---

## Architectural Constraints

- **`App.tsx` is a thin orchestrator.** All logic for creating/opening/closing adjustment layers lives in `useAdjustments`, not inline in `App.tsx`. `App.tsx` only derives the `isAdjustmentMenuEnabled` boolean (a one-liner) and passes it down.
- **`TopBar` is a window component.** It must not read `AppContext`. The enabled/disabled state is pushed in as a prop from `App.tsx`.
- **`MenuBar` is a widget.** It receives `MenuDef[]` and is unaware of adjustment types; the data-driven menu in `TopBar` keeps `MenuBar` unchanged.
- **Registry in `src/adjustments/`, not in `src/components/` or `src/tools/`.** It is shared across the menu (TopBar), the hook (useAdjustments), and eventually the panel (AdjustmentPanel); it has no UI dependency.
- **`REMOVE_LAYER` must cascade to adjustment children.** Leaving orphaned `AdjustmentLayerState` records (with a `parentId` pointing to a deleted layer) would cause silent bugs in compositing.
- **Undo is captured on panel close, not on layer creation.** This matches the spec and the existing `captureHistory` pattern in other hooks.

---

## Open Questions

1. **`PixelLayerState` lacks a `type` discriminant.** Currently identified by `!('type' in l)`. This design introduces `isPixelLayer()` to encapsulate the check, but the root issue — that `PixelLayerState` has no `type: 'pixel'` field — will grow more error-prone as layer types multiply. Consider a follow-up refactor to add `type: 'pixel'` to `PixelLayerState` (P3; falls outside the scope of this feature but should be tracked).

2. **Undo granularity when two panels open in sequence.** The spec says one undo entry per panel close. If the user opens panel A, changes values, then opens adjustment B (without closing A explicitly), does A auto-commit? The current design does not address this; `SET_OPEN_ADJUSTMENT` with a new ID would leave A's changes untracked. A guard in `handleCreateAdjustmentLayer` that calls `handleCloseAdjustmentPanel` first (if `openAdjustmentLayerId !== null`) would fix this implicitly.

3. **Floating panel anchor.** The spec says "upper-right corner of the canvas." With the canvas potentially panned within the viewport, the correct anchor is the CSS bounding rect of the canvas DOM element, not a fixed viewport offset. `AdjustmentPanel` should read the canvas container's `getBoundingClientRect()` to position itself. This requires a ref prop or a shared layout measurement.

4. **Adjustment layer rendering in WebGL.** This tech design covers state and menu only. Each sibling tech design must specify how the WebGLRenderer applies the adjustment during compositing (GLSL pass vs. CPU pass). Until that is designed, `AdjustmentLayerState` records are stored in AppState but have no visual effect on the rendered canvas.

5. **Merge operations with adjustment children.** The spec is silent on what happens when "Merge Down" or "Flatten Image" is run on a pixel layer that has adjustment children. Options: (a) rasterize the adjustment into the merged result, (b) silently drop the adjustment layer, (c) block the merge until adjustments are resolved. This must be resolved before implementing merge in any adjustment tech design.

6. **Drag-and-drop reordering.** Like mask layers, adjustment layers should be non-draggable (they must stay immediately after their parent). The `LayerPanel` already conditionally sets `draggable` based on `isMask`; the same guard must be extended to `type === 'adjustment'`.
