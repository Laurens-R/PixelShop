# Technical Design: Select Menu Actions

## Overview

This feature adds four commands to the **Select** top menu — **All**, **Deselect**, **All Layers**, and **Deselect Layers** — that let users jump to common selection states without touching the Marquee or Lasso tools. The first two commands operate on the pixel selection mask in `selectionStore`; the last two operate on `selectedLayerIds` in `AppContext`. No new state, no new stores, and no new hooks are required. The feature follows the exact same action-dispatch pattern already established by **Invert Selection**.

---

## Affected Areas

| File | Change |
|---|---|
| `electron/main/menu.ts` | Add 4 new `item()` calls + 2 `sep()` calls to the Select submenu |
| `src/components/window/TopBar/TopBar.tsx` | Add 4 new props; extend the Select items array |
| `src/hooks/useKeyboardShortcuts.ts` | Add 3 new optional handler options + key bindings |
| `src/App.tsx` | Add 4 `useCallback` handlers; wire into `useKeyboardShortcuts`, the IPC switch statement, and the `<TopBar>` JSX |

---

## State Changes

No new `AppState` fields, reducer actions, or stores are needed.

- **Pixel selection** — already managed by `selectionStore.setRect()` and `selectionStore.clear()`.
- **Layer selection** — already managed by the existing `SET_SELECTED_LAYERS` action (`payload: string[]`), which writes to `state.selectedLayerIds`.

---

## New Components / Hooks / Tools

None. All logic is inlined in `App.tsx` as `useCallback` handlers, consistent with every other menu action.

---

## Implementation Steps

### Step 1 — Add items to the macOS native menu (`electron/main/menu.ts`)

Replace the current Select submenu:

```ts
// Before
{
  label: 'Select',
  submenu: [
    item('Invert Selection', 'invertSelection', { accelerator: 'CmdOrCtrl+Shift+I', noIntercept: true }),
  ],
},
```

With:

```ts
// After
{
  label: 'Select',
  submenu: [
    item('All',              'selectAll',        { accelerator: 'CmdOrCtrl+A',         noIntercept: true }),
    item('Deselect',         'deselect',         { accelerator: 'CmdOrCtrl+D',         noIntercept: true }),
    sep(),
    item('All Layers',       'selectAllLayers',  { accelerator: 'Alt+CmdOrCtrl+A',     noIntercept: true }),
    item('Deselect Layers',  'deselectLayers'),
    sep(),
    item('Invert Selection', 'invertSelection',  { accelerator: 'CmdOrCtrl+Shift+I',   noIntercept: true }),
  ],
},
```

All shortcuts that must be handled by the renderer use `noIntercept: true`, consistent with `invertSelection`, `freeTransform`, and all undo/redo items. `deselectLayers` has no accelerator. The action strings (`'selectAll'`, `'deselect'`, `'selectAllLayers'`, `'deselectLayers'`) are the IPC payload strings that flow through to the App.tsx switch statement.

### Step 2 — Extend `TopBar.tsx` with 4 new props

Add the following optional props to `TopBarProps`:

```ts
onSelectAll?:       () => void
onDeselect?:        () => void
onSelectAllLayers?: () => void
onDeselectLayers?:  () => void
```

Then update the Select items array (currently only contains Invert Selection):

```ts
{
  label: 'Select',
  items: [
    { label: 'All',              shortcut: 'Ctrl+A',       action: onSelectAll },
    { label: 'Deselect',         shortcut: 'Ctrl+D',       action: onDeselect },
    { separator: true, label: '' },
    { label: 'All Layers',       shortcut: 'Alt+Ctrl+A',   action: onSelectAllLayers },
    { label: 'Deselect Layers',                            action: onDeselectLayers },
    { separator: true, label: '' },
    { label: 'Invert Selection', shortcut: 'Ctrl+Shift+I', action: onInvertSelection },
  ],
},
```

Also add the 4 new props to the destructuring in the function signature and to the `useMemo` dependency array at the bottom of the file.

### Step 3 — Add keyboard handlers to `useKeyboardShortcuts.ts`

Extend `UseKeyboardShortcutsOptions` with three new optional fields:

```ts
handleSelectAll?:       () => void
handleDeselect?:        () => void
handleSelectAllLayers?: () => void
```

`handleDeselectLayers` is not added here because it has no keyboard shortcut.

Destructure all three in the function signature, then add the following branches **inside the `if (!e.ctrlKey && !e.metaKey) return` block**, after the existing `else if (e.key === 'i' && e.shiftKey)` line:

```ts
else if (e.key === 'a' && !e.altKey) { e.preventDefault(); handleSelectAll?.() }
else if (e.key === 'd' && !e.altKey) { e.preventDefault(); handleDeselect?.() }
else if (e.key === 'a' &&  e.altKey) { e.preventDefault(); handleSelectAllLayers?.() }
```

**Text-input safety**: The existing guard at the top of `onKey` —
`if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return`
— already prevents Ctrl+A from firing when a text field is focused. No additional guard is needed. This is the same protection used by all other canvas-level shortcuts in this hook.

Add all three new handler references to the `useEffect` dependency array.

### Step 4 — Add the 4 action handlers in `App.tsx`

Alongside the other view-action `useCallback` definitions (near `handleUndo`, `handleInvertSelection`, etc.), add:

```ts
const handleSelectAll = useCallback((): void => {
  const { width, height } = stateRef.current.canvas
  if (width === 0 || height === 0) return
  selectionStore.setRect(0, 0, width - 1, height - 1, 'set')
}, [])

const handleDeselect = useCallback((): void => {
  selectionStore.clear()
}, [])

const handleSelectAllLayers = useCallback((): void => {
  const allIds = stateRef.current.layers.map(l => l.id)
  dispatch({ type: 'SET_SELECTED_LAYERS', payload: allIds })
}, [dispatch])

const handleDeselectLayers = useCallback((): void => {
  dispatch({ type: 'SET_SELECTED_LAYERS', payload: [] })
}, [dispatch])
```

**`handleSelectAll` detail**: `selectionStore.setRect(0, 0, width - 1, height - 1, 'set')` creates a full-canvas rectangle in `'set'` mode, replacing any existing selection. The `selectionStore` notifies subscribers synchronously, which updates the marching-ants overlay without a React render. The `width === 0` guard satisfies the spec requirement that the command is a no-op when no canvas is open.

**`handleSelectAllLayers` detail**: `stateRef.current.layers` is the flat array that contains *every* layer node — root layers, group nodes, and their children alike (children appear in the array but are also referenced in their parent group's `childIds`). Mapping this flat array with `.map(l => l.id)` therefore naturally includes groups themselves *and* all nested layers, matching the spec requirement that groups and their children are both selected.

**`handleDeselectLayers` detail**: dispatching `SET_SELECTED_LAYERS` with `[]` is already a no-op at the reducer level when `selectedLayerIds` is empty (same shallow-equal array produced, no subscribers triggered that care).

### Step 5 — Wire handlers into `useKeyboardShortcuts` in `App.tsx`

In the existing `useKeyboardShortcuts({...})` call, add:

```ts
handleSelectAll,
handleDeselect,
handleSelectAllLayers,
```

### Step 6 — Wire handlers into the IPC switch statement in `App.tsx`

In the `macMenuHandlerRef.current = useCallback(...)` switch block, add (after the `'invertSelection'` case):

```ts
case 'selectAll':        handleSelectAll(); break
case 'deselect':         handleDeselect(); break
case 'selectAllLayers':  handleSelectAllLayers(); break
case 'deselectLayers':   handleDeselectLayers(); break
```

Also add all four handlers to the `useCallback` dependency array of `macMenuHandlerRef.current`.

### Step 7 — Pass new props to `<TopBar>` in `App.tsx`

In the `<TopBar ... />` JSX block, add alongside the existing `onInvertSelection` prop:

```tsx
onSelectAll={handleSelectAll}
onDeselect={handleDeselect}
onSelectAllLayers={handleSelectAllLayers}
onDeselectLayers={handleDeselectLayers}
```

---

## Action Dispatch Flow

### Pixel selection commands (All / Deselect)

```
User clicks menu item  ─→  TopBar item action()  ─→  handleSelectAll / handleDeselect
  OR
macOS native menu click  ─→  IPC 'menu:action' 'selectAll'/'deselect'
  ─→  macMenuHandlerRef.current(actionId)  ─→  switch case  ─→  handleSelectAll / handleDeselect
  OR
Keyboard (Ctrl+A / Ctrl+D)  ─→  useKeyboardShortcuts onKey  ─→  handleSelectAll / handleDeselect

handleSelectAll  ─→  selectionStore.setRect(0, 0, w-1, h-1, 'set')  ─→  store.notify()  ─→  marching-ants overlay updates
handleDeselect   ─→  selectionStore.clear()                          ─→  store.notify()  ─→  overlay disappears
```

### Layer selection commands (All Layers / Deselect Layers)

```
User clicks menu item  ─→  TopBar item action()  ─→  handleSelectAllLayers / handleDeselectLayers
  OR
macOS native menu click  ─→  IPC 'menu:action' 'selectAllLayers'/'deselectLayers'
  ─→  macMenuHandlerRef.current(actionId)  ─→  switch case  ─→  handleSelectAllLayers / handleDeselectLayers
  OR
Keyboard (Alt+Ctrl+A)  ─→  useKeyboardShortcuts onKey  ─→  handleSelectAllLayers

handleSelectAllLayers  ─→  dispatch({ type: 'SET_SELECTED_LAYERS', payload: allIds })
                            ─→  appReducer  ─→  state.selectedLayerIds = allIds
                            ─→  LayerPanel re-renders all rows as selected (highlighted)

handleDeselectLayers   ─→  dispatch({ type: 'SET_SELECTED_LAYERS', payload: [] })
                            ─→  appReducer  ─→  state.selectedLayerIds = []
                            ─→  LayerPanel clears all row highlights
```

---

## Architectural Constraints

- **No undo history entries.** `handleSelectAll`, `handleDeselect`, `handleSelectAllLayers`, and `handleDeselectLayers` must not call `captureHistory()`. Selection state is transient, consistent with `invertSelection`.
- **`selectionStore` is a module-level singleton** — call its methods directly (same as `selectionStore.invert()` for Invert Selection). Do not route through React state.
- **`SET_SELECTED_LAYERS` does not reset `activeLayerId`.** The spec requires that Deselect Layers does not change the active layer. The reducer confirms: `case 'SET_SELECTED_LAYERS': return { ...state, selectedLayerIds: action.payload }` — `activeLayerId` is untouched.
- **`App.tsx` is a thin orchestrator.** Handlers are `useCallback` lambdas defined inline in App.tsx. There is no case for extracting them into a new hook — they are too simple and tightly coupled to other App.tsx state (stateRef, dispatch, selectionStore).
- **TopBar is a window component.** Adding props to `TopBarProps` is correct. TopBar does not implement the logic itself; it only surfaces the callbacks passed down from App.tsx.
- **`noIntercept: true` for all shortcuts in menu.ts.** The Electron accelerator is displayed in the menu but does not intercept the key event at the OS level. This is mandatory for all shortcuts that are handled by the renderer's keydown listener, preventing double-firing.

---

## Open Questions

None. All requirements are fully specified and all necessary APIs exist in the current codebase.
