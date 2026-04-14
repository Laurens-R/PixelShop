# Hue / Saturation

## Overview

The **Hue/Saturation** adjustment is a non-destructive child layer that rotates pixel hues, scales color intensity, and shifts overall lightness on a parent pixel layer without altering its underlying pixel data. The adjustment is stored persistently, can be toggled or deleted at any time, and re-opened for editing whenever the user needs to revise its values.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image → Hue/Saturation…** from the TopBar. If a selection is currently active it will scope the adjustment; if none exists the whole layer is targeted.
3. A new child layer named **"Hue/Saturation"** appears in the Layer Panel, indented directly beneath the parent layer — the same visual treatment as a layer mask.
4. A floating panel titled **"Hue/Saturation"** opens, anchored to the upper-right corner of the canvas. It contains:
   - **Hue** — labeled slider (−180 to +180) with an adjacent numeric input. Default: 0.
   - **Saturation** — labeled slider (−100 to +100) with an adjacent numeric input. Default: 0.
   - **Lightness** — labeled slider (−100 to +100) with an adjacent numeric input. Default: 0.
5. Dragging any slider updates the canvas in real time. The user may also type a value directly into a numeric input; values outside the allowed range are clamped on commit.
6. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment.
7. To revise the adjustment later, the user clicks the adjustment layer's row in the Layer Panel. The floating panel reopens at the previously saved values.
8. The adjustment layer can be hidden (eye icon) to temporarily disable it, or deleted to remove it permanently.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately following its parent in the layer stack, with a `parentId` reference to the parent pixel layer.
- The parent pixel layer's pixel data **must not** be modified by this adjustment.
- The adjustment **must** be composited on top of the parent layer's pixels at render time.
- If a selection is active when the adjustment is created, only pixels within the selection boundary **must** be affected; the selection mask is baked into the adjustment layer at creation time.
- If no selection is active, the adjustment **must** affect the entire parent layer.
- The panel **must** expose a **Hue** control: range −180 to +180 degrees, default 0. The value represents a rotation on the color wheel applied uniformly to all pixels.
- The panel **must** expose a **Saturation** control: range −100 to +100, default 0. Positive values increase color intensity uniformly; negative values decrease it toward grayscale; −100 produces a fully desaturated result.
- The panel **must** expose a **Lightness** control: range −100 to +100, default 0. Positive values shift the layer toward white; negative values toward black.
- All three controls **must** have a slider and a numeric input that remain in sync.
- The canvas **must** update in real time as any slider is dragged.
- Closing the panel **must** record exactly one undo history entry. Undoing **must** remove the adjustment layer.
- The adjustment layer **must** support visibility toggle, deletion, and re-editing from the Layer Panel.

## Acceptance Criteria

- After creating the adjustment, the parent layer's pixel data is unchanged.
- Setting Hue to +180 (or −180) produces the hue-rotated complement of the original layer.
- Setting Saturation to −100 produces a fully grayscale rendering of the layer.
- Setting Saturation to +100 produces maximally saturated colors.
- Setting Lightness to +100 drives the layer toward white; −100 toward black.
- The canvas preview updates continuously during any slider drag.
- Typing a value of 200 into the Hue input is clamped to 180; typing −200 is clamped to −180. Out-of-range values for the other sliders are clamped to ±100.
- Creating with an active selection restricts the visible effect to that area.
- Creating with no active selection applies the effect to the full layer.
- Hiding the adjustment layer removes the visual effect without deleting it.
- Deleting the adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent.
- Pressing Ctrl+Z once after closing the panel removes the adjustment layer entirely.
- Clicking the adjustment layer in the Layer Panel reopens the panel at the previously saved Hue, Saturation, and Lightness values.

## Edge Cases & Constraints

- Fully transparent pixels (alpha = 0) remain fully transparent regardless of slider values.
- Achromatic pixels (R = G = B) are not affected by Hue rotation because they have no hue to rotate, but are affected by Saturation and Lightness changes.
- Multiple Hue/Saturation adjustments may be stacked on the same parent layer; each is independent.
- The adjustment is not applicable to text layers, shape layers, or mask layers.
- The selection mask baked at creation time does not update if the user modifies the selection after the adjustment layer has been created.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the menu entry that creates this adjustment
- [brightness-contrast.md](brightness-contrast.md) — complementary luminance adjustment
- [color-vibrance.md](color-vibrance.md) — complementary smart-saturation adjustment
- Layer Panel → Layer Masks (child-layer structure this adjustment shares)
