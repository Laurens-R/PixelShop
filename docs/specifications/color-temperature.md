# Color Temperature

## Overview

The **Color Temperature** adjustment is a non-destructive child layer that shifts the warmth and tint of a parent pixel layer using the same two-axis white balance model familiar from Lightroom and Camera Raw. **Temperature** moves pixels along the blue–orange axis, simulating the effect of changing the color temperature of the light source. **Tint** moves pixels along the green–magenta axis, compensating for color casts not captured by temperature alone. Together the two controls allow the user to correct white balance, create atmospheric color grades, or stylize imagery. The adjustment is stored persistently, can be toggled or deleted at any time, and re-opened for editing whenever the user needs to revise its values.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image → Color Temperature…** from the TopBar. If a selection is currently active it will scope the adjustment; if none exists the whole layer is targeted.
3. A new child layer named **"Color Temperature"** appears in the Layer Panel, indented directly beneath the parent layer — the same visual treatment as a layer mask.
4. A floating panel titled **"Color Temperature"** opens, anchored to the upper-right corner of the canvas. It contains two controls, in order:
   - **Temperature** — labeled slider (−100 to +100) with an adjacent numeric input. Default: 0. Negative values cool the image (push toward blue); positive values warm it (push toward orange/yellow).
   - **Tint** — labeled slider (−100 to +100) with an adjacent numeric input. Default: 0. Negative values push toward green; positive values push toward magenta.
5. Dragging either slider updates the canvas in real time. The user may also type a value directly into either numeric input; values outside the allowed range are clamped on commit.
6. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, capturing the final state of both controls.
7. To revise the adjustment later, the user clicks the adjustment layer's row in the Layer Panel. The floating panel reopens at the previously saved values.
8. The adjustment layer can be hidden (eye icon) to temporarily disable it, or deleted to remove it permanently.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately following its parent in the layer stack, with a `parentId` reference to the parent pixel layer.
- The parent pixel layer's pixel data **must not** be modified by this adjustment.
- The adjustment **must** be composited on top of the parent layer's pixels at render time.
- If a selection is active when the adjustment is created, only pixels within the selection boundary **must** be affected; the selection mask is baked into the adjustment layer at creation time.
- If no selection is active, the adjustment **must** affect the entire parent layer.
- The panel **must** expose a **Temperature** control: range −100 to +100, default 0.
  - Negative values **must** increase the blue channel and reduce the red channel (cooler appearance).
  - Positive values **must** increase the red and green channels in proportions that shift toward orange/yellow (warmer appearance).
- The panel **must** expose a **Tint** control: range −100 to +100, default 0.
  - Negative values **must** increase the green channel (greener appearance).
  - Positive values **must** increase the red and blue channels in proportions that shift toward magenta.
- Both controls **must** have a slider and a numeric input that remain in sync.
- The Temperature and Tint adjustments **must** be applied as a combined per-pixel color shift; the two axes are orthogonal and **must not** cancel each other's luminance impact unexpectedly.
- The canvas **must** update in real time as either slider is dragged.
- Closing the panel **must** record exactly one undo history entry covering the final values of both controls. Undoing **must** remove the adjustment layer.
- The adjustment layer **must** support visibility toggle, deletion, and re-editing from the Layer Panel.

## Acceptance Criteria

- With both sliders at 0 the canvas appearance is identical to the unmodified parent layer.
- Setting Temperature to +100 gives the layer a visibly warm (orange/yellow) cast.
- Setting Temperature to −100 gives the layer a visibly cool (blue) cast.
- Setting Tint to +100 gives the layer a visibly magenta cast.
- Setting Tint to −100 gives the layer a visibly green cast.
- Temperature and Tint effects compound: +100 Temperature and +100 Tint together produce a warm-magenta shift; −100 Temperature and −100 Tint together produce a cool-green shift.
- The canvas preview updates continuously during drag of either slider.
- Typing a value of 150 into either numeric input is clamped to 100; typing −150 is clamped to −100.
- Creating the adjustment while a selection is active restricts the visible effect to that area; pixels outside it are unaffected.
- Creating the adjustment with no active selection applies the effect to the full layer.
- Fully transparent pixels remain fully transparent regardless of slider values.
- Hiding the adjustment layer removes the visual effect without deleting the layer.
- Deleting the adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the adjustment layer entirely.
- Clicking the adjustment layer in the Layer Panel reopens the panel at the previously saved Temperature and Tint values.

## Edge Cases & Constraints

- Fully transparent pixels (alpha = 0) remain fully transparent regardless of slider values.
- Achromatic pixels (R = G = B) are affected by Color Temperature — the color shift is applied to channel values, not to a hue angle, so neutral grays will pick up a cast.
- At extreme values, channel values are clamped to [0, 255]; no combination of slider positions can produce out-of-range channel output.
- Color Temperature operates on the rendered RGB values and does not interpret an embedded color profile or model physical color temperature in Kelvin.
- Multiple Color Temperature adjustments may be stacked on the same parent layer; each is independent.
- The adjustment is not applicable to text layers, shape layers, or mask layers.
- The selection mask baked at creation time does not update if the user modifies the selection after the adjustment layer has been created.
- There is no keyboard shortcut assigned to this adjustment by default.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the menu entry that creates this adjustment
- [brightness-contrast.md](brightness-contrast.md) — complementary luminance adjustment
- [color-balance.md](color-balance.md) — complementary tonal-range-specific color shifting
- [hue-saturation.md](hue-saturation.md) — complementary hue-rotation and saturation adjustment
- Layer Panel → Layer Masks (child-layer structure this adjustment shares)
