# Reduce Noise

## Overview

**Reduce Noise** is a destructive composite denoising filter modelled on Photoshop's Reduce Noise dialog. It addresses the most common sources of photographic noise in a single operation: luminance noise (random brightness variation across pixels), color noise (random hue/saturation speckles in flat-color areas), and loss of fine edge detail introduced by the denoising itself. Four independent controls give the user fine-grained authority over the trade-off between smoothness and sharpness, making this the most capable single-step denoising tool in the Noise submenu. The operation is undoable via the standard undo history.

## User Interaction

1. The user ensures the target pixel layer is active in the Layer Panel.
2. The user selects **Filters → Noise → Reduce Noise…** from the menu bar. If the active layer is not a pixel layer, the menu item is grayed out and cannot be selected.
3. The **Reduce Noise** floating panel opens to the right of the canvas. The canvas shows the layer's current unmodified pixels.
4. The panel presents four controls, each with a slider and a numeric input:
   - **Strength** — range 0–10, default 6. The overall denoising intensity. At 0 the filter has no effect; at 10 it applies maximum luminance smoothing.
   - **Preserve Details** — range 0–100 (%), default 60. How strongly edges and fine structural detail are protected from smoothing. At 0, no detail preservation is applied and flat and detailed areas are treated equally. At 100, edge regions are almost entirely excluded from smoothing.
   - **Reduce Color Noise** — range 0–100 (%), default 25. Smoothing applied to the chrominance channels (U and V in a YUV decomposition) independently of luminance. At 0, color noise is not addressed. At 100, chrominance is heavily smoothed, eliminating color speckles.
   - **Sharpen Details** — range 0–100 (%), default 0. Post-denoising sharpening applied as an unsharp mask over the result. At 0, no sharpening is applied. Higher values restore apparent edge crispness lost during smoothing.
5. As the user adjusts any control, a filtered preview appears on the canvas after a short debounce delay. The panel remains open during preview.
6. If an active selection is present, a note in the panel indicates that the filter will apply only within the selected area.
7. While the preview is being computed, a busy spinner is shown inside the panel.
8. The user clicks **Apply** to commit the filter, or **Cancel** (or presses Escape) to discard the preview and leave the layer unchanged.

## Functional Requirements

- The **Reduce Noise…** menu item **must** appear under **Filters → Noise** in the menu bar. It **must** be disabled when the active layer is not a pixel layer (adjustment layer, mask, text, shape, or no layer selected).
- The panel **must** expose the following four controls, each as both a slider and a numeric input that are kept in sync:
  - **Strength**: integer or continuous range 0–10, default 6.
  - **Preserve Details**: integer range 0–100 (%), default 60.
  - **Reduce Color Noise**: integer range 0–100 (%), default 25.
  - **Sharpen Details**: integer range 0–100 (%), default 0.
- Values entered outside each allowed range **must** be clamped to the nearest boundary.
- The canvas **must** display a live filtered preview while the panel is open. This preview **must** be debounced — it is applied only after the user has settled on a value, not on every incremental slider movement.
- When **Strength** is 0 and **Sharpen Details** is 0, the preview and final output **must** be pixel-for-pixel identical to the unmodified layer.
- The preview **must** reflect the filter result as it will appear when applied. It **must not** affect the actual layer pixel data until the user clicks **Apply**.
- Clicking **Apply** **must** permanently write the filtered pixels back to the active layer, close the panel, and record exactly one undo history entry. Pressing Ctrl+Z (or Cmd+Z on macOS) **must** restore the layer's pixel data to its exact pre-filter state.
- Clicking **Cancel** or pressing Escape **must** close the panel, restore the canvas to its pre-panel appearance, and record no undo history entry.
- The alpha channel of every pixel **must** be preserved unchanged. All four processing stages (luminance smoothing, detail preservation, color noise reduction, sharpening) operate on the RGB channels only.
- If an active selection exists, only pixels within the selection boundary **must** be filtered; pixels outside the selection **must** remain unmodified. The selection boundary is evaluated at the moment **Apply** is clicked.
- If no active selection exists, the filter **must** be applied to every pixel on the active layer.
- The filter **must not** affect any layer other than the currently active pixel layer, even if other layers are visible.
- The **Advanced** mode (per-channel noise reduction) **must not** be present. The panel exposes only the four controls listed above.

## Acceptance Criteria

- With a pixel layer active, **Filters → Noise → Reduce Noise…** is enabled and opens the floating panel.
- With a non-pixel layer active (or no layer), the menu item is grayed out and clicking it does nothing.
- All four sliders are present and respond to dragging; their numeric inputs update in sync.
- Slider ranges are enforced: Strength 0–10, Preserve Details 0–100, Reduce Color Noise 0–100, Sharpen Details 0–100.
- Setting all controls to their defaults (6 / 60 / 25 / 0) produces a visibly smoothed result with preserved edges and no added sharpening.
- Setting Strength to 0 and Sharpen Details to 0 produces no visible change on the canvas preview or after Apply.
- Setting Preserve Details to 0 makes the smoothing visibly heavier on edge regions compared to Preserve Details at 100.
- Setting Reduce Color Noise to 100 visibly eliminates chrominance speckles in a noisy color image.
- Setting Sharpen Details above 0 visibly increases edge contrast in the result compared to the same settings with Sharpen Details at 0.
- After the user stops adjusting a control, the canvas preview updates within the debounce window.
- Clicking **Apply** modifies the layer's pixel data and closes the panel.
- Clicking **Cancel** leaves the layer's pixel data byte-for-byte identical to its pre-panel state.
- Pressing Escape while the panel is open produces the same result as clicking **Cancel**.
- Pressing Ctrl+Z / Cmd+Z once after **Apply** restores the layer's pixel data exactly to its pre-filter state.
- The alpha channel is identical before and after applying the filter.
- With a selection active, **Apply** filters only the pixels inside the selection; pixels outside are unchanged.
- No "Advanced" tab, toggle, or per-channel controls appear in the panel.

## Edge Cases & Constraints

- With **Strength** at maximum (10) and **Preserve Details** at 0, the result will exhibit strong blurring across the entire layer including sharp edges. This is intentional and not an error.
- With **Sharpen Details** at high values after aggressive smoothing (high Strength, low Preserve Details), haloing artifacts around high-contrast edges may be visible. This is expected behavior of unsharp masking applied to an over-smoothed image.
- Pixels at the edge of the layer or at the boundary of an active selection have neighbourhoods that extend beyond available pixel data. These positions **must** be handled with border clamping — the neighbourhood is padded by repeating the nearest in-bounds pixel value.
- Applying the filter to a fully transparent layer is valid and produces no visible change, but still records an undo history entry when **Apply** is clicked.
- Applying the filter to a layer that has no noise is valid — the operation is a no-op visually but still records an undo entry when **Apply** is clicked.
- The Reduce Noise panel is modal — the menu bar and canvas are not interactive while the panel is open.
- Reduce Noise is **not** re-editable after commit. Once applied, the original pixel data cannot be recovered except via undo.

## Out of Scope

- **Advanced / per-channel mode** — applying different settings per RGB channel (as in Photoshop's Advanced tab) is not supported in this version.
- **Non-destructive application** — the filter always permanently modifies pixel data; a non-destructive filter layer type is a separate, future feature.
- **Applying the filter to multiple layers simultaneously** — the filter always targets the single active layer.
- **Noise profile analysis** — automatic detection of the noise type or ISO level present in the image is not supported; all parameters must be set manually.

## Related Features

- [filters-menu.md](filters-menu.md) — the Filters menu and its **Noise** submenu that host this item
- [noise-filmgrain-lensbur-clouds.md](noise-filmgrain-lensbur-clouds.md) — the sibling Noise submenu filters (Add Noise, Film Grain, Lens Blur, Clouds)
- [median-filter.md](median-filter.md) — simpler single-parameter denoising filter in the same submenu
- [bilateral-filter.md](bilateral-filter.md) — edge-preserving denoising filter in the same submenu
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline used when a selection is active to isolate which pixels are modified
