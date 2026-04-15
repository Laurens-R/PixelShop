# Technical Design: Filters Menu

## Overview

The **Filters** menu is a new top-level entry in the menu bar, positioned immediately after the **Image** menu. It is a stateless UI component — clicking an item calls a callback that opens the corresponding filter dialog; no new `AppState` fields are required. The menu is disabled entirely when the active layer is not a pixel layer, mirroring the same enabled/disabled rule as the Image menu. The initial release contains one item: **Gaussian Blur…**. The structure is registry-driven so future filters can be added by appending to the registry without touching the menu component.

---

## Affected Areas

| File | Change |
|---|---|
| `src/types/index.ts` | Add `FilterKey` string union type |
| `src/adjustments/registry.ts` | **Analogy reference only.** No change here — filters get their own registry file |
| `src/filters/registry.ts` | **New file.** Exports `FILTER_REGISTRY` constant array |
| `src/hooks/useFilters.ts` | **New file.** Owns enabled-state derivation and per-filter open callbacks |
| `src/components/window/TopBar/TopBar.tsx` | Add `onOpenFilterDialog`, `isFiltersMenuEnabled`, `filterMenuItems` props; add Filters `MenuDef` entry between Image and View |
| `src/App.tsx` | Add `showGaussianBlurDialog` local state; compose `useFilters`; define `handleOpenFilterDialog`; pass new props to `TopBar`; render `GaussianBlurDialog` |

---

## Type Changes

### `FilterKey` in `src/types/index.ts`

```ts
export type FilterKey = 'gaussian-blur'
```

Adding a new filter in the future requires only appending a string literal here.

---

## Filter Registry

### New file: `src/filters/registry.ts`

```ts
import type { FilterKey } from '@/types'

export interface FilterRegistryEntry {
  key: FilterKey
  label: string   // menu item text, e.g. 'Gaussian Blur…'
}

export const FILTER_REGISTRY: FilterRegistryEntry[] = [
  { key: 'gaussian-blur', label: 'Gaussian Blur…' },
]
```

The registry is the single place that owns the menu label and key for each filter. `TopBar` consumes it as a prop array so it never imports the registry directly.

---

## The `useFilters` Hook

### New file: `src/hooks/useFilters.ts`

```ts
interface UseFiltersOptions {
  layers:              LayerState[]
  activeLayerId:       string | null
  onOpenFilterDialog:  (key: FilterKey) => void
}

export interface UseFiltersReturn {
  isFiltersMenuEnabled:   boolean
  handleOpenGaussianBlur: () => void
}
```

**`isFiltersMenuEnabled`** is derived with `useMemo`:

```ts
const isFiltersMenuEnabled = useMemo(() => {
  const active = layers.find(l => l.id === activeLayerId)
  if (active == null) return false
  return isPixelLayer(active)        // false for adjustment, mask, text, shape layers
}, [layers, activeLayerId])
```

This is intentionally stricter than `isAdjustmentMenuEnabled`: filters write destructively to the active layer, so only a directly-active pixel layer qualifies. There is no "use parent pixel layer" fallback.

**`handleOpenGaussianBlur`** is a stable `useCallback` that delegates to the passed-in dispatcher:

```ts
const handleOpenGaussianBlur = useCallback(
  () => onOpenFilterDialog('gaussian-blur'),
  [onOpenFilterDialog]
)
```

When more filters are added, each follows the same pattern: one `useCallback` per filter key, calling `onOpenFilterDialog` with its key.

---

## TopBar Extension

### `src/components/window/TopBar/TopBar.tsx`

Add three new props (all optional, parallel to the adjustment props):

```ts
onOpenFilterDialog?:  (key: FilterKey) => void
isFiltersMenuEnabled?: boolean
filterMenuItems?:     Array<{ key: FilterKey; label: string }>
```

Insert the Filters `MenuDef` between the Image entry and the View entry in the `menus` array:

```ts
{
  label: 'Filters',
  items: (filterMenuItems ?? []).map(item => ({
    label:    item.label,
    disabled: !isFiltersMenuEnabled,
    action:   () => onOpenFilterDialog?.(item.key),
  })),
},
```

Add `onOpenFilterDialog`, `isFiltersMenuEnabled`, and `filterMenuItems` to the `useMemo` dependency array.

---

## `App.tsx` Changes

### 1. Static constant (alongside `ADJUSTMENT_MENU_ITEMS`)

```ts
import { FILTER_REGISTRY } from '@/filters/registry'
import type { FilterKey } from '@/types'

const FILTER_MENU_ITEMS = FILTER_REGISTRY.map(e => ({ key: e.key, label: e.label }))
```

### 2. Dialog open state

```ts
const [showGaussianBlurDialog, setShowGaussianBlurDialog] = useState(false)
```

This lives in `App.tsx` alongside all other `show*Dialog` state, following the established pattern for modal dialogs.

### 3. Dispatch callback

```ts
const handleOpenFilterDialog = useCallback((key: FilterKey): void => {
  if (key === 'gaussian-blur') setShowGaussianBlurDialog(true)
}, [])
```

When new filter keys are added to `FilterKey`, a new `if` branch is added here — no other file needs to change.

### 4. Compose `useFilters`

```ts
const filters = useFilters({
  layers:             state.layers,
  activeLayerId:      state.activeLayerId,
  onOpenFilterDialog: handleOpenFilterDialog,
})
```

### 5. Pass new props to `TopBar`

```tsx
onOpenFilterDialog={filters.handleOpenGaussianBlur}  // not used directly — TopBar calls onOpenFilterDialog(key)
isFiltersMenuEnabled={filters.isFiltersMenuEnabled}
filterMenuItems={FILTER_MENU_ITEMS}
```

Correction: `TopBar` receives `onOpenFilterDialog={handleOpenFilterDialog}` (the dispatcher), not the per-filter callback.

```tsx
<TopBar
  {/* …existing props… */}
  onOpenFilterDialog={handleOpenFilterDialog}
  isFiltersMenuEnabled={filters.isFiltersMenuEnabled}
  filterMenuItems={FILTER_MENU_ITEMS}
/>
```

### 6. Render `GaussianBlurDialog`

```tsx
{showGaussianBlurDialog && (
  <GaussianBlurDialog
    onClose={() => setShowGaussianBlurDialog(false)}
  />
)}
```

Dialog internals (canvas preview, radius control, apply/cancel logic) are defined in the Gaussian Blur technical design, not here.

---

## Architectural Constraints

- **No new `AppState` fields.** Dialog visibility is local `useState` in `App.tsx`, consistent with all other dialog flags (`showExportDialog`, `showResizeDialog`, etc.).
- **`useFilters` owns one concern.** It derives enabled state and wraps `onOpenFilterDialog` callbacks. It does not manage dialog state, canvas operations, or history — those belong elsewhere.
- **`TopBar` remains a pure prop-consumer.** It builds the Filters menu from `filterMenuItems` and calls `onOpenFilterDialog`; it never imports the registry or the hook.
- **`App.tsx` stays thin.** `handleOpenFilterDialog` is a simple switch on `FilterKey`; no business logic lives in it.
- **`isPixelLayer` guard** from `src/types/index.ts` is the single source of truth for the enabled check, consistent with the same guard used in `useAdjustments`.

---

## Extensibility

Adding a second filter (e.g., **Sharpen…**) requires:
1. Append `'sharpen'` to `FilterKey` in `src/types/index.ts`.
2. Append `{ key: 'sharpen', label: 'Sharpen…' }` to `FILTER_REGISTRY`.
3. Add an `if (key === 'sharpen')` branch in `handleOpenFilterDialog` in `App.tsx`.
4. Add `showSharpenDialog` state and `SharpenDialog` render in `App.tsx`.
5. No changes to `useFilters`, `TopBar`, or the registry file structure.

---

## Open Questions

- **`GaussianBlurDialog` props** — the dialog's `onClose` prop shape (and whether it also receives an `onApply` callback or handles apply internally) is defined in the Gaussian Blur technical design.
- **Selection masking** — the spec requires filters to be confined to an active selection if one exists. Whether `GaussianBlurDialog` reads `selectionStore` directly or receives a `selectionMask` prop is a decision for the Gaussian Blur technical design.
