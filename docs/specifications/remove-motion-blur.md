# Remove Motion Blur

## Overview

**Remove Motion Blur** is a destructive filter that attempts to reverse a known linear motion blur from the active pixel layer using Wiener deconvolution. The user supplies the angle and distance of the blur they want to undo — these parameters must match the original blur that degraded the image. The filter is most useful after a deliberate motion blur was applied (e.g. via the Motion Blur filter) or when the user knows the approximate blur parameters from the capture conditions. The result is baked directly into the layer's pixel data upon confirmation and is undoable via the standard undo history.

## User Interaction

1. The user ensures the target pixel layer is active in the Layer Panel.
2. The user opens **Filters → Blur → Remove Motion Blur…** from the menu bar. If the active layer is not a pixel layer, the menu item is grayed out and cannot be selected.
3. The **Remove Motion Blur** dialog opens as a modal dialog. The canvas immediately shows the layer's current (unmodified) pixels.
4. The dialog presents three controls:
   - **Angle** — the direction of the motion blur to remove, in degrees (range 0–360°). Both a slider and a numeric input are present and kept in sync. Default is 0°.
   - **Distance** — the length in pixels of the motion blur to remove (range 1–999 px). Both a slider and a numeric input are present and kept in sync. Default is 10.
   - **Noise Reduction** — the Wiener regularization strength (range 0–100, default 10). Higher values suppress noise amplification during deconvolution at the cost of some sharpness recovery.
5. As the user adjusts any control, a deconvolved preview appears on the canvas after a short debounce delay — not on every incremental slider movement. The dialog remains open during preview.
6. The user clicks **Apply** to commit the result permanently to the layer, or clicks **Cancel** (or presses Escape) to discard the preview and leave the layer unchanged.

## Functional Requirements

- The **Remove Motion Blur…** menu item **must** appear under **Filters → Blur** in the menu bar. It **must** be disabled when the active layer is not a pixel layer (adjustment layer, mask, text, shape, group, or no layer selected).
- The dialog **must** be modal — the menu bar and canvas **must not** be interactive while it is open.
- The dialog **must** expose an **Angle** control: numeric range 0 to 360 (inclusive), default 0. Both a slider and a numeric input **must** be present and kept in sync.
- The dialog **must** expose a **Distance** control: integer range 1 to 999 (inclusive), default 10. Both a slider and a numeric input **must** be present and kept in sync.
- The dialog **must** expose a **Noise Reduction** control: integer range 0 to 100 (inclusive), default 10. Both a slider and a numeric input **must** be present and kept in sync.
- Values entered outside the allowed range **must** be clamped. Angle: below 0 set to 0, above 360 set to 360. Distance: below 1 set to 1, above 999 set to 999. Noise Reduction: below 0 set to 0, above 100 set to 100.
- The deconvolution algorithm **must** operate as follows:
  1. Construct the point spread function (PSF) for a linear motion blur of the given **Angle** and **Distance**.
  2. In the frequency domain (via FFT), divide the image spectrum by the PSF spectrum, regularized with a Wiener term $k = \text{NoiseReduction} / 1000$ to prevent division by zero and noise amplification. The Wiener filter is: $\hat{F} = \frac{H^* \cdot G}{|H|^2 + k}$, where $H$ is the PSF transfer function and $G$ is the degraded image spectrum.
  3. Invert the frequency domain result to produce the restored image.
- The filter **must** operate independently per color channel — R, G, and B channels are each deconvolved separately. The alpha channel **must** be left unchanged.
- The PSF size **must** be clamped to a reasonable upper bound to keep runtime acceptable on large canvases.
- If **Distance** is 0 (or effectively 1 with no motion), the filter **must** be a no-op: the output equals the input exactly, and the undo history entry is still recorded if the user clicks **Apply**.
- The canvas **must** display a live deconvolved preview while the dialog is open. This preview **must** be debounced — it is applied only after the user has settled on a value, not on every incremental slider movement.
- The preview **must** reflect the deconvolution result as it will appear when applied. It **must not** affect the actual layer pixel data until the user clicks **Apply**.
- Clicking **Apply** **must** permanently write the deconvolved pixels back to the active layer, close the dialog, and record exactly one undo history entry. Pressing Ctrl+Z (or Cmd+Z on macOS) **must** restore the layer's pixel data to its exact pre-filter state.
- Clicking **Cancel** or pressing Escape **must** close the dialog, restore the canvas to its pre-dialog appearance, and record no undo history entry.
- If an active selection exists, only pixels within the selection boundary **must** be processed; pixels outside **must** remain unmodified. The selection boundary is evaluated at the moment **Apply** is clicked.
- If no active selection exists, the filter **must** be applied to every pixel on the active layer.
- The filter **must not** affect any layer other than the currently active pixel layer.

## Acceptance Criteria

- With a pixel layer active, **Filters → Blur → Remove Motion Blur…** is enabled and opens the dialog.
- With a non-pixel layer active (or no layer), the menu item is grayed out and clicking it does nothing.
- The Angle slider moves between 0 and 360; the Distance slider moves between 1 and 999; the Noise Reduction slider moves between 0 and 100. Out-of-range typed values are clamped accordingly.
- After the user stops moving a slider, the canvas updates to show a deconvolved preview within the debounce window. The canvas does not update on every pixel of slider drag.
- Applying Remove Motion Blur with the same Angle and Distance that were previously used to apply a Motion Blur produces a result visually closer to the pre-blur image than the current blurred image.
- Setting Noise Reduction to 0 maximizes sharpness recovery and may introduce visible ringing or noise in flat regions.
- Setting Noise Reduction to 100 strongly suppresses noise amplification, producing a smoother but less sharp result.
- With Distance = 1 (effectively no motion), the output is visually identical to the input.
- Clicking **Apply** modifies the layer's pixel data and closes the dialog. The applied result matches the on-screen preview exactly.
- Clicking **Cancel** leaves the layer's pixel data byte-for-byte identical to its pre-dialog state.
- Pressing Escape while the dialog is open produces the same result as clicking **Cancel**.
- Pressing Ctrl+Z / Cmd+Z once after **Apply** restores the layer's pixel data to its pre-filter state.
- The alpha channel is not altered by the filter — fully transparent pixels remain fully transparent.
- With an active selection, **Apply** modifies only the pixels inside the selection; pixels outside are unchanged.

## Edge Cases & Constraints

- Angle values of 0° and 360° produce identical PSFs and **must** produce identical results.
- This filter is an inverse operation: it can only meaningfully recover an image if the supplied Angle and Distance accurately describe the blur present in the image. Mismatched parameters will produce artifacts (ringing, ghosting, or amplified noise) — this is expected behavior, not an error.
- At high Distance values and low Noise Reduction, the filter may produce visible ringing artifacts along sharp edges. This is an inherent property of Wiener deconvolution.
- The filter operates in the frequency domain; computation time scales with the number of pixels in the layer (or the active selection bounding box). Very large canvases may take several seconds. The debounce on the preview limits unnecessary computation during slider interaction.
- Remove Motion Blur is **not** re-editable after commit. Once applied, the original pixel data cannot be recovered except via undo.
- This filter makes no attempt to estimate the blur parameters from the image automatically. The user must supply the correct Angle and Distance.
- The Remove Motion Blur dialog is modal — the menu bar and canvas are not interactive while it is open.

## Out of Scope

- **Blind deconvolution** — automatically estimating the blur angle, distance, and type from the image is not supported.
- **Multi-channel independent parameter tuning** — the same Angle, Distance, and Noise Reduction values are applied to all color channels; per-channel parameter control is not supported.
- **16-bit float or HDR precision path** — the filter operates on 8-bit-per-channel pixel data.
- **Non-linear or spatially varying PSFs** — only a uniform linear motion blur PSF is modeled.
- **Non-destructive application** — a re-editable filter layer is a separate, future feature.
- **Applying the filter to multiple layers simultaneously** — the filter always targets the single active layer.

## Related Features

- [motion-blur.md](motion-blur.md) — the forward operation this filter is designed to reverse
- [filters-menu.md](filters-menu.md) — the Filters menu that hosts this item and defines the shared enable/disable rules
- [gaussian-blur.md](gaussian-blur.md) — sibling blur filter
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline used when a selection is active to isolate which pixels are modified
