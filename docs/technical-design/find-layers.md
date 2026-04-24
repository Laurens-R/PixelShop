# Technical Design: Find Layers

## Overview

Find Layers adds a real-time name filter bar to the Layers panel. When active, it hides every layer whose name does not match the typed query (case-insensitive substring), surfacing ancestor groups of matching layers so the visual hierarchy is preserved. The filter is a pure display concern: it never touches layer state, undo history, or serialization. All state is local to `LayerPanel`; no changes to `AppState`, no new store, and no new hook are required.

---

## Affected Areas

| File | Change |
|---|---|
| `src/components/panels/LayerPanel/LayerPanel.tsx` | Core feature: filter bar UI, derived filtered row list, tab-reset effect, focus-trigger effect |
| `src/components/panels/LayerPanel/LayerPanel.module.scss` | New styles: `.filterBar`, `.filterBarOpen`, `.filterBarActive`, `.filterInput`, `.filterInputFocused`, `.filterClearBtn`, `.filterIcon`, `.filterCountBadge` |
| `src/components/window/RightPanel/RightPanel.tsx` | Accept and forward two new props: `activeTabId` (already available on `RightPanel`, not yet forwarded to `LayerPanel`) and `findLayersTrigger` |
| `src/App.tsx` | Add `findLayersCounter` state; add `handleFindLayers` callback; pass `findLayersTrigger` to `RightPanel`; add `'findLayers'` IPC case to the `macMenuHandlerRef` switch |
| `src/hooks/useKeyboardShortcuts.ts` | Add `handleFindLayers?` option; add `Alt+Shift+Ctrl/Cmd+F` branch to `onKey` |
| `src/components/window/TopBar/TopBar.tsx` | Add `onFindLayers?` prop; insert **Find Layers** item between Deselect Layers and Invert Selection (with a separator on each side) in the Select items array |
| `electron/main/menu.ts` | Insert `item('Find Layers', 'findLayers', { accelerator: 'Alt+Shift+CmdOrCtrl+F', noIntercept: true })` + surrounding `sep()` calls into the Select submenu |

---

## State Changes

No changes to `AppState` in `src/types/index.ts`. No new reducer actions. No new store.

Two pieces of new local state inside `LayerPanel`:

```ts
const [filterQuery,   setFilterQuery]   = useState<string>('')
const [isFilterOpen,  setIsFilterOpen]  = useState<boolean>(false)
```

`filterQuery` is the raw text the user typed. `isFilterOpen` controls whether the bar occupies vertical space. The bar collapses (`isFilterOpen = false`) when both unfocused and empty; it stays visible when unfocused but non-empty (per spec §8–9).

---

## New Components / Hooks / Tools

None. The feature lives entirely inside the existing `LayerPanel` panel component and the thin wiring in its ancestors. No new files.

---

## Implementation Steps

### Step 1 — `LayerPanelProps`: add two new props

```ts
interface LayerPanelProps {
  // … existing props …
  activeTabId?: string       // used to reset filter on tab switch
  findLayersTrigger?: number // incremented each time "Find Layers" is invoked
}
```

`activeTabId` is already on `RightPanelProps`; it just needs to be threaded one level deeper.

### Step 2 — `LayerPanel`: local state + refs

```ts
const [filterQuery,  setFilterQuery]  = useState<string>('')
const [isFilterOpen, setIsFilterOpen] = useState<boolean>(false)
const filterInputRef = useRef<HTMLInputElement>(null)
```

### Step 3 — `LayerPanel`: reset filter on tab switch

```ts
useEffect(() => {
  setFilterQuery('')
  setIsFilterOpen(false)
}, [activeTabId])
```

This satisfies the spec requirement that switching tabs always resets the filter.

### Step 4 — `LayerPanel`: open + focus on trigger

```ts
useEffect(() => {
  if (!findLayersTrigger) return   // skip initial render (trigger starts at 0)
  setIsFilterOpen(true)
  // Use rAF to ensure the bar has expanded before focusing
  requestAnimationFrame(() => { filterInputRef.current?.focus() })
}, [findLayersTrigger])
```

Each time `findLayersTrigger` increments the bar opens (without clearing the current query) and the input is focused. If the input is already focused the effect simply re-focuses, which is a no-op.

### Step 5 — `LayerPanel`: `filteredRows` derived list

Add a second `useMemo` that runs after `treeRows`:

```ts
const filteredRows: TreeRow[] = useMemo((): TreeRow[] => {
  if (!filterQuery) return treeRows

  const q           = filterQuery.toLowerCase()
  const layerMap    = new Map(layers.map(l => [l.id, l]))

  // ── Pass 1: collect direct name-match IDs ──────────────────────────────
  const nameMatchIds = new Set(
    layers.filter(l => l.name.toLowerCase().includes(q)).map(l => l.id)
  )

  // ── Pass 2: compute visible IDs ────────────────────────────────────────
  const visibleIds = new Set<string>()

  // Recursively mark all descendants of a group as visible.
  // Called when the group's own name matched.
  function markAllDescendants(group: GroupLayerState): void {
    for (const childId of group.childIds) {
      visibleIds.add(childId)
      const child = layerMap.get(childId)
      if (child && isGroupLayer(child)) markAllDescendants(child)
    }
  }

  // Returns true if any layer in this group's subtree name-matches.
  function subtreeHasMatch(group: GroupLayerState): boolean {
    for (const childId of group.childIds) {
      if (nameMatchIds.has(childId)) return true
      const child = layerMap.get(childId)
      if (child && isGroupLayer(child) && subtreeHasMatch(child)) return true
    }
    return false
  }

  // Walk every non-mask/non-adjustment layer; mask/adj children are handled below.
  for (const layer of layers) {
    if ('type' in layer && (layer.type === 'mask' || layer.type === 'adjustment')) continue

    if (nameMatchIds.has(layer.id)) {
      visibleIds.add(layer.id)
      // A matching group surfaces all its descendants (spec §"group's name matches").
      if (isGroupLayer(layer)) markAllDescendants(layer)
    } else if (isGroupLayer(layer) && subtreeHasMatch(layer)) {
      // A group with at least one matching descendant stays visible (spec §"group must remain visible").
      visibleIds.add(layer.id)
    }
  }

  // Mask / adjustment children are always shown alongside their visible parent pixel layer.
  for (const layer of layers) {
    if ('type' in layer && (layer.type === 'mask' || layer.type === 'adjustment')) {
      const parentId = (layer as MaskLayerState | AdjustmentLayerState).parentId
      if (visibleIds.has(parentId)) visibleIds.add(layer.id)
    }
  }

  return treeRows.filter(row => visibleIds.has(row.layer.id))
}, [treeRows, filterQuery, layers])
```

Replace every reference to `treeRows` in the JSX render with `filteredRows`. The existing tree walk logic (`treeRows` `useMemo`) is untouched.

**Edge cases covered by the algorithm:**

| Scenario | Behaviour |
|---|---|
| Empty query | `filteredRows === treeRows` (early return) |
| No matches | `filteredRows` is empty; render empty state (see Step 6) |
| Group name matches | `markAllDescendants` adds all children recursively |
| Child inside matching group, group is collapsed | Group row is shown (collapsed); children are hidden by the existing collapse toggle, not by the filter |
| Mask/adj child whose pixel parent matches | Added in Pass 2 |
| Active layer hidden by filter | Permitted by spec; active layer does not change |
| Layer renamed while filter active | `layers` changes → `treeRows` recomputes → `filteredRows` recomputes automatically |
| Whitespace-only query | Treated as non-empty; only layers whose name contains a space are shown |

### Step 6 — `LayerPanel`: filter bar JSX

Insert the following between the lock row and the layer list (`<ul className={styles.list}`):

```tsx
{/* ── Filter bar ─────────────────────────────────────────────── */}
<div
  className={[
    styles.filterBar,
    isFilterOpen                        ? styles.filterBarOpen   : '',
    isFilterOpen && filterQuery !== ''  ? styles.filterBarActive : '',
  ].join(' ')}
>
  <span className={styles.filterIcon} aria-hidden="true">
    {/* 12×12 magnifier SVG inline */}
  </span>
  <input
    ref={filterInputRef}
    type="text"
    className={styles.filterInput}
    placeholder="Find layers…"
    value={filterQuery}
    onChange={(e) => {
      setFilterQuery(e.target.value)
      if (e.target.value !== '') setIsFilterOpen(true)
    }}
    onFocus={() => setIsFilterOpen(true)}
    onBlur={() => {
      // Collapse only when both unfocused AND empty
      if (filterQuery === '') setIsFilterOpen(false)
    }}
    onKeyDown={(e) => {
      if (e.key === 'Escape') {
        setFilterQuery('')
        setIsFilterOpen(false)
        filterInputRef.current?.blur()
      }
    }}
    aria-label="Filter layers by name"
  />
  {filterQuery !== '' ? (
    <button
      className={styles.filterClearBtn}
      tabIndex={-1}
      aria-label="Clear filter"
      onMouseDown={(e) => e.preventDefault()} // prevent blur before click
      onClick={() => {
        setFilterQuery('')
        filterInputRef.current?.focus()
      }}
    >×</button>
  ) : (
    <span className={styles.filterClearPlaceholder} aria-hidden="true" />
  )}
</div>
```

When `filteredRows` is non-empty, render the existing list. When `filterQuery !== ''` and `filteredRows.length === 0`, render an empty-state placeholder (centered text "No layers match" — no icon or badge required by the spec, but the design prototype shows one; implement at the developer's discretion).

When `filterQuery !== ''` and `filteredRows.length > 0`, optionally show a count badge in the panel footer (design prototype shows `"3 of 12"` style badge). This is cosmetic and may be deferred.

### Step 7 — `LayerPanel.module.scss`: filter bar styles

Follow the design prototype (see `docs/designs/find-layers.html`):

```scss
.filterBar {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  flex-shrink: 0;
  height: 0;
  padding: 0;
  border-bottom: none;
  background: var(--color-surface);
  transition: height 80ms ease, padding 80ms ease;
}

.filterBarOpen {
  height: 28px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border);
}

.filterInput {
  flex: 1;
  min-width: 0;
  height: 20px;
  padding: 0 4px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-light);
  border-radius: 2px;
  color: var(--color-text);
  font-size: 11px;
  outline: none;

  &:focus {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px rgba(6, 153, 251, 0.3);
  }
}

// When filter is open AND has text, tint input background
.filterBarActive .filterInput {
  border-color: rgba(6, 153, 251, 0.45);
  background: rgba(6, 153, 251, 0.06);
}

.filterClearBtn {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 50%;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0;
  font-size: 10px;
  line-height: 1;

  &:hover {
    background: rgba(255, 255, 255, 0.16);
    color: var(--color-text);
  }
}

.filterClearPlaceholder {
  flex-shrink: 0;
  width: 16px;
}
```

### Step 8 — `RightPanel.tsx`: forward new props

Add to `RightPanelProps`:

```ts
findLayersTrigger?: number
```

`activeTabId` is already on `RightPanelProps`. Add `findLayersTrigger` and forward both to `LayerPanel`:

```tsx
<LayerPanel
  {/* … existing props … */}
  activeTabId={activeTabId}
  findLayersTrigger={findLayersTrigger}
/>
```

### Step 9 — `App.tsx`: trigger state + handler + IPC case

Add one new piece of state:

```ts
const [findLayersCounter, setFindLayersCounter] = useState(0)
```

Add a handler:

```ts
const handleFindLayers = useCallback((): void => {
  setFindLayersCounter(c => c + 1)
}, [])
```

Wire into `useKeyboardShortcuts`:

```ts
useKeyboardShortcuts({
  // … existing …
  handleFindLayers,
})
```

Add to the IPC switch in `macMenuHandlerRef.current`:

```ts
case 'findLayers': handleFindLayers(); break
```

Pass to `TopBar`:

```tsx
<TopBar
  {/* … existing … */}
  onFindLayers={handleFindLayers}
/>
```

Pass to `RightPanel`:

```tsx
<RightPanel
  {/* … existing … */}
  findLayersTrigger={findLayersCounter}
/>
```

### Step 10 — `TopBar.tsx`: Select items

Add `onFindLayers?` to `TopBarProps`:

```ts
onFindLayers?: () => void
```

Add to the destructuring parameter list and to the `useMemo` dependency array.

Update the Select items array (currently ends with `Invert Selection`):

```ts
{ label: 'Deselect Layers',                                               action: onDeselectLayers },
{ separator: true, label: '' },
{ label: 'Find Layers', shortcut: 'Alt+Shift+Ctrl+F',                    action: onFindLayers },
{ separator: true, label: '' },
{ label: 'Invert Selection', shortcut: 'Ctrl+Shift+I',                   action: onInvertSelection },
```

### Step 11 — `electron/main/menu.ts`: Select submenu

Replace the current Select submenu block:

```ts
// Select
{
  label: 'Select',
  submenu: [
    item('All',              'selectAll',        { accelerator: 'CmdOrCtrl+A',               noIntercept: true }),
    item('Deselect',         'deselect',         { accelerator: 'CmdOrCtrl+D',               noIntercept: true }),
    sep(),
    item('All Layers',       'selectAllLayers',  { accelerator: 'Alt+CmdOrCtrl+A',           noIntercept: true }),
    item('Deselect Layers',  'deselectLayers'),
    sep(),
    item('Find Layers',      'findLayers',       { accelerator: 'Alt+Shift+CmdOrCtrl+F',     noIntercept: true }),
    sep(),
    item('Invert Selection', 'invertSelection',  { accelerator: 'CmdOrCtrl+Shift+I',         noIntercept: true }),
  ],
},
```

`noIntercept: true` is required because `Alt+Shift+CmdOrCtrl+F` must be handled by the renderer (via `useKeyboardShortcuts`), not consumed by Electron's native accelerator.

### Step 12 — `useKeyboardShortcuts.ts`: keyboard handler

Add to `UseKeyboardShortcutsOptions`:

```ts
handleFindLayers?: () => void
```

Add to the destructured parameters and to the `useEffect` dependency array.

Add a branch inside `onKey`, after the `if (!e.ctrlKey && !e.metaKey) return` guard but alongside the other `Ctrl/Cmd` combos:

```ts
else if (e.key === 'f' && e.altKey && e.shiftKey) { e.preventDefault(); handleFindLayers?.() }
```

The existing guard at line 52:

```ts
if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
```

already ensures this shortcut does **not** fire when the filter input (or any other `<input>`) is focused. No additional `stopPropagation` is needed on the filter input itself.

---

## Architectural Constraints

- **Filter is local panel state** — the query does not affect undo, serialization, canvas rendering, or any other hook. Keeping it in `LayerPanel` local state is correct per AGENTS.md: "The filter is not part of `AppState`".
- **No new files** — the filter bar is panel-level UI; it belongs inside `LayerPanel` (`panels/`), which already reads from `AppContext`. AGENTS.md: "one component per folder".
- **`LayerPanel` is a panel** — it may read `AppContext` directly. It must not be re-categorized or split to accommodate this feature.
- **`filteredRows` replaces `treeRows` in the render loop only** — `treeRows` is still computed as before and is still the source of truth for all non-render logic (drag-and-drop targets, `displayActiveId`, etc.). Drag-and-drop should operate on `treeRows` (the full unfiltered list) rather than `filteredRows`, to avoid confusing reorder behaviour while a filter is active.
- **Escape key** — the filter input's `onKeyDown` Escape handler fires before the global `keydown` listener because `onKeyDown` on a focused `<input>` targets the element directly and the global listener bails at the `e.target instanceof HTMLInputElement` guard. No conflict.
- **Tab reset via `activeTabId` prop** — the `useEffect(() => { … }, [activeTabId])` pattern correctly resets local state when the tab changes, matching the same guard used elsewhere in the codebase.

---

## Open Questions

1. **Empty-state placeholder** — The spec says "no error or placeholder message is required" when there are no matches, but the design prototype shows a centred message. Should one be implemented? If yes, is the design prototype copy ("No layers match") final?
2. **Filter count badge in footer** — The design shows a `"3 of 12"` style badge in the panel footer when the filter is active. The spec does not mention it. Implement or defer?
3. **Collapsed groups with matching children** — The spec says: "If a child matches but the group is collapsed, the group row is surfaced (expanded in the filtered view or shown as a collapsed row)." The algorithm above shows the group row as collapsed (the existing `collapsed` toggle is not overridden). Should the filtered view force-expand groups that contain a match, or is showing them collapsed acceptable? This needs a product decision before implementation.
4. **Drag-and-drop while filtered** — The design does not specify whether dragging should be allowed while a filter is active. The safe default is to disable dragging (`draggable={false}`) on all rows while `filterQuery !== ''`, to avoid confusing reorder results on the filtered subset. Confirm this is acceptable.
