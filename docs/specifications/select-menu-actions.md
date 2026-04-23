# Select Menu Actions

## Overview

The **Select** top menu provides quick commands for managing both the pixel selection (the marquee region tracked by the selection store) and the layer selection (the set of layers highlighted in the Layers panel). Four new items — **All**, **Deselect**, **All Layers**, and **Deselect Layers** — are added above the existing **Invert Selection** item, matching the Photoshop Select menu convention. Together these commands let users jump to common selection states without touching the Marquee or Lasso tools, and select or deselect all layers in one keystroke.

## User Interaction

### Pixel selection commands

1. The user opens the **Select** menu from the top menu bar.
2. The first two items are **All** and **Deselect**, separated from the layer commands below by a visual divider.

**All (Ctrl+A / Cmd+A on macOS)**

3. The user clicks **All** (or presses the keyboard shortcut).
4. The entire canvas area becomes the active pixel selection.
5. The marching-ants overlay appears as a rectangle exactly at the canvas border, confirming all pixels are selected.
6. Any previously active selection is replaced.

**Deselect (Ctrl+D / Cmd+D)**

3. The user clicks **Deselect** (or presses the keyboard shortcut).
4. The active pixel selection is cleared entirely.
5. The marching-ants overlay disappears.
6. Pixel operations (painting, filters, adjustments) now affect the full layer again.

### Layer selection commands

7. Below the pixel-selection group, a second visual divider separates the layer commands.

**All Layers (Alt+Ctrl+A / Alt+Cmd+A on macOS)**

8. The user clicks **All Layers** (or presses the keyboard shortcut).
9. Every layer currently listed in the Layers panel — including layers inside groups — becomes selected (highlighted in the panel).
10. Bulk layer operations (merge selected, delete, group) now act on all layers.

**Deselect Layers (no shortcut)**

11. The user clicks **Deselect Layers**.
12. All layer highlighting in the Layers panel is cleared; no layers are selected.
13. The active layer (the one targeted by paint and filter operations) is unaffected — it remains active.

### Menu layout

The full Select menu reads top to bottom:

| Position | Item | Shortcut |
|---|---|---|
| 1 | All | Ctrl+A (Cmd+A) |
| 2 | Deselect | Ctrl+D (Cmd+D) |
| — | *separator* | |
| 3 | All Layers | Alt+Ctrl+A (Alt+Cmd+A) |
| 4 | Deselect Layers | — |
| — | *separator* | |
| 5 | Invert Selection | Ctrl+Shift+I |

## Functional Requirements

- The Select menu **must** contain the items **All**, **Deselect**, **All Layers**, **Deselect Layers**, and **Invert Selection** in that order with separators as described above.
- **All** **must** replace the current pixel selection with a full-canvas rectangular selection covering every pixel from (0, 0) to (canvasWidth−1, canvasHeight−1). It **must not** modify `selectedLayerIds`.
- **Deselect** **must** clear the current pixel selection entirely (set the selection mask to null). It **must not** modify `selectedLayerIds`.
- **All Layers** **must** populate `selectedLayerIds` with the id of every layer in the document, including layers nested inside groups. It **must not** affect the pixel selection or change which layer is active.
- **Deselect Layers** **must** set `selectedLayerIds` to an empty array. It **must not** affect the active layer or the pixel selection.
- **All** **must** be keyboard-accessible via Ctrl+A (Windows/Linux) / Cmd+A (macOS).
- **Deselect** **must** be keyboard-accessible via Ctrl+D (Windows/Linux) / Cmd+D (macOS).
- **All Layers** **must** be keyboard-accessible via Alt+Ctrl+A (Windows/Linux) / Alt+Cmd+A (macOS).
- **Deselect Layers** has no assigned keyboard shortcut.
- **Invert Selection** (Ctrl+Shift+I) **must** remain in place with its existing behavior and shortcut.
- When the canvas dimensions are not yet set (no open document), **All** and **Deselect** **should** be disabled or silently no-op; the marching-ants overlay must not be affected.
- When there are no layers in the document, **All Layers** **must** be a no-op.
- When `selectedLayerIds` is already empty, **Deselect Layers** **must** be a no-op (no error, no state change).
- When no pixel selection is active, **Deselect** **must** be a no-op (no error, no state change).

## Acceptance Criteria

- Opening the Select menu shows exactly: All, Deselect, [separator], All Layers, Deselect Layers, [separator], Invert Selection — in that order.
- Pressing Ctrl+A (Cmd+A on macOS) with a canvas open produces a full-canvas rectangle in the marching-ants overlay and sets the selection mask to fully selected.
- After **All**, pressing Ctrl+D (Cmd+D) removes the marching-ants overlay and clears the selection mask.
- After **Deselect**, applying a paint or filter operation affects the entire layer without restriction.
- Clicking **All Layers** when three layers exist causes all three layer rows in the Layers panel to appear selected (highlighted).
- Clicking **All Layers** when a document contains layers inside a group selects both the group itself and its children.
- Clicking **Deselect Layers** when layers are selected clears all highlights in the Layers panel; the active layer indicator (blue outline or checkmark) is unchanged.
- **All** and **Deselect** do not alter which layers are selected; **All Layers** and **Deselect Layers** do not alter the pixel selection mask.
- The keyboard shortcut for **All** (Ctrl+A / Cmd+A) does not conflict with the system Select-All shortcut in text input fields — the menu shortcut fires only when the canvas or menu bar is focused, not when a text input is active.
- **Invert Selection** still works via Ctrl+Shift+I and its behavior is unchanged.

## Edge Cases & Constraints

- **All with existing selection**: the previous selection is discarded and replaced with the full-canvas rectangle — no additive or subtractive modes apply here.
- **All on a canvas with no layers**: the selection is still created at the canvas dimensions. Pixel operations will simply have nothing to paint onto, which is the standard Photoshop behavior.
- **All Layers on a single-layer document**: that one layer becomes selected in the panel; the behavior is visually identical to just clicking that layer row.
- **Deselect Layers does not deactivate the active layer**: the active layer (the target of paint operations) is a separate concept from `selectedLayerIds`. Deselecting all layers in the panel does not change which layer receives brush strokes.
- **All Layers includes group layer nodes themselves**, not only leaf pixel layers. Any group that is listed as a row in the Layers panel has its id included in `selectedLayerIds`.
- **Shortcut collisions**: Ctrl+A is reserved as a global text Select-All in most platforms. Implementations must ensure the shortcut is captured only when no text field is focused, consistent with how other canvas-level shortcuts (Ctrl+Z, Ctrl+D, etc.) are handled.
- **Ctrl+D system conflict (Windows)**: on some Windows environments Ctrl+D is used by the browser devtools. In production Electron builds this is not an issue since devtools are not active, but developers running with devtools open should be aware.
- **No undo entries**: **All**, **Deselect**, **All Layers**, and **Deselect Layers** do not record undo history steps. Selection state is considered transient, consistent with how **Invert Selection** behaves.

## Related Features

- [filters-menu.md](filters-menu.md) — top-menu pattern (menu items, separators, disabled states) this feature follows
- [free-transform.md](free-transform.md) — another Select-menu-adjacent feature that reads and transforms the pixel selection
- [content-aware-fill-sampling.md](content-aware-fill-sampling.md) — depends on the pixel selection being active
- Layer Panel — displays the visual state of `selectedLayerIds` (highlighted rows)
