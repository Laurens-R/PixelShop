# Color Key

## Overview

The **Color Key** adjustment is a non-destructive child layer that makes pixels transparent based on their proximity to a chosen key color, performing chroma keying entirely within the layer stack. Its primary use case is green screen and blue screen removal, but it works with any color the user selects. Because it operates as an adjustment layer, the underlying pixel data is never modified and the effect can be revised, toggled, or discarded at any time.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image → Color Key…** from the TopBar. If a selection is currently active it will scope the adjustment; if none exists the whole layer is targeted.
3. A new child layer named **"Color Key"** appears in the Layer Panel, indented directly beneath the parent layer — the same visual treatment as a layer mask.
4. A floating panel titled **"Color Key"** opens, anchored to the upper-right corner of the canvas. It contains:
   - **Key Color** — a color swatch showing the current key color (default: green, #00FF00). Clicking the swatch opens a color picker. The picker includes an eyedropper tool so the user can sample the key color directly from the canvas.
   - **Tolerance** — labeled slider (0 to 100) with an adjacent numeric input. Default: 0. Controls how far a pixel's color can stray from the key color before it stops being made fully transparent.
   - **Edge Softness** — labeled slider (0 to 100) with an adjacent numeric input. Default: 0. Controls the width of the soft-edge transition zone just outside the tolerance boundary.
5. Changing the key color or dragging either slider updates the canvas in real time. The user may also type values directly into the numeric inputs; values outside the allowed range are clamped on commit.
6. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment.
7. To revise the adjustment later, the user clicks the adjustment layer's row in the Layer Panel. The floating panel reopens at the previously saved values.
8. The adjustment layer can be hidden (eye icon) to temporarily disable it, or deleted to remove it permanently.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately following its parent in the layer stack, with a reference to the parent pixel layer.
- The parent pixel layer's pixel data **must not** be modified by this adjustment.
- The adjustment **must** be composited on top of the parent layer's pixels at render time; the parent's raw pixel data serves as input.
- If a selection is active when the adjustment is created, only pixels within the selection boundary **must** be affected; the selection mask is baked into the adjustment layer at creation time.
- If no selection is active, the adjustment **must** affect the entire parent layer.
- The panel **must** expose a **Key Color** control. The default key color **must** be green (#00FF00). The user **must** be able to change the key color using a color picker. The picker **must** include a canvas eyedropper for sampling directly from the canvas.
- The panel **must** expose a **Tolerance** control: range 0–100, default 0. Pixels whose HSV-space distance from the key color is less than or equal to the tolerance value **must** be made fully transparent (alpha = 0).
- The panel **must** expose an **Edge Softness** control: range 0–100, default 0. Pixels whose HSV-space distance from the key color falls between the tolerance value and (tolerance + softness) **must** receive partial transparency, linearly interpolated from fully transparent at the tolerance boundary to fully opaque at the outer softness boundary.
- Pixels whose HSV-space distance from the key color exceeds (tolerance + softness) **must** be left unchanged — their original alpha is preserved.
- At Edge Softness = 0, the transition from transparent to opaque **must** be a hard cut with no intermediate values.
- All three controls **must** update the canvas preview in real time.
- Both slider controls **must** have a slider and a numeric input that remain in sync.
- Closing the panel **must** record exactly one undo history entry. Undoing **must** remove the adjustment layer.
- The adjustment layer **must** support visibility toggle, deletion, and re-editing from the Layer Panel.

## Acceptance Criteria

- After creating the adjustment, the parent layer's raw pixel data is unchanged (verifiable by reading pixel values before and after).
- With the default key color (#00FF00) and Tolerance set to any value above 0, pixels matching pure green are rendered fully transparent.
- With Tolerance = 0 and Edge Softness = 0, no pixels are made transparent regardless of key color.
- With Tolerance = 50, pixels with an HSV distance from the key color ≤ 50 are rendered fully transparent; pixels beyond that boundary are unaffected.
- With Edge Softness = 20, pixels whose HSV distance falls in the band (tolerance, tolerance + 20) show a smooth, linear fade from transparent to opaque across that band.
- With Edge Softness = 0, the boundary between transparent and opaque pixels is a hard cut — no semi-transparent fringe is present.
- The eyedropper in the color picker successfully samples a color from the canvas and sets it as the new key color, updating the preview immediately.
- Typing 150 into a numeric input is clamped to 100; typing −10 is clamped to 0.
- Creating with an active selection restricts the keying effect to that area; pixels outside the selection are unaffected.
- Creating with no active selection applies the effect to the full layer.
- Hiding the adjustment layer removes the transparency effect and restores the parent layer's original appearance.
- Deleting the adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the adjustment layer entirely.
- Clicking the adjustment layer in the Layer Panel reopens the panel showing the previously committed Key Color, Tolerance, and Edge Softness values.

## Edge Cases & Constraints

- Pixels that are already fully transparent (alpha = 0) remain fully transparent regardless of settings.
- Pixels that fall outside the key color range are not made more opaque than their original alpha — the adjustment only removes transparency, it never adds it.
- The HSV distance metric combines hue, saturation, and value differences; achromatic pixels (pure grays, black, white) have undefined hue and are evaluated primarily by saturation and value distance.
- At high Tolerance values, broadly similar colors (e.g. yellow-greens and cyan-greens when keying on pure green) will also be keyed out. Users should use the lowest effective Tolerance to minimize color spill.
- The adjustment is not applicable to text layers, shape layers, or mask layers.
- The selection mask baked at creation time does not update if the user modifies the selection after the adjustment layer has been created.
- Multiple Color Key adjustments may be stacked on the same parent layer, each targeting a different key color; each is independent.
- There is no keyboard shortcut assigned to this adjustment by default.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the menu entry that creates this adjustment
- [hue-saturation.md](hue-saturation.md) — complementary hue/color adjustment
- [color-vibrance.md](color-vibrance.md) — complementary color saturation adjustment
- [selective-color.md](selective-color.md) — related color-targeting adjustment
- Layer Panel → Layer Masks (child-layer structure this adjustment shares)
