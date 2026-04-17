# Motion Blur

## Overview

**Motion Blur** is a destructive filter that smears the pixels of the active pixel layer along a straight line of configurable direction and length, simulating the visual effect of a moving camera or subject during an exposure. The effect is baked directly into the layer's pixel data upon confirmation and is undoable via the standard undo history.

## User Interaction

1. The user ensures the target pixel layer is active in the Layer Panel.
2. The user opens **Filters → Blur → Motion Blur…** from the menu bar. If the active layer is not a pixel layer, the menu item is grayed out and cannot be selected.
3. The **Motion Blur** dialog opens as a modal dialog. The canvas immediately shows the layer's current (unmodified) pixels.
4. The dialog presents two controls:
   - **Angle** — the direction of the blur in degrees (range 0–360°). Both a slider and a numeric input are present and kept in sync. Default is 0°.
   - **Distance** — the length of the blur streak in pixels (range 1–999 px). Both a slider and a numeric input are present and kept in sync. Default is 10.
5. As the user adjusts either control, a blurred preview appears on the canvas after a short debounce delay — not on every incremental slider movement. The dialog remains open during preview.
6. The user clicks **Apply** to commit the effect permanently to the layer, or clicks **Cancel** (or presses Escape) to discard the preview and leave the layer unchanged.

## Functional Requirements

- The **Motion Blur…** menu item **must** appear under **Filters → Blur** in the menu bar. It **must** be disabled when the active layer is not a pixel layer (adjustment layer, mask, text, shape, group, or no layer selected).
- The dialog **must** be modal — the menu bar and canvas **must not** be interactive while it is open.
- The dialog **must** expose an **Angle** control: numeric range 0 to 360 (inclusive), default 0. Both a slider and a numeric input **must** be present and kept in sync.
- The dialog **must** expose a **Distance** control: integer range 1 to 999 (inclusive), default 10. Both a slider and a numeric input **must** be present and kept in sync.
- Values entered outside the allowed range **must** be clamped: Angle below 0 is set to 0; above 360 is set to 360. Distance below 1 is set to 1; above 999 is set to 999.
- The canvas **must** display a live blurred preview while the dialog is open. This preview **must** be debounced — it is applied only after the user has settled on a value, not on every incremental slider movement.
- The preview **must** reflect the blur as it will appear when applied. It **must not** affect the actual layer pixel data until the user clicks **Apply**.
- The blur algorithm **must** compute each output pixel as the unweighted average of samples taken along a line of length equal to **Distance**, centered on that pixel, oriented at **Angle** degrees. This is a box (uniform-weight) filter along the motion axis.
- Edge samples that fall outside the canvas bounds **must** clamp to the nearest valid pixel (repeat-edge / clamp-to-border mode). Pixels **must not** be sampled by wrapping around to the opposite edge.
- Clicking **Apply** **must** permanently write the blurred pixels back to the active layer, close the dialog, and record exactly one undo history entry. Pressing Ctrl+Z (or Cmd+Z on macOS) **must** restore the layer's pixel data to its exact pre-blur state.
- Clicking **Cancel** or pressing Escape **must** close the dialog, restore the canvas to its pre-dialog appearance, and record no undo history entry.
- If an active selection exists, only pixels within the selection boundary **must** be blurred; pixels outside **must** remain unmodified. The selection boundary is evaluated at the moment **Apply** is clicked.
- If no active selection exists, the blur **must** be applied to every pixel on the active layer.
- The filter **must not** affect any layer other than the currently active pixel layer.

## Acceptance Criteria

- With a pixel layer active, **Filters → Blur → Motion Blur…** is enabled and opens the dialog.
- With a non-pixel layer active (or no layer), the menu item is grayed out and clicking it does nothing.
- The Angle slider moves between 0 and 360; typing 400 clamps to 360; typing −10 clamps to 0.
- The Distance slider moves between 1 and 999; typing 0 clamps to 1; typing 1200 clamps to 999.
- After the user stops moving a slider, the canvas updates to show a blurred preview within the debounce window. The canvas does not update on every pixel of slider drag.
- A horizontal smear (Angle = 0°, Distance = 20) produces a horizontally streaked result with each pixel averaged over 20 samples along the x-axis.
- A vertical smear (Angle = 90°, Distance = 20) produces the same effect rotated 90°.
- Clicking **Apply** modifies the layer's pixel data and closes the dialog. The applied result matches the on-screen preview exactly.
- Clicking **Cancel** leaves the layer's pixel data byte-for-byte identical to its pre-dialog state.
- Pressing Escape while the dialog is open produces the same result as clicking **Cancel**.
- Pressing Ctrl+Z / Cmd+Z once after **Apply** restores the layer's pixel data to its pre-blur state.
- With an active selection, **Apply** blurs only the pixels inside the selection; pixels outside are unchanged.
- With no active selection, **Apply** blurs the entire layer.
- A pixel at the edge of the canvas is blurred using clamped edge samples, not wrapped samples from the opposite side.

## Edge Cases & Constraints

- A Distance of 1 produces a single-sample average, which is effectively no change. It is a valid input and **must** be applied without error.
- Angle values of 0° and 360° **must** produce identical results (both represent a horizontal smear).
- A large Distance value (e.g. 999) on a large canvas is computationally expensive. The debounce delay helps limit unnecessary computation during rapid slider movement.
- Fully transparent pixels (alpha = 0) are included in sampling; the blur may spread partial alpha values into previously transparent areas at layer edges — this is expected behavior.
- Applying the filter to a fully transparent layer is valid and produces no visible change, but still records an undo history entry when **Apply** is clicked.
- The Motion Blur dialog is modal — the menu bar and canvas are not interactive while it is open.
- Motion Blur is **not** re-editable after commit. Once applied, the original pixel data cannot be recovered except via undo.

## Out of Scope

- **Variable-angle blur per region** — applying different angles to different parts of the layer is not supported.
- **Zoom blur or spin blur** — these are covered by the Radial Blur filter.
- **GPU-accelerated execution** — the filter runs on the CPU.
- **Non-destructive application** — a blur filter stored as a re-editable layer is a separate, future feature.
- **Applying the filter to multiple layers simultaneously** — the filter always targets the single active layer.

## Related Features

- [filters-menu.md](filters-menu.md) — the Filters menu that hosts this item and defines the shared enable/disable rules
- [gaussian-blur.md](gaussian-blur.md) — sibling blur filter using isotropic Gaussian convolution
- [radial-blur.md](radial-blur.md) — sibling blur filter for spin and zoom effects
- [remove-motion-blur.md](remove-motion-blur.md) — the inverse operation: deconvolves a known linear motion blur
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline used when a selection is active to isolate which pixels are modified
