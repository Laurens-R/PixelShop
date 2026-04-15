# Filters Menu

## Overview

The **Filters** menu is a top-level entry in the menu bar that provides access to destructive pixel-processing operations. Unlike the **Image** menu (non-destructive adjustment layers), filters permanently rewrite the pixel data of the active layer and record one undo history entry per application. The menu gives users a single, extensible entry point for operations such as blur, sharpen, and noise — effects that are intentionally baked into the layer rather than stored as reversible child layers.

## User Interaction

1. The user ensures the target pixel layer is active in the Layer Panel.
2. The user clicks **Filters** in the menu bar. The menu appears immediately after the **Image** menu.
3. If the active layer is not a pixel layer (or no layer is active), every item in the menu is grayed out. The menu still opens but no item can be selected.
4. The user clicks a filter item — for example, **Gaussian Blur…**. The menu closes.
5. A modal dialog opens, presenting the controls specific to that filter (e.g., a radius slider for Gaussian Blur). The canvas may show a live preview while the user adjusts controls.
6. The user clicks **Apply** (or equivalent confirm action) to commit the operation. The dialog closes, the active layer's pixel data is permanently updated, and one undo history entry is recorded.
7. Alternatively, the user clicks **Cancel** or presses Escape to dismiss the dialog without any change to the layer.
8. Undoing (Ctrl+Z) after an applied filter restores the layer's pixel data to its exact pre-filter state.

## Functional Requirements

- The **Filters** menu **must** appear as a top-level entry in the menu bar, positioned immediately after the **Image** menu.
- Each available filter **must** appear as a distinct item in the Filters menu.
- Filter items that open a configuration dialog **must** be suffixed with an ellipsis ("…") in their label.
- Clicking an enabled filter item **must** open a modal dialog for that filter; the menu bar and canvas must not be interactive while the dialog is open.
- Clicking **Apply** in a filter dialog **must** permanently overwrite the active pixel layer's pixel data and record exactly one undo history entry.
- Clicking **Cancel** or pressing Escape **must** dismiss the dialog with no change to the layer and no undo history entry.
- All Filters menu items **must** be disabled (grayed out, not interactive) when:
  - No layer is active, or
  - The active layer is an adjustment layer, or
  - The active layer is a mask layer, or
  - The active layer is a text or shape layer.
- The initial release of the Filters menu **must** contain exactly one item: **Gaussian Blur…**.
- The menu structure **must** be extensible: new filter types can be added to the menu definition without changes to the menu component itself.

## Acceptance Criteria

- With a pixel layer active, all Filters menu items are enabled and clickable.
- With an adjustment layer, mask layer, text layer, or shape layer active, all items are grayed out and produce no action when clicked.
- With no layer active at all, all items are grayed out.
- Clicking **Gaussian Blur…** opens a modal dialog and closes the Filters menu.
- Cancelling the Gaussian Blur dialog leaves the layer's pixel data byte-for-byte identical to its pre-dialog state.
- Applying the Gaussian Blur dialog permanently modifies the layer's pixel data (visible change on canvas) and records one undo entry.
- Pressing Ctrl+Z after applying a filter restores the layer's pixel data exactly to its pre-filter state.
- The **Filters** menu appears visually to the right of the **Image** menu in the menu bar.
- Filter item labels that open a dialog end with "…".

## Edge Cases & Constraints

- If an active selection exists when a filter is applied, the filter operation **must** be confined to the selected pixels; pixels outside the selection are not modified.
- Filters operate only on the currently active layer; they do not affect other layers, even if those layers are visible.
- Applying a filter to a fully transparent layer is valid and produces no visible change but still records an undo entry.
- There is no preview outside the filter's own dialog; the canvas returns to its pre-filter appearance if the dialog is cancelled.
- Undo removes the entire filter application as a single step, regardless of how many control adjustments were made inside the dialog before committing.

## Out of Scope

- **Non-destructive filters / filter layers** — filters in this menu always permanently modify pixel data. A non-destructive filter layer type is a separate, future feature.
- **Smart filters** (re-editable filter parameters after commit) — not supported; once applied, filter parameters are not stored.
- **Batch processing** — applying a filter to multiple layers or multiple documents simultaneously is not part of this feature.
- **Filter previews outside the dialog** — the main canvas does not update until Apply is clicked; live preview (if any) is contained within the filter dialog itself.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the **Image** menu (non-destructive adjustments) that the Filters menu is placed next to; shares the same enabled/disabled rules with respect to active layer type
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline that may be involved in filter output for flatten/export consistency
