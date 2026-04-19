# Lens Flare

## Overview

**Lens Flare** is a procedural render filter that generates a synthetic optical flare effect and composites it onto a new, independent layer placed directly above the currently active layer. Because the flare is rendered onto its own dedicated layer — initialized as fully transparent — it never destructively modifies any existing pixel data. The user selects a lens type, adjusts overall brightness, and positions the flare center interactively inside the dialog before committing. After the layer is created the user can freely adjust its opacity, blend mode, or position using the standard layer controls, or delete it entirely.

## User Interaction

1. The user ensures a pixel layer is active in the Layer Panel.
2. The user selects **Filter → Render → Lens Flare…** from the menu bar. If the active layer is not a pixel layer the menu item is grayed out and cannot be selected.
3. The **Lens Flare** dialog opens. An interactive preview thumbnail shows the current canvas content with the flare composited over it in real time. The flare center starts at the center of the canvas.
4. The user selects a **Lens Type** from the five available options. The preview updates immediately to reflect the new lens character.
5. The user adjusts the **Brightness** slider (or types a value) to control the overall intensity of the flare. The preview updates after a short debounce delay.
6. To reposition the flare, the user clicks or drags anywhere on the preview thumbnail. The cursor changes to a crosshair when hovering over the thumbnail. The position is translated back to canvas coordinates; the X and Y values update in the numeric readouts below the thumbnail and the preview updates immediately.
7. The user clicks **Apply** to create the flare layer, or clicks **Cancel** (or presses Escape) to close the dialog without creating any layer.

## Functional Requirements

- The **Lens Flare…** menu item **must** appear under **Filter → Render** in the menu bar. It **must** be disabled when the active layer is not a pixel layer (adjustment layer, mask, text, shape, group, or no layer selected).
- The dialog **must** expose three controls:
  - **Lens Type**: a selector with five mutually exclusive options. Default is **50–300mm Zoom**.
  - **Brightness**: integer slider and numeric input, range 10–300 (inclusive), unit "%", default 100. At 100 the flare renders at its neutral reference intensity.
  - **Flare Center**: an interactive click-and-drag target on the preview thumbnail. The thumbnail **must** display a crosshair cursor on hover. The default position **must** be the canvas center. A pair of read-only X and Y numeric readouts (in whole pixels relative to the canvas origin) **must** be displayed below the thumbnail and kept in sync with the cursor position at all times.
- The five lens types and their visual characters are:
  - **50–300mm Zoom** — bright multi-ring halo, large central hot spot, scattered secondary glints. Characteristic of a consumer zoom lens.
  - **35mm Prime** — clean central starburst with minimal artifacts. Tight and controlled.
  - **105mm Prime** — wide, soft halo with a warm color tint. Gentle and diffused.
  - **Movie Prime** — strong central bloom paired with a pronounced artifact chain. Neutral toned. Mimics a cinematic spherical prime.
  - **Cinematic (Anamorphic)** — intense horizontal blue/teal streak spanning the full canvas width, strong elliptical flare rings distributed along the horizontal axis, and high-contrast bloom. Mimics the anamorphic lens character associated with contemporary cinematic photography.
- Changing the **Lens Type** **must** update the preview immediately, without debouncing.
- Adjusting **Brightness** **must** update the preview after a debounce delay of approximately 150 ms. Rapid successive changes **must** not trigger redundant preview redraws.
- Clicking or dragging anywhere on the preview thumbnail **must** reposition the flare center to the corresponding canvas coordinate and update both the preview and the X/Y readouts immediately.
- Values entered outside the **Brightness** range **must** be clamped: values below 10 are set to 10; values above 300 are set to 300.
- Clicking **Apply** **must**:
  - Create a new RGBA layer whose background is fully transparent (alpha = 0 everywhere before the flare is rendered).
  - Render the full-resolution flare onto this new layer using the chosen lens type, brightness, and flare center. The flare's intensity is baked directly into the pixel data; no adjustment layer or live filter is attached.
  - Name the new layer **`Lens Flare`**.
  - Set the new layer's blend mode to **Normal**. The user may change the blend mode (e.g. to Screen or Add) after the dialog closes using the standard layer controls.
  - Insert the new layer directly above the previously active layer in the layer stack.
  - Record exactly one undo history entry labeled `"Lens Flare"`. Pressing Ctrl+Z / Cmd+Z once **must** remove the newly created layer and restore the layer stack to its exact pre-dialog state.
  - Close the dialog.
- Clicking **Cancel** or pressing Escape **must** close the dialog without creating any layer and without recording any undo history entry.
- The preview thumbnail **must** composite the flare over a scaled-down representation of the current canvas content so the user can evaluate the flare's position and intensity against the actual image.
- The dialog is modal — the menu bar and canvas are not interactive while it is open.

## Acceptance Criteria

- With a pixel layer active, **Filter → Render → Lens Flare…** is enabled and opens the dialog.
- With a non-pixel layer active (or no layer selected), the menu item is grayed out and clicking it does nothing.
- The dialog opens with Lens Type set to **50–300mm Zoom**, Brightness at 100, flare center at the canvas center, and the X/Y readouts reflecting the canvas center coordinates.
- Selecting each of the five lens types produces a visually distinct flare in the preview and does so immediately without perceptible delay.
- Moving the Brightness slider does not trigger a preview redraw on every pixel of movement — it waits approximately 150 ms after the user settles.
- Clicking anywhere on the preview thumbnail repositions the flare center; the crosshair moves, the X/Y readouts update, and the preview reflects the new position immediately.
- Dragging across the preview thumbnail continuously repositions the flare center; both the preview and readouts track the drag in real time.
- Clicking **Apply** adds a new layer directly above the previously active layer. The layer is named `Lens Flare`, its blend mode is Normal, and its pixel data contains the flare rendered on a fully transparent background.
- The full-resolution flare position, intensity, and lens character match what was shown in the preview thumbnail.
- Pressing Ctrl+Z / Cmd+Z once after **Apply** removes the lens flare layer and restores the layer stack to its pre-dialog state.
- Clicking **Cancel** leaves the layer stack byte-for-byte identical to its pre-dialog state and records no undo history entry.
- Pressing Escape while the dialog is open produces the same result as clicking **Cancel**.
- Typing 5 in the Brightness input results in 10; typing 500 results in 300.

## Edge Cases & Constraints

- If the active layer is very small (e.g. a 10 × 10 px layer), the flare **must** still be created at canvas dimensions — the flare layer covers the full canvas, not just the active layer's bounds.
- At Brightness = 300, some lens types produce bloom that reaches the canvas edges or causes large areas of near-white. This is expected behavior.
- Clicking or dragging at the very edge of the preview thumbnail is valid. The flare center **must** be translated accurately even at thumbnail boundaries.
- The X/Y readouts are display-only while the dialog is open; they cannot be edited directly. Repositioning the flare center is done exclusively by interacting with the thumbnail.
- The dialog does not support stepwise undo inside itself — there is no way to revert a flare center repositioning while the dialog is open. The user may simply click or drag to a new position.
- The preview thumbnail is a scaled-down representation of the canvas. Minor fidelity differences between the thumbnail preview and the full-resolution output are acceptable, provided the overall flare character, position, and intensity are accurately represented.
- If the canvas has no visible content (all layers empty or hidden), the flare layer is still created and will be visible on its own when toggled.
- The flare is baked into the layer's pixel data at the time **Apply** is clicked. Changing the lens type, brightness, or flare center after the dialog closes requires undoing and re-opening the dialog.

## Out of Scope

- **Animating the flare** — keyframing flare position, brightness, or type over time is not supported.
- **Per-element color customization** — adjusting the hue, saturation, or color of individual flare components (streaks, halos, orbs) is not supported within this dialog.
- **Per-element intensity controls** — an advanced mode for independently tuning each flare component is not supported.
- **Non-destructive flare layer** — the flare is baked into pixels at commit time; it cannot be re-edited via a live filter.
- **Applying the flare to an existing layer** — the flare is always placed on a new layer; direct destructive painting onto an existing layer is not supported.

## Related Features

- [filters-menu.md](filters-menu.md) — the Filters menu that hosts this item and defines the shared enable/disable rules
- [noise-filmgrain-lensbur-clouds.md](noise-filmgrain-lensbur-clouds.md) — the Clouds filter, the other render filter under **Filter → Render**
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline that governs how the new layer composites with layers below it
