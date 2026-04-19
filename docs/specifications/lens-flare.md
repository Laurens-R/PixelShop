# Lens Flare

## Overview

**Lens Flare** is a procedural render filter that generates a synthetic optical flare effect and places it onto a new, independent layer above the currently active layer. Because the flare lives on its own layer in Screen blend mode, it composites additively onto the image below without permanently altering any existing pixel data. The user chooses a lens type, adjusts brightness, and positions the flare center interactively before committing. The resulting layer can be repositioned, blended, or deleted at any time after the dialog closes.

## User Interaction

1. The user ensures a pixel layer is active in the Layer Panel.
2. The user selects **Filters → Render → Lens Flare…** from the menu bar. If the active layer is not a pixel layer the menu item is grayed out and cannot be selected.
3. The **Lens Flare** dialog opens. A preview thumbnail (approximately 300 × 200 px) shows the current canvas content with the flare composited over it in real time. The flare center starts at the center of the canvas.
4. The user selects a **Lens Type** from the five available options. The preview updates immediately to reflect the new lens character.
5. The user adjusts the **Brightness** slider to control the overall intensity of the flare. The preview updates after a short debounce delay.
6. To reposition the flare, the user clicks anywhere on the preview thumbnail. The cursor changes to a crosshair when hovering over the thumbnail. The click position is translated back to canvas coordinates and the preview updates immediately.
7. The user clicks **Apply** to create the flare layer, or clicks **Cancel** (or presses Escape) to close the dialog without creating any layer.

## Functional Requirements

- The **Lens Flare…** menu item **must** appear under **Filters → Render** in the menu bar. It **must** be disabled when the active layer is not a pixel layer (adjustment layer, mask, text, shape, group, or no layer selected).
- The dialog **must** expose three controls:
  - **Lens Type**: selector with five mutually exclusive options. Default is **50-300mm Zoom**.
  - **Brightness**: integer slider and numeric input, range 10–300 (inclusive), unit "%", default 100. At 100, the flare renders at neutral exposure. Values above 200 produce an overexposed bloom effect.
  - **Flare Center**: a click-to-position interaction on the preview thumbnail. The thumbnail **must** display a crosshair cursor when hovered. The default position **must** be the center of the canvas.
- The five lens types and their visual characters are:
  - **50-300mm Zoom** — large central bright spot, ring halos, chromatic fringe artifacts typical of a consumer zoom lens.
  - **35mm Prime** — tight bright core, minimal halos, small starburst. Clean and subtle.
  - **105mm Prime** — strong starburst, secondary glow ring, warm color tint.
  - **Movie Prime** — multiple hexagonal iris reflections, strong central glow. Mimics a cinematic spherical prime.
  - **Cinematic (Anamorphic)** — intense horizontal blue/teal streak spanning the full canvas width, a secondary vertical streak, multiple lens artifact orbs distributed along the horizontal axis, and high-contrast bloom. Mimics the anamorphic lens character associated with contemporary cinematic photography.
- Changing the **Lens Type** **must** update the preview immediately, without debouncing.
- Adjusting **Brightness** **must** update the preview after a debounce delay of approximately 150 ms. Rapid successive changes **must** not trigger redundant preview redraws.
- Clicking the preview thumbnail **must** reposition the flare center to the corresponding canvas coordinate and update the preview immediately.
- Values entered outside the **Brightness** range **must** be clamped: values below 10 are set to 10; values above 300 are set to 300.
- Clicking **Apply** **must**:
  - Render the full-resolution flare onto a new RGBA layer. The background of this layer **must** be fully transparent (alpha = 0) everywhere there is no flare content.
  - Name the new layer `"Lens Flare"` for all lens types except Cinematic (Anamorphic), which **must** be named `"Cinematic Lens Flare"`.
  - Set the new layer's blend mode to **Screen**.
  - Insert the new layer directly above the previously active layer.
  - Record exactly one undo history entry labeled `"Lens Flare"`. Pressing Ctrl+Z / Cmd+Z once **must** remove the newly created layer and restore the layer stack to its pre-dialog state.
  - Close the dialog.
- Clicking **Cancel** or pressing Escape **must** close the dialog without creating any layer and without recording any undo history entry.
- The preview thumbnail **must** composite the flare over a scaled-down representation of the current canvas content so the user can evaluate the flare against the actual image.
- The dialog is modal — the menu bar and canvas are not interactive while it is open.

## Acceptance Criteria

- With a pixel layer active, **Filters → Render → Lens Flare…** is enabled and opens the dialog.
- With a non-pixel layer active (or no layer), the menu item is grayed out and clicking it does nothing.
- The dialog opens with Lens Type set to **50-300mm Zoom**, Brightness at 100, and the flare center at the canvas center.
- Selecting each of the five lens types produces a visually distinct flare in the preview and does so immediately without perceptible delay.
- Moving the Brightness slider does not trigger a preview redraw on every pixel of movement — it waits for the user to settle (~150 ms).
- Clicking the preview thumbnail repositions the flare center; the crosshair moves and the preview updates to reflect the new position.
- Clicking **Apply** adds a new layer above the previously active layer. The new layer is named correctly for the selected lens type, has its blend mode set to Screen, and its pixel data contains the flare on a transparent background.
- The image visually matches the final state of the preview thumbnail after **Apply** is clicked.
- Pressing Ctrl+Z / Cmd+Z once after **Apply** removes the lens flare layer and restores the layer stack exactly to its state before the dialog was opened.
- Clicking **Cancel** leaves the layer stack byte-for-byte identical to its pre-dialog state and records no undo history entry.
- Pressing Escape while the dialog is open produces the same result as clicking **Cancel**.
- The Brightness input clamps: typing 5 results in 10; typing 500 results in 300.

## Edge Cases & Constraints

- If the active layer is very small (e.g. a 10 × 10 px layer), the flare **must** still be created at canvas dimensions — the flare layer covers the full canvas, not just the active layer's bounds.
- At Brightness = 300, some lens types will produce bloom that extends to the canvas edges or causes large areas of white. This is expected behavior.
- Clicking near the very edge of the preview thumbnail is valid. The flare center **must** be translated accurately even at the thumbnail boundary.
- The flare layer is created on a transparent RGBA background. It has no fill and will appear empty in areas with no flare content. Toggling its visibility or adjusting its opacity after the dialog closes behaves identically to any other layer.
- The dialog does not support undo inside itself — there is no way to undo a flare center repositioning while the dialog is open. The user may simply click a different position.
- The preview thumbnail is a scaled representation of the canvas for interactive use. Minor visual fidelity differences between the thumbnail preview and the full-resolution output are acceptable, provided the overall flare character, position, and intensity are accurately represented.
- If the canvas has no visible content (all layers are empty or hidden), the flare layer is still created and will be visible on its own.

## Out of Scope

- **Animating the flare** — keyframing flare position, brightness, or type over time is not supported.
- **Editing flare elements individually** — the user cannot select, move, or delete individual flare components (streaks, halos, orbs) separately after the layer is created.
- **Per-channel color controls** — adjusting the hue, saturation, or color balance of individual flare elements is not supported within this dialog.
- **NLM denoising** — unrelated to this feature.
- **Non-destructive flare layer** — once applied, the flare is baked into the layer's pixel data. Changing the lens type or brightness requires undoing and re-opening the dialog.

## Related Features

- [filters-menu.md](filters-menu.md) — the Filters menu that hosts this item and defines the shared enable/disable rules
- [noise-filmgrain-lensbur-clouds.md](noise-filmgrain-lensbur-clouds.md) — the Clouds filter, which is the other render filter under **Filters → Render**
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline that governs how the new layer composites with layers below it
