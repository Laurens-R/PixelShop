# Technical Design: Swatches Panel Scrolling and Hue Grouping

## Overview

This feature enhances the existing `SwatchPanel` component with two complementary improvements: a scrollable swatch grid that caps the panel's height while keeping the tab row and action bar fixed, and a purely presentational hue-based sort that groups visually similar colors together without altering the canonical insertion-order state in `AppContext`. Both changes are self-contained within the `Swatch/` panel folder plus a new utility module — no other layers of the architecture need to change.

---

## Affected Areas

| File | Change |
|---|---|
| `src/components/panels/Swatch/SwatchPanel.tsx` | Restructure layout into a fixed action bar + scrollable grid; apply sorted display list; wire up "Generate palette" button stub |
| `src/components/panels/Swatch/SwatchPanel.module.scss` | Add `panelBody`, `actions`, `generateBtn` styles; convert `swatchesPanel` to a capped `overflow-y: auto` scroll container; add custom scrollbar rules |
| `src/utils/swatchSort.ts` | **New file.** Pure utility: `rgbaToHsl`, `sortSwatchesByHue` — no React, no imports from the store |
| `src/components/index.ts` | No change needed — `SwatchPanel` is already exported |

---

## State Changes

None. The hue sort is applied in the render path only. The canonical `swatches: RGBAColor[]` array in `AppState` continues to hold swatches in insertion order. `ADD_SWATCH` and `REMOVE_SWATCH` actions are unchanged.

---

## New Components / Hooks / Tools

### `src/utils/swatchSort.ts` — pure utility

**Responsibility:** Convert an `RGBAColor` to HSL and return a sorted copy of a swatch array.

**Exports:**
```ts
export function rgbaToHsl(c: RGBAColor): { h: number; s: number; l: number }
export function sortSwatchesByHue(swatches: RGBAColor[]): RGBAColor[]
```

**Why a utility, not a hook:** The sort is a pure, side-effect-free transformation of an array. It requires no React lifecycle, no context, and no memoization boundary — a plain function is the right level of abstraction. The component calls it inline (wrapped in `useMemo`).

**Why not inside the component file:** Keeping color-math logic in a separate `utils/` file makes it independently testable and reusable if a second surface (e.g. a future palette generator) needs the same sort.

---

## Implementation Steps

### Step 1 — Create `src/utils/swatchSort.ts`

Implement two exported functions:

**`rgbaToHsl(c: RGBAColor): { h: number; s: number; l: number }`**

Standard RGB→HSL conversion. `h` is in `[0, 360)`, `s` and `l` are in `[0, 1]`.

**`sortSwatchesByHue(swatches: RGBAColor[]): RGBAColor[]`**

Returns a new array; does not mutate the input. Sort order:

1. Convert every swatch to HSL.
2. Classify as **neutral** when `s < 0.15`. Neutral swatches form their own group, sorted by `l` ascending (black → white). Place the neutral group **first** in the output.
3. Chromatic swatches are sorted by `h` ascending within the `[0, 360)` range. Within ties on `h`, sort by `l` ascending.
4. Fully transparent swatches (`a === 0`) are appended after all other groups.
5. Use a stable sort (`Array.prototype.sort` is stable in V8/modern engines; no special handling needed).

Hue group boundaries are implicit — no explicit bucket assignments are needed. Continuous hue-ascending order naturally clusters reds, oranges, yellows, greens, cyans, blues, and magentas together because the chromatic swatches in a typical palette have clearly separated hues.

### Step 2 — Update `SwatchPanel.tsx`

Restructure the component's JSX to match the design layout:

```
<div className={styles.panelBody}>
  <div className={styles.actions}>
    <button className={styles.generateBtn}>Generate palette</button>
  </div>
  <div className={styles.swatchGrid}>
    {/* sorted swatches */}
    {/* empty state */}
  </div>
</div>
```

Key implementation points:

- Call `useMemo(() => sortSwatchesByHue(state.swatches), [state.swatches])` to get `displaySwatches`. This avoids re-sorting on every render.
- Render `displaySwatches` in the grid. Since the display array is a resorted copy, the right-click handler must remove the swatch by **value identity** (matching `r`, `g`, `b`, `a`) to find the correct insertion-order index in `state.swatches`, not by the display index. Use `state.swatches.findIndex(s => s.r === sw.r && s.g === sw.g && s.b === sw.b && s.a === sw.a)` — this is safe because duplicate swatches are an edge case the spec does not require special handling for.
- The "Generate palette" button is **inside `SwatchPanel`**, not in `RightPanel`. The design places it as a fixed action bar at the top of the swatch panel body, above the scroll region. It belongs to the panel, not the window chrome. For this iteration, the button dispatches nothing — it is rendered as a non-functional stub with `type="button"` and a `TODO` comment. A future spec will define its behavior.

### Step 3 — Update `SwatchPanel.module.scss`

Replace the current flat `swatchesPanel` flex container with a two-level structure:

```scss
// Outer wrapper — column flex, no overflow
.panelBody {
  display: flex;
  flex-direction: column;
}

// Fixed action bar — never scrolls
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 5px 8px 4px;
  border-bottom: 1px solid vars.$color-border;
  flex-shrink: 0;
}

.generateBtn {
  font-size: vars.$font-size-xs;
  color: vars.$color-text-muted;
  background: vars.$color-surface-2;
  border: 1px solid vars.$color-border-light;
  border-radius: 16px;        // pill shape per design
  padding: 2px 9px;
  cursor: pointer;
  transition: color vars.$transition-fast,
              background vars.$transition-fast,
              border-color vars.$transition-fast;
  white-space: nowrap;

  &:hover {
    color: vars.$color-text;
    background: vars.$color-surface-hover;
    border-color: vars.$color-text-muted;
  }
}

// Scrollable grid — capped at 6 rows
.swatchGrid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px;
  padding-right: 4px;        // reserve space so scrollbar doesn't overlap cells
  // 6 rows: 6 × 18px + 5 × 4px gap + 16px vertical padding = 144px
  max-height: 144px;
  overflow-y: auto;
  overflow-x: hidden;

  &::-webkit-scrollbar        { width: 6px; }
  &::-webkit-scrollbar-track  { background: vars.$color-surface; }
  &::-webkit-scrollbar-thumb  { background: vars.$color-border-light; border-radius: 3px; }
  &::-webkit-scrollbar-thumb:hover { background: vars.$color-text-muted; }
}
```

The existing `.swatchCell`, `.swatchesEmpty` rules are retained as-is. The old `.swatchesPanel` selector is removed.

**Max-height derivation** (must be expressed in terms of cell dimensions to avoid mid-row clipping):

$$\text{max-height} = n\_\text{rows} \times 18 + (n\_\text{rows} - 1) \times 4 + 16 = 144\text{px} \quad (n=6)$$

### Step 4 — Verify `RightPanel.tsx` requires no changes

The tab row and panel options button are already rendered outside of `<SwatchPanel />` in `RightPanel.tsx` — they sit in `.tabRow` above the `{colorTab === 'Swatches' && <SwatchPanel />}` render. The new panel body's fixed action bar sits inside `SwatchPanel` but outside its scroll container, so both stay stationary during scrolling. No changes to `RightPanel.tsx` are needed.

---

## Architectural Constraints

**Panels read `AppContext` directly.** `SwatchPanel` already does this. Reading `state.swatches` and calling `dispatch` inside `SwatchPanel` is correct per the panel category rules.

**No business logic in `App.tsx` or `RightPanel.tsx`.** The sort and the action button live inside `SwatchPanel`, not inlined into the window component.

**State shape is unchanged.** The spec explicitly requires the underlying swatch array to remain in insertion order. The sort is a `useMemo` in the render path, not a state mutation. `ADD_SWATCH` / `REMOVE_SWATCH` continue to operate on the unordered array — no new reducer actions are needed.

**One `.tsx` + one `.module.scss` per folder.** The existing `Swatch/` folder already follows this convention. The utility lives in `src/utils/` alongside the existing `userFeedback.ts`, which is the right place for framework-free helpers.

**No plain `.scss` imports.** All style imports use `.module.scss` already; the new rules extend the existing module file.

---

## Open Questions

1. **"Generate palette" behavior.** The spec and design show the button but do not define what it does. This design treats it as a non-functional stub. A follow-up spec should define whether it generates swatches from the active canvas, from a reference image, or via some other algorithm.

2. **Duplicate swatch removal.** The current `REMOVE_SWATCH` action operates by array index. After hue-sorting, removing by `findIndex` on value equality will remove the first occurrence of a duplicate. If supporting intentional duplicate swatches is a requirement, the state shape should change to store swatches as `{ id: string; color: RGBAColor }[]` and `REMOVE_SWATCH` should accept an `id`. That is a separate, larger change and not in scope here.

3. **Neutral group position.** This design places neutrals first (before chromatic colors). The spec says "at the start or end." Neutrals-first is chosen here because the default palette's black/white/gray chips are the most-used quick-access colors, but this should be confirmed with the designer.
