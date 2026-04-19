# Swatches Panel: Scrolling and Hue Grouping

## Overview

The Swatches panel displays the user's saved color palette as a grid of color chips. As a palette grows it can become unwieldy in a fixed-height panel, and colors that were added at different times are visually scattered regardless of their relationship to one another. This spec covers two complementary improvements: constraining the grid to a scrollable region so the rest of the panel stays usable at any palette size, and automatically grouping swatches by hue so visually related colors sit together without requiring the user to organize them manually.

---

## Feature 1 – Scrollable Swatch Grid

### User Interaction

1. The user opens the **Swatches** tab in the right panel's color section.
2. When the palette contains only a few colors (roughly four rows or fewer), the grid renders at its natural height — no scroll affordance is shown.
3. When the palette grows beyond the visible area, a vertical scrollbar appears inside the grid region. The user can scroll through the palette without the panel growing taller.
4. The tab row (Color / Swatches / Navigator tabs and the panel-options menu button) remains fully visible and non-scrolling at all times, regardless of how large the palette becomes.

### Functional Requirements

- The swatch grid container must have a maximum height that accommodates approximately 4–6 rows of swatches before overflow becomes active (given the current 18 px swatch size and 4 px gap, this is roughly 110–160 px).
- Vertical overflow must be set to `auto` (scrollbar appears only when content overflows, not always visible).
- Horizontal overflow must not produce a scrollbar; rows must wrap within the container width as they do today.
- The tab row and any future panel action buttons must sit outside the scrollable container and must not scroll.
- The empty-state message ("No swatches yet…") must be visible without scrolling when the palette is empty.

### Acceptance Criteria

- With ≤ ~4 rows of swatches, the panel does not show a scrollbar and the grid height matches its content.
- With > 4 rows of swatches, a vertical scrollbar appears and the tab row above it does not move or clip.
- Scrolling does not affect or reflow the tab row, the divider, or the Layers section below it.
- All swatch interactions (click to set foreground color, right-click to remove) work correctly for swatches that are reached by scrolling.
- Keyboard navigation (Tab, arrow keys) within the scrollable grid does not break; focused swatches that are out of view scroll into view automatically via the browser's default focus-scroll behavior.

### Edge Cases & Constraints

- The max-height value should be expressed in a way that accommodates the actual swatch cell dimensions (size + gap) so that rows do not clip mid-cell.
- On very narrow right-panel widths, fewer swatches fit per row; the max-height cap applies to the container height, not the row count, so the visible row count will vary with panel width.
- The scrollbar must not overlap or obscure swatch cells; sufficient right padding inside the scroll container should be maintained when the scrollbar is visible.

---

## Feature 2 – Automatic Swatch Grouping by Hue

### Overview

When the Swatches tab is displayed, swatches are rendered in a sorted order that places visually similar hues next to each other. The sort is purely presentational — it does not alter the canonical order in which swatches were added or affect any other part of the application.

### User Interaction

1. The user opens the **Swatches** tab.
2. Without any explicit action, they observe that the palette is laid out with chromatic colors grouped by hue family (reds together, yellows together, greens together, cyans, blues, magentas/purples, oranges) and neutral colors (blacks, whites, grays) placed together in a distinct region.
3. When the user adds a new color via the Color Picker, it is inserted into the palette store and appears in the grid at its sorted position relative to its hue — not appended at the end.
4. When the user right-clicks and removes a swatch, the remaining swatches re-sort and close the gap.
5. No group labels, dividers, or category names are displayed — the grouping is communicated through proximity alone.

### Functional Requirements

- Swatches must be sorted into hue-based groups before rendering. The sort must be applied on the displayed view only; the underlying swatch array in application state must remain in insertion order.
- The hue grouping order must follow the natural spectral sequence: **reds → oranges → yellows → yellow-greens → greens → cyans → blues → blue-violets → magentas/purples → reds** (wrapping). The specific degree boundaries used to assign a swatch to a group are an implementation detail, but the visual result must be a recognisable rainbow-ordered layout.
- Within each hue group, swatches must be sorted by **lightness**, from darkest to lightest (or lightest to darkest, as long as the direction is consistent across all groups). This gives each hue group a gradient-like appearance.
- Neutral colors — those with saturation below a defined threshold (e.g. HSL saturation < ~15%) — must be separated from chromatic colors and grouped together. Placement of the neutral group is at the start or end of the grid.
- Within the neutral group, swatches must be ordered by lightness (black → dark grays → light grays → white, or the reverse).
- Fully transparent swatches (alpha = 0) may be placed at the end of the sorted list or handled as a distinct edge case.
- The sorting algorithm must be stable for equal hue/lightness values so that the rendered order is deterministic.

### Acceptance Criteria

- The default palette (18 swatches including black, white, two grays, red/dark-red, yellow/dark-yellow, green/dark-green, cyan/dark-cyan, blue/dark-blue, magenta/dark-magenta, orange, and a skin tone) renders with all neutral chips adjacent to each other and all chromatic chips ordered by hue family.
- Adding a bright red swatch causes it to appear near other reds, not at the end of the grid.
- Adding a mid-gray swatch causes it to appear between the lighter and darker grays in the neutral group.
- Removing a swatch does not disrupt the sorted grouping of the remaining swatches.
- The underlying swatch list in application state is unaffected by the display sort; undo/redo of swatch changes operates on insertion-order state correctly.

### Edge Cases & Constraints

- Very-low-saturation colors near the hue boundary between two chromatic families (e.g. a near-neutral brownish orange) may appear in either the neutral group or an adjacent chromatic group depending on the saturation threshold chosen. This is acceptable.
- The saturation threshold for "neutral" classification must not be so aggressive that obviously vivid pastel colors are treated as neutral.
- Colors with alpha < 255 (semi-transparent swatches) are sorted using only their RGB hue/lightness; the alpha value does not affect sort position.
- When the palette contains swatches from only one hue family, no gaps or separators should appear — the grid remains continuous.

---

## Related Features

- [docs/specifications/adjustment-menu.md](adjustment-menu.md) — color-related interaction context
- [docs/specifications/color-grading.md](color-grading.md) — related color management surface
