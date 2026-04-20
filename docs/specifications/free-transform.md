# Free Transform

## Overview

**Free Transform** lets users scale, rotate, skew, and apply perspective to the pixels of the active raster layer — or to a floating selection lifted from it — through an interactive bounding-box overlay. The operation is committed destructively: the resampled result is written back into the layer and a single undo entry is created. It covers the most common geometric transformation needs (resize, rotate, skew, perspective correction) without requiring a non-destructive transform layer.

---

## User Interaction

### Entering Transform Mode

1. The user ensures a **pixel (raster) layer** is active in the Layer Panel.
2. The user opens **Edit → Transform…** from the menu bar. The item is positioned after any crop-related Edit menu entries and is greyed out (disabled) when the active layer is a shape layer, text layer, adjustment layer, or when no document is open.
3. The application enters **Transform Mode**.

### Whole-Layer Mode (no active selection)

When no selection is active at the moment **Transform…** is triggered:

1. The application scans the active layer's pixel data and computes the axis-aligned **bounding rectangle of all non-transparent pixels**.
2. A dashed bounding box is drawn over that rectangle in the canvas overlay, with handles at each corner, at each edge mid-point, a rotation handle above the top-centre edge, and a repositionable centre cross-hair.
3. The tool options bar is replaced by the **Transform Toolbar** (see below).
4. The user manipulates the bounding box using handles and/or toolbar fields.
5. The user commits by clicking **Apply**, pressing **Enter**, or cancels by clicking **Cancel** or pressing **Escape**.

> **All-transparent layer:** If the entire layer is transparent, no non-transparent bounding box can be computed. The bounding box falls back to the full layer canvas dimensions so the user can still reposition or resize the layer.

### Selection Mode (active selection present)

When a selection is active at the moment **Transform…** is triggered:

1. The selected pixels are **lifted** out of the layer: the source pixels within the selection boundary are copied into a temporary floating transform buffer and the original area on the layer is **cleared to full transparency**.
2. A dashed bounding box is drawn around the selection's axis-aligned bounding rectangle.
3. The **Transform Toolbar** replaces the tool options bar.
4. The user manipulates the bounding box.
5. On **Apply** / **Enter**: the floating buffer is resampled and composited back into the layer at its new position and orientation. One undo entry is recorded.
6. On **Cancel** / **Escape**: the floating buffer is placed back into its original position, the layer is restored to its pre-lift state, and the selection is restored.

---

## Handle Interactions

### Bounding Box Overview

The bounding box overlay is drawn as a dashed rectangle aligned to the current transformed state of the content. Handles are rendered as small filled squares on corners and edge mid-points. The rotation handle is a filled circle connected by a short line above the top-centre edge handle. The pivot cross-hair sits at the geometric centre by default.

### Corner Handles — Scale

- **Drag**: scales the bounding box freely, adjusting both axes independently.
- **Drag + Shift**: constrains the scale to the original aspect ratio, scaling about the pivot point.
- Scaling can extend one or more sides beyond the canvas boundary; out-of-canvas content is preserved in the transform buffer and clipped on commit.

### Edge Mid-Point Handles — Single-Axis Scale

- **Drag a horizontal edge** (top or bottom): scales only the height.
- **Drag a vertical edge** (left or right): scales only the width.
- Shift has no special effect on single-axis handles.

### Rotation Handle

- Located above the top-centre edge handle, connected by a short line.
- **Drag**: rotates the bounding box and its content about the current pivot point.
- **Drag + Shift**: snaps rotation to 15° increments.
- The **Rotation** field in the toolbar updates live. Positive values are clockwise.

### Centre Cross-Hair — Pivot Repositioning

- Displayed at the centre of the bounding box by default.
- **Drag**: repositions the pivot point without changing the content position.
- All subsequent rotations and constrained scales use the new pivot point.
- The pivot position is not persisted after the transform is committed or cancelled.

### Perspective Handles (Perspective mode)

- Available only when the **Perspective** mode toggle is active in the Transform Toolbar.
- Corner handles move independently along their adjacent edges to create a four-corner perspective warp.
- Edge mid-point handles are hidden in this mode.
- Holding Shift while dragging a perspective corner constrains its movement to one axis.

### Shear Handles (Shear mode)

- Available only when the **Shear** mode toggle is active in the Transform Toolbar.
- Edge mid-point handles drag to shear the content along that axis (horizontal edges shear horizontally; vertical edges shear vertically).
- Corner handles are hidden in this mode.

---

## Transform Toolbar

The Transform Toolbar replaces the normal tool options bar for the duration of Transform Mode. It contains the following elements, left to right:

| Field / Control | Description |
|---|---|
| **X** | Horizontal position of the bounding box's top-left corner, in pixels from the canvas origin. Editable; updates the box live on commit (Tab or Enter). |
| **Y** | Vertical position of the bounding box's top-left corner, in pixels from the canvas origin. Editable; updates the box live on commit. |
| **W** | Current width of the transformed bounding box in pixels. Editable. |
| **H** | Current height of the transformed bounding box in pixels. Editable. |
| **Lock icon** (between W and H) | When locked (default: unlocked), editing W recalculates H proportionally and vice versa to preserve the current aspect ratio. Clicking the icon toggles between locked and unlocked. |
| **Rotation** | Current rotation in degrees (−180 to +180 or 0–360, normalised). Editable. Positive values are clockwise. |
| **Interpolation** | Dropdown selecting the resampling algorithm applied on commit: **Nearest Neighbour**, **Bilinear** (default), **Bicubic**. |
| **Scale / Perspective / Shear** | Three mutually exclusive toggle buttons that switch the active handle mode. |
| **Cancel** | Discards the transform and exits Transform Mode (equivalent to Escape). |
| **Apply** | Commits the transform and exits Transform Mode (equivalent to Enter). |

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| **Enter** | Apply the transform (same as the Apply button). |
| **Escape** | Cancel the transform (same as the Cancel button). |
| **Shift** (held during corner drag) | Constrain scale to original aspect ratio. |
| **Shift** (held during rotation drag) | Snap rotation to 15° increments. |
| **Tab** | Advance focus to the next toolbar field; commits any in-progress typed value in the current field. |

---

## Functional Requirements

- Free Transform **must** be available exclusively for pixel (raster) layers. It **must not** be available when the active layer is a shape layer, text layer, or adjustment layer.
- The **Edit → Transform…** menu item **must** be disabled (greyed out) whenever the above conditions are not met, or when no document is open.
- In **whole-layer mode**, the initial bounding box **must** enclose only the non-transparent pixels of the layer; if the layer is entirely transparent the bounding box **must** fall back to the full canvas dimensions.
- In **selection mode**, the selected pixels **must** be lifted off the layer (source area cleared to transparency) into a floating buffer before any handle interaction begins.
- The bounding box overlay **must** be rendered in the canvas tool overlay and **must not** modify the underlying pixel data until Apply is confirmed.
- The canvas **must** display a live preview of the transformed content as handles are dragged or toolbar values are edited.
- Corner handles **must** support free scale; holding Shift **must** constrain to the original aspect ratio.
- Edge mid-point handles **must** scale only the perpendicular axis.
- The rotation handle **must** rotate about the current pivot point; holding Shift **must** snap to 15° increments.
- The pivot cross-hair **must** be draggable to any position within or outside the bounding box.
- Perspective and Shear handle modes **must** be accessible only through the corresponding toolbar mode toggles; they **must not** be active simultaneously.
- The W/H lock icon **must**, when locked, maintain the aspect ratio when either dimension is edited in the toolbar.
- The interpolation setting **must** be applied at commit time, not during the live preview.
- Pressing **Apply** or **Enter** **must** resample and composite the transform buffer into the layer using the selected interpolation method, record exactly one undo history entry labelled **"Free Transform"**, restore the normal tool options bar, and return to the tool that was active before Transform Mode was entered.
- Pressing **Cancel** or **Escape** **must** restore the layer to its state at the point Transform Mode was entered (restoring lifted pixels in selection mode, leaving the layer unchanged in whole-layer mode), restore any active selection, restore the normal tool options bar, and return to the previously active tool.
- Content transformed outside the canvas boundary **must** be preserved in the buffer during manipulation and clipped to the canvas bounds on commit.
- A zero-size selection **must** prevent Transform Mode from activating; the menu item remains enabled but triggering it when a zero-size selection is active **must** show no bounding box and take no action (or degrade gracefully by ignoring the selection and falling through to whole-layer mode).

---

## Acceptance Criteria

- **Menu state**: Edit → Transform… is enabled when a raster layer is active and disabled for shape, text, and adjustment layers.
- **Whole-layer bounding box**: The initial bounding box tightly wraps the non-transparent pixels of the layer (not the full canvas) when no selection is active.
- **Selection lift**: After entering Transform Mode with a selection, the source area on the layer is transparent until the transform is cancelled or applied.
- **Live preview**: Dragging any handle updates the canvas preview in real time without committing the change.
- **Free scale**: Dragging a corner handle resizes the bounding box with no aspect ratio constraint.
- **Constrained scale**: Dragging a corner handle while holding Shift maintains the original width-to-height ratio.
- **Single-axis scale**: Dragging a top/bottom edge handle changes height only; dragging a left/right edge handle changes width only.
- **Rotation**: Dragging the rotation handle rotates content about the pivot. The Rotation toolbar field reflects the current angle continuously.
- **Rotation snap**: Holding Shift during rotation snaps to multiples of 15°.
- **Pivot relocation**: Dragging the centre cross-hair changes the pivot point; subsequent rotation is about the new pivot.
- **Perspective mode**: Activating the Perspective toggle replaces corner-scale behaviour with independent corner dragging that distorts the content perspectively.
- **Shear mode**: Activating the Shear toggle allows edge mid-point handles to shear the content; corner handles are hidden.
- **Mode exclusivity**: Only one of Scale, Perspective, and Shear can be active at a time.
- **W/H lock**: Editing W with the lock engaged recalculates H to preserve aspect ratio, and vice versa.
- **Toolbar values**: X, Y, W, H, and Rotation fields reflect the current transform state and, when edited and committed (Tab/Enter), update the bounding box accordingly.
- **Interpolation selection**: Committing with Nearest Neighbour, Bilinear, and Bicubic each produces visually distinct results when the content is scaled significantly.
- **Apply (Enter)**: The layer pixel data is updated, one undo entry labelled "Free Transform" is created, and the tool options bar returns to its normal state.
- **Undo**: Pressing Ctrl+Z (Cmd+Z on macOS) once after Apply reverses the entire transform in a single step and restores the layer to its pre-transform state.
- **Cancel (Escape)**: No pixel data change occurs (or lifted pixels are restored in selection mode); the selection is restored; no undo entry is recorded.
- **Out-of-bounds clipping**: Content moved or scaled so that part of it extends beyond the canvas boundary is clipped to the canvas on commit; no out-of-bounds pixels appear in the result.
- **Whole-layer all-transparent fallback**: Entering Transform Mode on a fully transparent layer produces a bounding box matching the full canvas dimensions.
- **Zero-size selection fallback**: Triggering Transform Mode with a zero-area selection does not crash and does not enter a broken state.

---

## Edge Cases & Constraints

- **Out-of-canvas transform box**: The user may drag the bounding box entirely outside the canvas. The live preview shows the content in its new position. On commit, all pixels outside the canvas boundary are discarded; if the entire box is outside the canvas the layer becomes fully transparent.
- **All-transparent layer**: The bounding box defaults to the full canvas dimensions (see functional requirements). The user can still scale, rotate, or reposition the empty layer.
- **Zero-size selection**: A selection with no area (e.g. created by a collapsed marquee) must not produce a zero-dimension bounding box. The implementation should either ignore the zero-size selection and fall back to whole-layer mode or present a non-actionable state with a user-visible hint.
- **Very small bounding box**: A 1×1 pixel selection is a valid transform target. Scaling it up works normally; the single pixel is resampled according to the chosen interpolation method.
- **Non-destructive adjustments on the layer**: Adjustment child layers attached to the active pixel layer are not included in the transform buffer. They remain in place and continue to composite normally after the transform is committed.
- **No warp / mesh distortion**: Arbitrary mesh warp is out of scope for this version. Only affine transformations (scale, rotate, translate, shear) and perspective are supported.
- **No non-destructive transform**: There is no "Smart Object" or non-destructive transform layer. Every commit is permanent (reversible only via undo).
- **Numerical overflow in toolbar**: If the user types an extremely large value into the W, H, X, or Y fields, the value should be clamped to a reasonable maximum (e.g. 10× the canvas dimension) to prevent performance or rendering issues.
- **Multi-layer selection**: Free Transform applies only to the single active layer. Transforming multiple layers simultaneously is out of scope.

---

## Related Features

- **Crop tool** (`src/tools/crop.tsx`) — the other primary geometric editing operation on the canvas; crop affects canvas dimensions while Free Transform only repositions/resamples content.
- **Selection tools** (`src/tools/select.tsx`, `src/tools/lasso.tsx`, `src/tools/magicWand.tsx`) — define the selection that Free Transform can lift as a floating buffer.
- **Move tool** (`src/tools/move.tsx`) — repositions layer content without resampling; Free Transform extends this to also scale, rotate, and distort.
- **Undo / History** — Free Transform records a single named history entry; the undo system must support labelled entries for accurate history panel display.
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — the rasterization pipeline composites the resampled buffer back into the layer on commit.
