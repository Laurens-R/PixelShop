# Color Invert

## Overview

The **Color Invert** adjustment is a non-destructive child layer that inverts every color channel in the parent pixel layer, replacing each channel value with its complement (`output = 255 − input` per R/G/B channel). The alpha channel is left unchanged. Because the adjustment has no configurable parameters, the eye-toggle in the Layer Panel is the primary way to enable or disable the effect; the floating panel serves only as a confirmation that the adjustment layer was created and to show its parent layer. The adjustment is stored persistently and can be re-opened, hidden, or deleted at any time.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image → Color Invert** from the TopBar (no ellipsis — there are no parameters to configure). If a selection is currently active it will scope the adjustment; if none exists the whole layer is targeted.
3. A new child layer named **"Color Invert"** appears in the Layer Panel, indented directly beneath the parent layer — the same visual treatment as a layer mask. The invert effect is immediately visible on the canvas.
4. A minimal floating panel titled **"Invert"** opens, anchored to the upper-right corner of the canvas. The panel contains:
   - A title label: **"Invert"**.
   - A read-only **parent layer indicator** showing the name of the parent pixel layer this adjustment is attached to.
   - A **Close** button.
5. The user closes the panel by clicking the Close button, clicking outside the panel, or pressing Escape. One undo history entry is recorded at this moment (recording the layer creation), even though no parameters were changed.
6. The primary ongoing control for the adjustment is the **eye toggle** in the Layer Panel: hiding the Color Invert layer disables the inversion so the original colors are visible; showing it re-enables the effect.
7. To reopen the panel later, the user clicks the adjustment layer's row in the Layer Panel.
8. The adjustment layer can be deleted (trash icon / Delete key when selected) to remove it permanently.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately following its parent in the layer stack, with a `parentId` reference to the parent pixel layer.
- The parent pixel layer's pixel data **must not** be modified by this adjustment.
- The adjustment **must** be composited on top of the parent layer's pixels at render time using the formula: output R/G/B = 255 − input R/G/B per channel.
- The alpha channel **must not** be inverted; pixel transparency is preserved.
- If a selection is active when the adjustment is created, only pixels within the selection boundary **must** be affected; the selection mask is baked into the adjustment layer at creation time.
- If no selection is active, the adjustment **must** affect the entire parent layer.
- The invert effect **must** be applied and visible immediately upon layer creation, without waiting for the panel to be closed.
- The floating panel **must** contain only a title ("Invert"), a parent layer indicator, and a Close button. It **must not** contain any sliders, checkboxes, or editable controls.
- Closing the panel **must** record exactly one undo history entry, recording the layer creation event. Undoing **must** remove the adjustment layer and restore the canvas to its prior appearance.
- The adjustment layer **must** support:
  - **Visibility toggle** — hiding it restores the original color appearance; showing it re-applies the inversion.
  - **Deletion** — removes the layer and its effect permanently.
  - **Re-opening** — clicking the layer in the Layer Panel reopens the minimal panel.

## Acceptance Criteria

- Immediately after creation, every visible pixel's R, G, and B values are equal to 255 minus their original values.
- Alpha values are unchanged — pixels that were fully transparent remain transparent; pixels that were partially transparent maintain the same alpha.
- Creating the adjustment while a selection is active restricts the visible effect to that area; pixels outside it are unaffected.
- Creating the adjustment with no active selection applies the effect to the full layer.
- The floating panel contains no interactive controls other than the Close button.
- Hiding the Color Invert layer in the Layer Panel restores the original parent layer colors; showing it re-applies the inversion.
- Deleting the adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the adjustment layer entirely.
- Clicking the adjustment layer in the Layer Panel reopens the minimal panel.
- Applying a second Color Invert adjustment on the same parent layer produces a visually unchanged canvas (double inversion returns to original colors) — the two adjustments are still independent layers.

## Edge Cases & Constraints

- Fully transparent pixels (alpha = 0) remain fully transparent; their RGB channels are still inverted mathematically but are not visible.
- Double-inverting (two stacked Color Invert layers at 100% opacity on the same parent) returns the canvas to the original colors.
- Because there are no configurable parameters, there is no numeric state to restore when re-opening the panel — the panel always looks the same.
- The adjustment is not applicable to text layers, shape layers, or mask layers.
- The selection mask baked at creation time does not update if the user modifies the selection after the adjustment layer has been created.
- There is no keyboard shortcut assigned to this adjustment by default.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the menu entry that creates this adjustment
- [brightness-contrast.md](brightness-contrast.md) — example of an adjustment layer with parameters, for contrast with this parameter-free variant
- Layer Panel → Layer Masks (child-layer structure this adjustment shares)
