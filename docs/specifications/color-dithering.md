# Color Dithering

## Overview

The **Color Dithering** adjustment is a non-destructive child layer that applies a retro dithering effect to the composited pixel data below it in the layer stack. It quantizes colors to the document's active palette using a choice of classic dithering algorithms — covering both ordered (Bayer matrix) and error-diffusion (Floyd-Steinberg, Sierra Lite) patterns — and blends the dithered result back over the original at a user-controlled opacity. The intended aesthetic is the visually characteristic look of early hardware: PlayStation 1, VGA/EGA/CGA DOS games, and similar constrained-palette platforms. Because it operates as an adjustment layer, the source pixels are never altered and the effect can be revised, toggled, or removed at any time.

## User Interaction

### Step 1 — Setup Wizard

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Adjustments → Color Dithering…** from the TopBar.
3. Before the adjustment layer is created, a **Color Dithering Setup Wizard** modal dialog opens. The wizard explains that Color Dithering works best when the palette has been configured and a Reduce Colors adjustment has been applied to the layers below, and that both steps are optional but recommended for the most accurate retro look.
4. The wizard presents the following controls:
   - **"Open Generate Palette…"** — a button or inline link that opens the Generate Palette dialog. The wizard remains available so the user can return to it after configuring the palette.
   - **"Also add a Reduce Colors adjustment layer (mapped to current palette)"** — a checkbox, unchecked by default. When checked, a Reduce Colors adjustment layer (in **Map to Palette** mode) will be inserted directly below the Color Dithering layer when the user proceeds.
   - **"Proceed — Apply Color Dithering"** — the primary action button. Dismisses the wizard and adds the adjustment layer(s) according to the current checkbox state.
   - **Cancel** — a secondary button that closes the wizard without adding any layers.
5. The wizard is a helpful guide, not a gate. The user may ignore both optional steps and click **Proceed** immediately.

### Step 2 — Adjustment Layer and Panel

6. After the user clicks **Proceed**, a new child adjustment layer named **"Color Dithering"** appears in the Layer Panel, indented directly beneath the parent pixel layer — the same visual treatment as other adjustment layers. If the **Reduce Colors** checkbox was checked, a **"Reduce Colors"** adjustment layer (Map to Palette mode) is inserted immediately below the Color Dithering layer, also as a child of the same parent.
7. A floating panel titled **"Color Dithering"** opens, anchored to the upper-right corner of the canvas. It contains:
   - **Dithering Style** — a dropdown or segmented control with four options:
     - **Bayer 4×4** (default)
     - **Bayer 8×8**
     - **Floyd-Steinberg**
     - **Sierra Lite**
   - **Opacity** — a labeled slider (0–100%, default 100%) with an adjacent numeric input. Controls the blend between the fully dithered result and the original (un-dithered) composited input. At 100% the output is entirely dithered; at 0% the adjustment has no visible effect.
   - A small read-only **info note** reminding the user: *"This effect dithers to the document palette. Update the palette in the Swatches panel to change the target colors."*
8. Changing either control updates the canvas preview in real time.
9. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, regardless of how many control changes were made during editing.
10. To revise the adjustment later, the user clicks the **"Color Dithering"** adjustment layer row in the Layer Panel. The floating panel reopens at the previously saved values.
11. The adjustment layer can be hidden (eye icon) to temporarily disable the dithering effect, or deleted to remove it permanently.

## Functional Requirements

- The **Color Dithering…** menu item **must** appear in the **Adjustments** top menu, in the standard color-adjustments group alongside Brightness/Contrast, Hue/Saturation, and similar adjustments. It **must** be disabled when no pixel layer is active.
- Clicking the enabled menu item **must** open the Setup Wizard modal. The adjustment layer **must not** be created until the user clicks **Proceed** in the wizard.
- Clicking **Cancel** in the wizard **must** close the dialog and leave the layer stack completely unchanged.
- Clicking **Proceed** **must** create a new child adjustment layer named **"Color Dithering"** parented to the active pixel layer. The parent pixel layer's pixel data **must not** be modified.
- If the **"Also add a Reduce Colors adjustment layer"** checkbox is checked when the user clicks **Proceed**, a second child adjustment layer named **"Reduce Colors"** **must** be inserted directly below the Color Dithering layer in the same parent group, configured in **Map to Palette** mode.
- The **"Open Generate Palette…"** button in the wizard **must** open the Generate Palette dialog. After the Generate Palette dialog is closed, the wizard **must** still be accessible so the user can proceed to add the adjustment.
- The adjustment **must** operate on the composited pixel data of all layers below it in the stack (within its compositing context), not solely on the parent pixel layer's raw data.
- The panel **must** expose a **Dithering Style** control with four mutually exclusive options: **Bayer 4×4**, **Bayer 8×8**, **Floyd-Steinberg**, and **Sierra Lite**. The default **must** be **Bayer 4×4**.
- The panel **must** expose an **Opacity** slider and numeric input: range 0–100%, default 100%. Values outside this range **must** be clamped on commit.
- The panel **must** display a read-only informational note pointing the user to the Swatches panel for palette management.
- The dithering algorithm **must** quantize pixel colors to the document's currently active palette at render time. If the palette changes, the canvas preview **must** update to reflect the new palette the next time the layer is rendered.
- The active palette is the same palette displayed in the Swatches panel. There are no independent color-depth or palette-size controls on this adjustment.
- **Bayer 4×4** and **Bayer 8×8**: **must** use an ordered dithering algorithm with the standard Bayer threshold matrix of the corresponding size. The pattern is spatial and deterministic — the same input always produces the same output with no per-frame variation.
- **Floyd-Steinberg**: **must** use the standard Floyd-Steinberg error-diffusion algorithm, scanning pixels left-to-right, top-to-bottom, distributing quantization error to the four neighboring pixels using the canonical 7/16, 3/16, 5/16, 1/16 weights.
- **Sierra Lite**: **must** use the Sierra Lite error-diffusion algorithm, distributing quantization error using its two-row, reduced-weight kernel. The result is deterministic given a fixed input.
- At Opacity = 100%, the output **must** consist entirely of palette colors. At Opacity = 0%, the adjustment **must** have no visible effect. At intermediate opacities, the dithered output **must** be linearly blended with the original (un-dithered) composited input.
- The canvas preview **must** update in real time while any control is being adjusted.
- Closing the panel **must** record exactly one undo history entry. Undoing that entry **must** remove the Color Dithering adjustment layer (and the Reduce Colors layer, if one was added by the wizard) and restore the canvas to its prior appearance.
- The adjustment layer **must** support:
  - **Visibility toggle** — hiding suppresses the dithering effect without deleting the layer or its settings.
  - **Deletion** — permanently removes the layer and restores the underlying appearance.
  - **Re-editing** — clicking the layer row in the Layer Panel reopens the panel with the last committed values.
  - **Selection mask** — if a selection is active when the adjustment layer is created, the dithering effect **must** be restricted to that selected area; the mask is baked into the adjustment layer at creation time.
- The adjustment **must** be included in the unified rasterization pipeline so that its output is correctly applied during flatten, merge, and export operations.

## Acceptance Criteria

- With a pixel layer active, **Adjustments → Color Dithering…** is enabled and opens the Setup Wizard modal.
- With no pixel layer active (or no layer), the menu item is grayed out and produces no action.
- Clicking **Cancel** in the wizard leaves the Layer Panel and canvas entirely unchanged.
- Clicking **Proceed** without checking the Reduce Colors checkbox creates exactly one new adjustment layer named **"Color Dithering"** in the Layer Panel.
- Clicking **Proceed** with the Reduce Colors checkbox checked creates two new adjustment layers: **"Color Dithering"** and **"Reduce Colors"** (Map to Palette mode), both parented to the active pixel layer, with Color Dithering above Reduce Colors in the stack.
- Clicking **"Open Generate Palette…"** in the wizard opens the Generate Palette dialog without closing the wizard. After Generate Palette is closed, the wizard is still accessible.
- With the default settings (Bayer 4×4, Opacity 100%), the canvas preview shows a visible ordered dithering pattern using only colors present in the current document palette.
- Switching to **Bayer 8×8** produces a coarser, larger-scale ordered dithering grid than Bayer 4×4.
- Switching to **Floyd-Steinberg** or **Sierra Lite** produces an error-diffusion dithering pattern visually distinct from the ordered Bayer patterns.
- At Opacity = 0%, the canvas preview is indistinguishable from the original (un-dithered) composite.
- At Opacity = 100%, every visible pixel in the affected area matches a color from the document palette.
- At Opacity = 50%, the result is a visible linear blend between the dithered and original outputs.
- Changing the document palette while the panel is open causes the canvas preview to re-render using the updated palette colors.
- The dithering pattern for Bayer 4×4 and Bayer 8×8 is identical on repeated renders of the same input — no frame-to-frame variation.
- The dithering pattern for Floyd-Steinberg and Sierra Lite is identical on repeated renders of the same input.
- The parent pixel layer's raw pixel data is unchanged after creating the adjustment (verifiable by reading raw pixel values).
- Hiding the Color Dithering adjustment layer removes the dithering effect and restores the pre-adjustment appearance on the canvas.
- Deleting the Color Dithering adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified appearance.
- Pressing Ctrl+Z / Cmd+Z once after closing the panel removes the Color Dithering adjustment layer (and the wizard-added Reduce Colors layer, if present) entirely.
- Clicking the Color Dithering adjustment layer row in the Layer Panel reopens the panel with the previously committed Dithering Style and Opacity values.
- Flattening, merging, or exporting the document correctly applies the Color Dithering effect in the output — the exported pixels reflect the dithered palette colors at the configured opacity.
- If a selection was active at creation time, the dithering effect is visible only inside the original selection boundary.
- Typing 150 into the Opacity numeric input is clamped to 100; typing −10 is clamped to 0.

## Edge Cases & Constraints

- If the document palette is empty (zero swatches), the dithering algorithms have no target colors to quantize to. In this case the adjustment **must** render as if no effect is applied, and the panel **must** display a visible inline warning (e.g., *"Palette is empty — add swatches to enable dithering"*).
- If the document palette contains only one swatch, a valid quantization target exists but the result will map all pixels to that single color at Opacity 100%. This is by design — the palette is the sole source of truth.
- Ordered Bayer dithering is based on a fixed spatial threshold matrix tiled across the canvas. The pattern tiles seamlessly and has no dependence on image content, so it is inherently deterministic.
- Error-diffusion algorithms (Floyd-Steinberg, Sierra Lite) accumulate quantization error across the scan order. The result is deterministic for a fixed input but is sensitive to changes in input pixels — a small change in the source will produce a visibly different error-diffusion pattern over the entire affected area downstream of that change.
- The adjustment operates on the composited result of all layers below it in the stack, not on any single layer's raw data. Layers above the Color Dithering adjustment are composited on top of the dithered output and are therefore not dithered themselves.
- The Opacity blend is a linear interpolation between the dithered and original composited inputs. It does not modify the adjustment layer's inherent layer opacity property (which controls transparency in the broader compositing stack); these are two independent controls.
- The wizard is shown exactly once per invocation of the menu item. Re-opening the panel by clicking the existing adjustment layer row in the Layer Panel does **not** show the wizard again.
- If a Reduce Colors layer was added by the wizard and the user later deletes it independently, the Color Dithering layer remains and continues to operate — the two layers are inserted together as a convenience but are otherwise independent.
- The selection mask baked at creation time is static. Modifying the selection after the Color Dithering layer is created does not update the mask.
- There is no keyboard shortcut assigned to this adjustment by default.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the Adjustments top menu that hosts this item
- [reduce-colors.md](reduce-colors.md) — the companion adjustment layer optionally inserted by the setup wizard; uses the same document palette in Map to Palette mode
- [generate-palette.md](generate-palette.md) — the palette generation dialog linked from the setup wizard
- [brightness-contrast.md](brightness-contrast.md) — representative example of the color-adjustments group this feature belongs to
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — the compositing pipeline responsible for applying this adjustment during flatten, merge, and export
