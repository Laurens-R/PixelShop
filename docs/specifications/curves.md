# Curves

## Overview

The **Curves** adjustment is a non-destructive child layer that remaps tonal values on a parent pixel layer using editable transfer curves. It lets users perform precise contrast shaping and color correction from subtle tonal tweaks to aggressive stylization, while keeping original pixels untouched and fully editable later. Curves supports both composite RGB editing and per-channel editing (Red, Green, Blue), live preview, reusable presets, and full parameter persistence.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image -> Curves...** from the TopBar. If a selection is active it scopes the adjustment; if no selection exists the whole layer is targeted.
3. A new child layer named **"Curves"** appears in the Layer Panel, indented directly beneath the parent layer.
4. A floating panel titled **"Curves"** opens, anchored to the upper-right corner of the canvas. It contains:
   - **Channel selector**: RGB (default), Red, Green, Blue.
   - **Curve graph** with input axis (shadows to highlights) and output axis (dark to bright), both normalized from 0 to 255.
   - **Histogram overlay** for the currently selected channel.
   - **Visual aids** toggle group (grid density, clipping indicators, input/output readout).
   - **Preset dropdown** and actions (Save Preset, Rename, Delete).
   - **Reset** action (current channel or all channels).
   - **Copy Settings / Paste Settings** actions.
   - **Preview toggle** to temporarily bypass the Curves effect while the panel is open.
5. The user edits a curve by interacting with the graph:
   - Click on the curve to add a control point.
   - Drag a control point to adjust mapping.
   - Select a point and press Delete or Backspace to remove it (endpoints cannot be removed).
   - Double-click a non-endpoint control point to remove it.
   - Dragging updates the canvas in real time.
6. Keyboard and pointer affordances are available during editing:
   - Arrow keys nudge the selected point by 1 unit.
   - Shift + Arrow nudges by 10 units.
   - Shift-drag constrains movement to the dominant axis (horizontal or vertical).
   - Point movement is clamped to graph bounds and cannot cross adjacent points on the X axis.
7. The user may switch channels at any time; each channel retains its own control points.
8. The user can toggle the layer visibility (eye icon) to compare before/after without losing settings.
9. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded when the panel closes.
10. The user can reopen and continue editing by selecting the Curves adjustment layer in the Layer Panel.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately after its parent in the layer stack, with a `parentId` reference.
- The parent pixel layer data **must not** be modified by Curves.
- The effect **must** be applied at render/composite time from saved curve parameters.
- If a selection is active when Curves is created, the effect **must** apply only inside the baked selection mask. If no selection is active, it **must** apply to the full parent layer.
- Curves **must** support four independently editable channels: **RGB**, **Red**, **Green**, **Blue**.
- The **RGB** channel **must** remap all color channels together as a master tonal curve.
- Per-channel curves **must** remap only their respective channel after the RGB curve is applied.
- Each channel curve **must** include fixed endpoint anchors at (0,0) and (255,255).
- The interpolation between points **must** be smooth and monotonic in X (no backward mapping or point crossover).
- The graph **must** support adding, selecting, moving, and removing control points as described in User Interaction.
- The active point's input/output values **must** be visible numerically and update while dragging.
- Curve output values **must** be clamped to [0,255] per channel.
- Fully transparent pixels (alpha = 0) **must** remain fully transparent.
- Histogram display **must** match the currently selected channel and refresh when channel changes.
- Visual aids **must** include at least:
  - Grid lines for tonal reference.
  - Optional clipping warning indicators when outputs are pinned at 0 or 255.
  - Input/output readout for the selected point or hovered tone position.
- Curves **must** support built-in presets, including:
  - Linear (identity/default).
  - Medium Contrast S-curve.
  - Strong Contrast S-curve.
  - Inverted curve.
- Users **must** be able to save a custom preset from current settings and later reapply it.
- Users **must** be able to copy full Curves settings and paste them onto another Curves adjustment layer.
- Paste behavior **must** validate payload shape and version; invalid payloads **must not** crash and **must** show a non-blocking error message.
- Reset behavior **must** support:
  - Reset active channel to linear identity.
  - Reset all channels to linear identity.
- A panel-level **Preview** toggle **must** temporarily bypass the Curves effect without changing stored parameters.
- Layer visibility toggle **must** bypass the Curves effect globally for that adjustment layer.
- Closing the panel **must** commit exactly one undo history entry capturing all Curves parameters and panel-level state that affects output.
- Reopening the same Curves layer **must** restore all persisted parameters exactly (curves, selected channel, visual-aid preferences, preset link/state).
- Multiple Curves adjustment layers **must** be allowed on the same parent layer and stack independently.
- Curves **must not** be creatable when the active layer is unsupported (mask, adjustment, text, shape, or no active layer), consistent with Adjustment Menu behavior.
- Live preview interaction **should** feel immediate during point drag and channel/preset changes:
  - During active drag on common document sizes, updates should present without perceptible stutter.
  - If processing load spikes, the app should degrade gracefully (drop intermediate frames) rather than freeze input.

## Acceptance Criteria

- Creating Curves from the Image menu on a pixel layer adds a visible child adjustment layer named **Curves** and opens the Curves panel.
- With default linear curves on all channels, output is visually identical to the parent layer.
- Editing only RGB changes tonal contrast/brightness without introducing channel-specific color casts.
- Editing only Red affects red channel response while Green and Blue mappings remain unchanged.
- Switching channels preserves each channel's existing points and returns to them when reselected.
- Endpoints remain fixed; attempts to delete or move endpoints outside bounds are ignored.
- A control point cannot be dragged past neighboring points in X.
- Deleting a non-endpoint point restores interpolation between adjacent points.
- Histogram changes when switching from RGB to an individual channel and reflects that channel distribution.
- Toggling Preview off shows the unadjusted parent result; toggling Preview on restores the Curves effect with unchanged settings.
- Toggling layer visibility off removes the Curves effect even if Preview is on.
- Copy settings on one Curves layer and paste to another reproduces identical curve shapes and resulting output.
- Invalid pasted settings show an error state/message and do not alter current settings.
- Creating Curves with an active selection affects only selected pixels; outside pixels remain unchanged.
- Parent layer raw pixel data remains unchanged before and after Curves creation/editing.
- Closing the panel after multiple edits records one undo step; one undo removes the created Curves layer (or restores prior Curves state when re-editing an existing layer).
- Reopening the Curves layer restores the previously saved settings, not defaults.

## Edge Cases & Constraints

- If no valid pixel layer is active, **Image -> Curves...** is disabled and cannot create a layer.
- If the selection used at creation time is later changed, the Curves layer mask does not automatically update.
- Extreme curve shapes may clip highlights/shadows; clipping indicators are advisory and do not block edits.
- Pasted settings from incompatible app versions are rejected with a non-blocking message and no state mutation.
- If histogram computation fails or data is unavailable, curve editing remains usable and the panel shows a fallback "Histogram unavailable" state.
- Very large images may reduce preview frame rate; interactions remain responsive and final state is accurate after drag end.
- Curves applies only to raster pixel content; text/shape layers require rasterization or are unsupported for direct Curves creation.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) - entry point for creating Curves adjustment layers
- [brightness-contrast.md](brightness-contrast.md) - simpler tonal adjustment workflow
- [hue-saturation.md](hue-saturation.md) - complementary global color adjustment
- [color-balance.md](color-balance.md) - complementary tonal-range color grading
- [color-vibrance.md](color-vibrance.md) - complementary saturation control
- [selective-color.md](selective-color.md) - channel-targeted color corrections
