# Brightness / Contrast

## Overview

The **Brightness/Contrast** adjustment is a non-destructive child layer that shifts the luminance and tonal contrast of a parent pixel layer without altering its pixel data. The adjustment is stored persistently alongside the parent, can be toggled or deleted at any time, and re-opened for editing whenever the user needs to revise its values.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image → Brightness/Contrast…** from the TopBar. If a selection is currently active on the canvas it remains active and will scope the adjustment; if no selection exists the whole layer is targeted.
3. A new child layer named **"Brightness/Contrast"** appears in the Layer Panel, indented directly beneath the parent layer — the same visual treatment as a layer mask.
4. A floating panel titled **"Brightness/Contrast"** opens, anchored to the upper-right corner of the canvas. It contains:
   - **Brightness** — labeled slider (−100 to +100) with an adjacent numeric input. Default: 0.
   - **Contrast** — labeled slider (−100 to +100) with an adjacent numeric input. Default: 0.
5. Dragging either slider updates the canvas in real time. The user may also type a value directly into the numeric input; values outside the allowed range are clamped on commit.
6. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, regardless of how many slider moves were made during editing.
7. To revise the adjustment later, the user clicks the adjustment layer's row in the Layer Panel. The floating panel reopens at the previously saved values.
8. The adjustment layer can be hidden (eye icon) to temporarily disable it, or deleted (trash icon / Delete key when selected) to remove it permanently.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately following its parent in the layer stack, with a `parentId` reference to the parent pixel layer.
- The parent pixel layer's pixel data **must not** be modified by this adjustment.
- The adjustment **must** be composited on top of the parent layer's pixels at render time; the parent's raw pixel data serves as the input.
- If a selection is active when the adjustment is created, only pixels within the selection boundary **must** be affected by the adjustment; this selection mask is baked into the adjustment layer at creation time.
- If no selection is active, the adjustment **must** affect the entire parent layer.
- The panel **must** expose a **Brightness** control: range −100 to +100, default 0. Positive values shift all pixel luminance toward white; negative values shift toward black.
- The panel **must** expose a **Contrast** control: range −100 to +100, default 0. Positive values expand the luminance range around the midpoint; negative values compress it toward flat gray.
- Both controls **must** have a slider and a numeric input that remain in sync.
- The canvas **must** update in real time while either slider is being dragged.
- Closing the panel **must** record exactly one undo history entry. Undoing that entry **must** remove the adjustment layer and restore the canvas to its prior appearance.
- The adjustment layer **must** support:
  - **Visibility toggle** — hiding it suppresses the effect without deleting it.
  - **Deletion** — removes the layer and its effect permanently.
  - **Re-editing** — clicking the layer in the Layer Panel reopens the panel with the saved values.

## Acceptance Criteria

- After creating the adjustment, the parent layer's pixel data is unchanged (verifiable by reading raw pixel values before and after).
- Setting Brightness to +100 lightens the layer toward white; −100 darkens toward black.
- Setting Contrast to +100 increases tonal separation; −100 brings all tones closer to 50% gray.
- The canvas preview updates continuously during slider drag without requiring a commit.
- Typing a value of 150 into a numeric input is clamped to 100; typing −150 is clamped to −100.
- Creating the adjustment while a rectangular or freeform selection is active restricts the visible effect to that area; pixels outside it are unaffected.
- Creating the adjustment with no active selection applies the effect to the full layer.
- Hiding the adjustment layer in the Layer Panel removes the visual effect without deleting the layer.
- Deleting the adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the adjustment layer entirely.
- Clicking the adjustment layer in the Layer Panel reopens the panel showing the previously committed Brightness and Contrast values.

## Edge Cases & Constraints

- Fully transparent pixels (alpha = 0) remain fully transparent regardless of Brightness or Contrast values.
- Multiple Brightness/Contrast adjustments may be stacked on the same parent layer; each is independent.
- The adjustment is not applicable to text layers, shape layers, or mask layers.
- The selection mask baked at creation time does not update if the user modifies the selection after the adjustment layer has been created.
- There is no keyboard shortcut assigned to this adjustment by default.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the menu entry that creates this adjustment
- [hue-saturation.md](hue-saturation.md) — complementary tonal/color adjustment
- [color-vibrance.md](color-vibrance.md) — complementary color saturation adjustment
- Layer Panel → Layer Masks (child-layer structure this adjustment shares)
