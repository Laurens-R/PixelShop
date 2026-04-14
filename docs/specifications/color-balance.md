# Color Balance

## Overview

The **Color Balance** adjustment is a non-destructive child layer that shifts the color distribution of a parent pixel layer by independently altering the color balance of its shadows, midtones, and highlights tonal ranges. Rather than rotating hue uniformly, Color Balance pushes pixels toward or away from complementary color pairs — Cyan/Red, Magenta/Green, Yellow/Blue — giving the user precise tonal-range-specific color grading control. The adjustment is stored persistently, can be toggled or deleted at any time, and re-opened for editing whenever the user needs to revise its values.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image → Color Balance…** from the TopBar. If a selection is currently active it will scope the adjustment; if none exists the whole layer is targeted.
3. A new child layer named **"Color Balance"** appears in the Layer Panel, indented directly beneath the parent layer — the same visual treatment as a layer mask.
4. A floating panel titled **"Color Balance"** opens, anchored to the upper-right corner of the canvas. It contains:
   - **Tonal range tabs**: **Shadows**, **Midtones** (selected by default), **Highlights**. Only one tab is active at a time.
   - Under the active tab, three labeled sliders, each with an adjacent numeric input:
     - **Cyan ↔ Red** — range −100 to +100, default 0. Dragging toward +100 adds red; toward −100 adds cyan.
     - **Magenta ↔ Green** — range −100 to +100, default 0. Dragging toward +100 adds green; toward −100 adds magenta.
     - **Yellow ↔ Blue** — range −100 to +100, default 0. Dragging toward +100 adds blue; toward −100 adds yellow.
   - **Preserve Luminosity** — checkbox below the sliders, checked by default. When enabled, the luminance of each pixel is held constant after the color shift is applied.
5. The user clicks between the Shadows, Midtones, and Highlights tabs to configure each tonal range separately. All three ranges retain their values independently.
6. Dragging any slider or changing the checkbox updates the canvas in real time. The user may also type a value into any numeric input; values outside the allowed range are clamped on commit.
7. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, capturing the final state of all three tonal ranges and the Preserve Luminosity setting.
8. To revise the adjustment later, the user clicks the adjustment layer's row in the Layer Panel. The floating panel reopens at the previously saved values, with the Midtones tab selected by default.
9. The adjustment layer can be hidden (eye icon) to temporarily disable it, or deleted to remove it permanently.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately following its parent in the layer stack, with a `parentId` reference to the parent pixel layer.
- The parent pixel layer's pixel data **must not** be modified by this adjustment.
- The adjustment **must** be composited on top of the parent layer's pixels at render time.
- If a selection is active when the adjustment is created, only pixels within the selection boundary **must** be affected; the selection mask is baked into the adjustment layer at creation time.
- If no selection is active, the adjustment **must** affect the entire parent layer.
- The panel **must** expose three tonal range tabs: **Shadows**, **Midtones**, and **Highlights**. **Midtones** **must** be the default active tab when the panel opens.
- For each tonal range, the panel **must** expose three controls, each with a slider and a synchronized numeric input:
  - **Cyan ↔ Red**: range −100 to +100, default 0.
  - **Magenta ↔ Green**: range −100 to +100, default 0.
  - **Yellow ↔ Blue**: range −100 to +100, default 0.
- Each tonal range **must** store its three slider values independently; adjusting Midtones sliders **must not** affect the stored Shadows or Highlights values.
- The tonal range weighting applied to each pixel **must** be based on that pixel's luminance: shadow weights apply most strongly to dark pixels, midtone weights to mid-luminance pixels, and highlight weights to bright pixels, using overlapping bell-curve-style falloff regions so that pixels participate in blended proportions of adjacent ranges.
- Positive values on a slider **must** push the pixel toward the right-side color (Red, Green, Blue); negative values **must** push toward the left-side color (Cyan, Magenta, Yellow).
- The **Preserve Luminosity** checkbox **must** default to enabled. When enabled, after computing the color shift for a pixel the system **must** restore that pixel's original luminance, preventing any brightness change from the color adjustment. When disabled, luminance may shift as a side-effect of the color change.
- The canvas **must** update in real time as any slider is dragged or the Preserve Luminosity checkbox is toggled.
- Closing the panel **must** record exactly one undo history entry covering the final state of all controls. Undoing **must** remove the adjustment layer.
- The adjustment layer **must** support visibility toggle, deletion, and re-editing from the Layer Panel.

## Acceptance Criteria

- After creating the adjustment with all sliders at 0, the canvas appearance is identical to the unmodified parent layer.
- Setting the Midtones Cyan ↔ Red slider to +100 noticeably adds red to the mid-luminance areas of the layer; cyan is added at −100.
- Setting the Shadows Yellow ↔ Blue slider to +100 adds blue to the darkest areas; switching to the Highlights tab and dragging the same slider to +100 adds blue to the brightest areas instead.
- All three tonal ranges retain their independently-set slider values when the user switches between tabs.
- With Preserve Luminosity enabled, pushing any color slider to an extreme value does not change the perceived brightness of the affected pixels.
- With Preserve Luminosity disabled, pushing a color shift toward a brighter color (e.g., adding yellow) causes a visible luminance increase in the affected tonal range.
- Toggling Preserve Luminosity with non-zero sliders updates the canvas preview immediately.
- Typing a value of 150 into any numeric input is clamped to 100; typing −150 is clamped to −100.
- Creating the adjustment while a selection is active restricts the visible effect to that area; pixels outside it are unaffected.
- Creating the adjustment with no active selection applies the effect to the full layer.
- Fully transparent pixels remain fully transparent regardless of slider values.
- Hiding the adjustment layer removes the visual effect without deleting the layer.
- Deleting the adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the adjustment layer entirely.
- Clicking the adjustment layer in the Layer Panel reopens the panel at the previously saved values.

## Edge Cases & Constraints

- Achromatic pixels (R = G = B) are affected by Color Balance — pushing toward red adds red even to gray pixels — unlike hue-rotation adjustments that leave achromatic pixels unchanged.
- Fully transparent pixels (alpha = 0) remain fully transparent regardless of slider values.
- The Preserve Luminosity fallback is applied per-pixel after compositing all three tonal contributions, not per-range.
- Multiple Color Balance adjustments may be stacked on the same parent layer; each is independent.
- The adjustment is not applicable to text layers, shape layers, or mask layers.
- The selection mask baked at creation time does not update if the user modifies the selection after the adjustment layer has been created.
- There is no keyboard shortcut assigned to this adjustment by default.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the menu entry that creates this adjustment
- [brightness-contrast.md](brightness-contrast.md) — complementary luminance adjustment
- [hue-saturation.md](hue-saturation.md) — complementary hue-rotation and saturation adjustment
- [color-vibrance.md](color-vibrance.md) — complementary saturation adjustment
- Layer Panel → Layer Masks (child-layer structure this adjustment shares)
