# Adjustment Menu

## Overview

The **Image** menu is a top-level entry in the TopBar's menu bar that provides access to all non-destructive image adjustment operations. Selecting an item creates a new adjustment layer on the active pixel layer and immediately opens that adjustment's floating panel. The menu is the single, extensible entry point for all future adjustment types.

## User Interaction

1. The user identifies a pixel layer to adjust and ensures it is the active layer in the Layer Panel.
2. The user clicks **Image** in the TopBar menu bar. The menu appears after the **Edit** menu.
3. The menu lists all available adjustment types. If the active layer is not a pixel layer (or no layer is active), all items are grayed out and unclickable.
4. The user clicks an adjustment item (e.g., "Brightness/Contrast…"). The menu closes.
5. A new child adjustment layer appears in the Layer Panel, visually nested immediately beneath the active pixel layer — the same indented treatment used for layer masks.
6. The corresponding floating adjustment panel opens automatically, anchored to the upper-right corner of the canvas.
7. The user configures the adjustment in the panel, then closes it (or presses Escape). One undo entry is recorded when the panel closes.
8. To reopen the panel later, the user clicks the adjustment layer's row in the Layer Panel.

## Functional Requirements

- The **Image** menu **must** appear as a top-level entry in the TopBar menu bar, positioned after the **Edit** menu.
- Each registered adjustment type **must** appear as a distinct menu item within the Image menu.
- Clicking an enabled menu item **must** create a new child adjustment layer parented to the currently active pixel layer, and **must** open the corresponding floating panel immediately.
- All Image menu items **must** be disabled (grayed out, not interactive) when:
  - No layer is active, or
  - The active layer is a mask layer, or
  - The active layer is an adjustment layer.
- Image menu items **must not** be available on text or shape layers.
- The menu structure **must** be extensible: new adjustment types can be added by registering a new item in the menu definition without changes to the menu component itself.

## Acceptance Criteria

- With a pixel layer active, all Image menu items are enabled and clickable.
- With a mask layer or adjustment layer active, all Image menu items are grayed out and produce no action when clicked.
- With no layer active at all, all Image menu items are grayed out.
- Clicking an enabled item creates a visible child layer entry in the Layer Panel under the active pixel layer.
- Clicking an enabled item opens the correct floating panel for that adjustment type.
- The **Image** menu appears visually after **Edit** in the menu bar.
- Clicking an adjustment item when the active layer is a text or shape layer does not create an adjustment layer.

## Edge Cases & Constraints

- If the active pixel layer already has an adjustment of the same type, a second independent adjustment layer of that type is created — there is no "one per type" constraint.
- The menu does not show which adjustments are currently applied to the active layer; that information is visible in the Layer Panel only.
- The menu is stateless and rebuilds its enabled/disabled state fresh each time it opens.

## Related Features

- [brightness-contrast.md](brightness-contrast.md) — adjustment type accessible via this menu
- [hue-saturation.md](hue-saturation.md) — adjustment type accessible via this menu
- [color-vibrance.md](color-vibrance.md) — adjustment type accessible via this menu
- Layer Panel (child-layer / layer mask pattern that adjustment layers follow)
