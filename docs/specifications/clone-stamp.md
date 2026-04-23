# Clone Stamp Tool

## Overview

The Clone Stamp tool lets users paint pixels sampled from one part of the canvas onto another. It is the primary tool for retouching, removing unwanted elements, and duplicating content within an image. Unlike copy-paste, it operates as a brush, giving the user precise, painterly control over what is cloned and where. It supports cross-layer workflows: the source can be sampled from one layer while painting onto a different (typically empty) layer, enabling non-destructive retouching.

## User Interaction

1. The user selects the Clone Stamp tool from the toolbar.
2. Before painting is possible, the user must define a **source point** by holding **Alt** and clicking anywhere on the canvas. The source is locked to the layer that was under the cursor at the time of the Alt-click.
3. After setting the source, the user paints on the canvas normally (click and drag). Pixels from the source region are copied to the painted area.
4. A **crosshair/target marker** is displayed on the canvas at the current source position while the tool is active and a source has been set. In Aligned mode this marker moves in sync with the brush as the user paints; in Non-aligned mode it stays fixed at the original alt-clicked point.
5. If no source point has been set yet, the cursor indicates to the user that they must Alt-click to define one (e.g. a plain crosshair cursor). Attempting to paint before setting a source does nothing.
6. The user can redefine the source at any time by Alt-clicking again.

### Aligned mode (default)

Once the user begins painting, the offset between the source point and the brush tip remains constant for the duration of that stroke and carries over to subsequent strokes. The source point moves in step with the brush, so the user can lift the brush and resume painting at a new position without losing the relative alignment. The offset resets only when the user Alt-clicks to set a new source.

### Non-aligned mode

At the start of each new stroke (`pointerdown`), the source resets to the original alt-clicked point. The user can dab the same source region repeatedly from different destination positions.

## Functional Requirements

- The tool **must** require the user to Alt-click to define a source point before any cloning can occur.
- The source point **must** be locked to the layer that was under the cursor at the time of the Alt-click, not necessarily the currently active layer.
- When **Sample All Layers** is off (default), the tool **must** sample pixels from the locked source layer only.
- When **Sample All Layers** is on, the tool **must** sample from the flattened composite of all currently visible layers at the source location.
- In **Aligned** mode (default), the source-to-brush offset **must** remain constant across strokes until a new source is set.
- In **Non-aligned** mode, the source position **must** reset to the original alt-clicked point at the start of every new stroke.
- A **crosshair/target marker** must be rendered on the canvas at the current source location whenever the tool is active and a source has been set.
- The marker **must** move in real time with the brush in Aligned mode, and **must** remain fixed in Non-aligned mode.
- Each complete stroke (from `pointerdown` to `pointerup`) **must** be recorded as a single undoable action.
- If the source layer is deleted while the tool is active, the source point **must** be cleared and the user **must** receive a subtle notification indicating that the source is no longer valid.
- If no source point is set, painting **must** do nothing.
- Cross-document cloning is **out of scope**; source and destination must be on the same canvas.

## Options Bar Settings

| Option | Type | Default | Description |
|---|---|---|---|
| Brush Size | Integer (px) | — | Diameter of the clone brush in pixels. |
| Hardness | Percentage (0–100%) | — | Controls edge softness; 0% is fully soft/feathered, 100% is a hard edge. |
| Opacity | Percentage (1–100%) | — | Controls the transparency of each brush stamp. |
| Aligned | Checkbox/toggle | On | When checked, source offset is maintained across strokes. When unchecked, source resets on each stroke. |
| Sample All Layers | Checkbox | Off | When checked, samples the flattened composite of all visible layers. When unchecked, samples the locked source layer only. |

## Acceptance Criteria

- Alt-clicking a point and then painting copies pixels from the alt-clicked location to the painted destination.
- The source marker is visible on the canvas immediately after Alt-clicking and tracks the offset correctly during a paint stroke in Aligned mode.
- In Aligned mode, releasing the brush and resuming painting at a new position continues with the same offset — the cloned content does not jump back to the original source.
- In Non-aligned mode, each new stroke begins sampling from the same original alt-clicked position regardless of where the previous stroke ended.
- With Sample All Layers off, painting onto an empty layer above a background layer copies only the pixels from the locked source layer (transparent areas remain transparent if that layer has them).
- With Sample All Layers on, painting samples the fully composited result of all visible layers.
- A single Ctrl+Z undoes the entire last stroke in one step.
- Deleting the source layer while the Clone Stamp tool is active clears the source point; attempting to paint afterward does nothing until a new source is set. A notification is shown.
- If the user switches to another tool and back, the source point is preserved and the marker reappears.

## Edge Cases & Constraints

- **No source set:** The tool is inert. No pixels are painted. The cursor indicates that Alt-click is required to set a source.
- **Source layer deleted:** The source point is cleared automatically. The user must Alt-click again before painting.
- **Source at canvas edge:** Sampling outside canvas bounds returns transparent/empty pixels; no crash or clamp artifact occurs.
- **Opacity accumulation within a stroke:** Within a single stroke, each pixel position should not accumulate opacity beyond the stroke's configured opacity (consistent with other brush tools).
- **Cross-document cloning:** Not supported. The Alt-click source and the paint destination must be in the same document.
- **Painting outside canvas bounds:** Brush strokes that extend beyond the canvas edges are clipped to the canvas boundary.

## Related Features

- [Brush Tool](../specifications/) — shares the brush size, hardness, and opacity model.
- [Eraser Tool](../specifications/) — shares the brush rendering pipeline.
- [Layer system](../specifications/) — source locking and "Sample All Layers" depend on the layer stack and visibility state.
- [History / Undo-Redo](../specifications/) — each stroke must integrate with the shared undo history.
