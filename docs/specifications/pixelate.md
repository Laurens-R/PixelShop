# Pixelate

## Overview

**Pixelate** is a destructive filter that divides the active pixel layer into a uniform grid of rectangular blocks and replaces every pixel in each block with a single solid color — the average color of all pixels in that block. The result is a mosaic or "big pixel" appearance commonly used for privacy masking, retro-styled effects, or stylistic abstraction. The operation is undoable via the standard undo history.

## User Interaction

1. The user ensures the target pixel layer is active in the Layer Panel.
2. The user selects **Filters → Pixelate…** from the menu bar. If the active layer is not a pixel layer, the menu item is grayed out and cannot be selected.
3. The **Pixelate** dialog opens. The canvas immediately shows the layer's current (unmodified) pixels.
4. The dialog presents two controls:
   - **Pixel Size** — an integer slider and numeric input. The minimum value is 2. The maximum value is computed dynamically as `floor(min(imageWidth, imageHeight) / 2)` at the moment the dialog opens. The default value is 10 (or the computed maximum if the canvas is very small).
   - **Snap to Grid** — a toggle (checkbox or switch). When enabled, the Pixel Size slider is constrained to values that are common divisors of both the image width and the image height, ensuring every block aligns perfectly with the image boundary. When disabled, the slider accepts any integer in the full 2–max range.
5. As the user adjusts the Pixel Size slider or changes the Snap toggle, a pixelated preview appears on the canvas after a short debounce delay — not on every incremental movement.
6. If an active selection is present, an informational note in the dialog indicates that the filter will apply only within the selected area.
7. The user clicks **Apply** to commit the filter, or **Cancel** (or presses Escape) to discard the preview and leave the layer unchanged.

## Functional Requirements

- The **Pixelate…** menu item **must** appear under **Filters** in the menu bar. It **must** be disabled when the active layer is not a pixel layer (adjustment layer, mask, text, shape, or no layer selected).
- The dialog **must** expose a **Pixel Size** control: integer, minimum 2, maximum `floor(min(imageWidth, imageHeight) / 2)`. The maximum **must** be computed from the active layer's pixel dimensions when the dialog opens. Both a slider and a numeric input **must** be present and kept in sync.
- Values entered outside the allowed range **must** be clamped: values below 2 are set to 2; values above the computed maximum are clamped to that maximum.
- The dialog **must** expose a **Snap to Grid** toggle, defaulting to off.
- When **Snap to Grid** is **off**, the Pixel Size control accepts any integer in the range [2, max].
- When **Snap to Grid** is **on**, the Pixel Size control **must** restrict its valid values to only the common divisors of the image width and height that fall within the range [2, max]. If the current Pixel Size is not a common divisor when the snap toggle is turned on, it **must** be snapped to the nearest valid common divisor.
- When **Snap to Grid** is **on** and there are no common divisors ≥ 2 for the image dimensions (e.g. the image is a prime × prime canvas), the toggle **must** be disabled and **must** display a tooltip or note explaining that no valid snap values exist for this image size.
- The canvas **must** display a live pixelated preview while the dialog is open. This preview **must** be debounced — it is applied only after the user has settled on a value, not on every incremental control change.
- The preview **must** reflect the filter result as it will appear when applied. It **must not** affect the actual layer pixel data until the user clicks **Apply**.
- Each block **must** be filled with the average RGBA color of all source pixels in that block. When the alpha channel is included in the average, fully transparent pixels contribute to the average; the result faithfully represents transparency within the block.
- When **Snap to Grid** is **off**, blocks that extend beyond the right or bottom edge of the image (or active selection) **must** still be processed: only the pixels that fall within the image (or selection) boundary are sampled and replaced. Partial blocks are valid and **must not** be skipped or clipped to zero size.
- Clicking **Apply** **must** permanently write the pixelated pixels back to the active layer, close the dialog, and record exactly one undo history entry. Pressing Ctrl+Z (or Cmd+Z on macOS) **must** restore the layer's pixel data to its exact pre-filter state.
- Clicking **Cancel** or pressing Escape **must** close the dialog, restore the canvas to its pre-dialog appearance, and record no undo history entry.
- If an active selection exists, only pixels within the selection boundary **must** be pixelated; pixels outside the selection **must** remain unmodified. The selection boundary is evaluated at the moment **Apply** is clicked. Block boundaries are still determined relative to the full layer origin (not the selection bounding box), so grid alignment is consistent with the overall layer grid.
- If no active selection exists, the filter **must** be applied to every pixel on the active layer.
- The filter **must not** affect any layer other than the currently active pixel layer, even if other layers are visible.

## Acceptance Criteria

- With a pixel layer active, **Filters → Pixelate…** is enabled and opens the dialog.
- With a non-pixel layer active (or no layer), the menu item is grayed out and clicking it does nothing.
- The Pixel Size slider minimum is 2 and the maximum equals `floor(min(imageWidth, imageHeight) / 2)` for the active layer.
- Typing 1 in the Pixel Size input clamps to 2; typing a value above the computed maximum clamps to that maximum.
- After the user stops moving the slider, the canvas updates to show a pixelated preview within the debounce window.
- The canvas does not update on every pixel of slider drag — it waits for the user to settle.
- With **Snap to Grid** off, setting Pixel Size to a value that does not divide the image width evenly still produces a valid preview with partial blocks at the right and bottom edges.
- With **Snap to Grid** on, the slider only lands on values that divide both the image width and image height exactly; no partial blocks are visible at the image edges.
- Enabling **Snap to Grid** while the current Pixel Size is not a common divisor snaps the Pixel Size to the nearest valid common divisor automatically.
- On a canvas whose dimensions share no common divisor ≥ 2, the **Snap to Grid** toggle is disabled.
- Clicking **Apply** modifies the layer's pixel data (uniform colored blocks visible on the layer) and closes the dialog.
- Clicking **Cancel** leaves the layer's pixel data byte-for-byte identical to its pre-dialog state.
- Pressing Escape while the dialog is open produces the same result as clicking **Cancel**.
- Pressing Ctrl+Z / Cmd+Z once after **Apply** restores the layer's pixel data exactly to its pre-filter state.
- With a rectangular or freeform selection active, **Apply** pixelates only the pixels inside the selection; pixels outside are unchanged.
- With no active selection, **Apply** pixelates the entire layer.

## Edge Cases & Constraints

- A Pixel Size of 2 produces the finest available mosaic — 2×2 blocks. It is a valid input and **must** be applied without error.
- The computed maximum Pixel Size changes with canvas dimensions. On a 100×200 px canvas the maximum is 50; on a 800×600 px canvas it is 300. The dialog reads these dimensions at open time; they do not change while the dialog is open.
- When the active selection is smaller than one block, the pixelation is still applied to whatever pixels fall inside the selection. This may produce a single solid block filling the entire selection area.
- Applying the filter to a fully transparent layer is valid and produces no visible change, but still records an undo history entry when **Apply** is clicked.
- The Pixelate dialog is modal — the menu bar and canvas are not interactive while the dialog is open.
- Pixelate is **not** re-editable after commit. Once applied, the original pixel data cannot be recovered except via undo.
- Block boundaries are always aligned to the layer's top-left corner origin, not to the active selection's bounding box. This keeps the grid position stable regardless of selection placement.
- The Snap toggle operates on the full layer dimensions, not the selection dimensions. This ensures grid alignment remains globally consistent even when a selection is active.

## Out of Scope

- **Non-square blocks** — only square blocks (uniform width and height) are supported. Rectangular blocks with independent width/height controls are not part of this feature.
- **Non-average color sampling** — only the arithmetic mean (average) of source pixel colors is used. Median, mode, or dominant-color sampling methods are not included.
- **Non-destructive pixelate layer** — a filter layer that stores the block size and re-applies on render is a separate, future feature.
- **Animated or time-varying pixelation** — applying a changing pixel size across frames or time is not supported.
- **Applying the filter to multiple layers simultaneously** — the filter always targets the single active layer.

## Related Features

- [filters-menu.md](filters-menu.md) — the Filters menu that hosts this item and defines the shared enable/disable rules
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline used when a selection is active to isolate which pixels are modified
