# Layer Groups / Folders

## Overview

Non-destructive organisational containers in the layer stack. A group holds an ordered list of child layers and is composited as a sub-stack before being blended into the parent context. This is the direct equivalent of Photoshop's Layer Groups.

## Out of Scope

- Smart Objects
- Artboards
- Clipping Masks

---

## User Stories

1. **Create group** — As a user I can create an empty group layer so I can organise related layers together.
2. **Move layers into group** — As a user I can drag existing layers into a group (and out again) so I can reorganise my document.
3. **Collapse / expand** — As a user I can toggle a group's expanded state so the layer list stays manageable on complex documents.
4. **Nested groups** — As a user I can place groups inside groups (unlimited depth) to model hierarchical content.
5. **Group opacity & blend mode** — As a user I can set a group's opacity and blend mode (Pass Through or any standard mode) so I can control how the group composites.
6. **Pass Through compositing** — As a user I can set a group to Pass Through so adjustment layers inside affect the layers below the group, not just layers inside it.
7. **Adjustment layers scoped to group** — As a user, adjustment layers inside a group only affect pixel/shape/text layers below them *within that group* (unless the group is Pass Through, in which case they pass through to the full stack below).
8. **Standard operations on groups** — Show/hide, lock, duplicate, delete all work on groups; acting on a group affects the group and all its descendants.
9. **Merge group** — As a user I can merge/flatten a group into a single raster pixel layer.

---

## Functional Requirements

### FR-1: GroupLayerState

A new layer kind `'group'` is added to `LayerState`. Fields:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique layer ID |
| `name` | `string` | Display name |
| `visible` | `boolean` | Controls group + all children |
| `locked` | `boolean` | Prevents direct editing |
| `opacity` | `number` | 0–1 |
| `blendMode` | `BlendMode \| 'pass-through'` | How the group composites |
| `type` | `'group'` | Discriminant |
| `collapsed` | `boolean` | UI-only: hides children in layer panel |
| `childIds` | `string[]` | Ordered list (bottom-to-top) of direct child layer IDs |

> `childIds` is the source of truth for group membership and child ordering. The flat `layers` array in `AppState` still contains all layers; `childIds` forms the tree structure.

### FR-2: Layer Tree Model

`AppState.layers` remains a flat array. Group membership is encoded by `childIds`. Root layers are those whose IDs do not appear in any group's `childIds`. This avoids deep nesting in serialised state and keeps existing reducer patterns intact.

### FR-3: Blend Modes for Groups

`'pass-through'` is added to `BlendMode` in `src/types/index.ts`. The blend mode selector for groups shows `Pass Through` as the first option, followed by all existing blend modes.

### FR-4: Compositing Semantics

| Group blend mode | Compositing behaviour |
|---|---|
| `pass-through` | Children are composited directly into the parent context in order, as if the group did not exist. Adjustment layers inside affect everything below them in the full stack. |
| Any other mode | Children are composited into an isolated off-screen buffer at full opacity; the buffer is then blended into the parent stack using the group's opacity and blend mode. Adjustment layers inside only affect layers below them within the group's isolated buffer. |

### FR-5: Adjustment Layer Scope

An adjustment layer inside a group only applies to pixel/shape/text layers **below it in the same group's child list** when the group uses Normal (or any isolated) blend mode. Under Pass Through the adjustment passes through to the full stack below.

### FR-6: Layer Panel — Tree Rendering

- Groups show a disclosure triangle (▶ collapsed, ▼ expanded).
- Child layers are indented by `16 px` per nesting level.
- Collapsing a group hides its children in the UI only (they remain active in compositing).
- The active layer indicator still highlights the correct row even when the group is collapsed (the group row highlights instead).

### FR-7: Drag-and-Drop

- Layers can be dragged into a group (drop onto a group row, or between children).
- Layers can be dragged out of a group.
- Groups themselves can be reordered in the stack.
- A drop indicator line shows the insertion position.
- A layer cannot be dragged into one of its own descendants (cycle prevention).

### FR-8: Footer "New Group" Button

A new "New Group" button (folder icon) is added to the layer panel footer. It creates an empty group above the active layer. If one or more layers are multi-selected, those layers are moved into the new group.

### FR-9: Context Menu Additions

The right-click context menu gains:

| Item | Condition |
|---|---|
| New Group from Selection | ≥ 2 layers selected |
| Ungroup | Active layer is a group |
| Merge Group | Active layer is a group |

### FR-10: Standard Operations on Groups

| Operation | Behaviour |
|---|---|
| Toggle visibility | Group + all descendants toggled |
| Toggle lock | Group only |
| Duplicate | Deep-copies group and all descendants with new IDs |
| Delete | Removes group and all descendants |
| Rename | Renames group label only |

### FR-11: Merge Group

Merging a group rasterizes its contents (using the unified rasterization pipeline) into a single `PixelLayerState` inserted at the group's position in the parent stack. The group and all descendants are removed.

### FR-12: Keyboard Shortcuts

`Ctrl+G` (Cmd+G on macOS) — Group selected layers (equivalent to "New Group from Selection").  
`Ctrl+Shift+G` — Ungroup.

---

## Non-Functional Requirements

- Unlimited nesting depth with no performance degradation from the tree traversal itself (O(n) walk, where n = total layer count).
- Collapsing a group must not change compositing output.
- Pass-through groups must produce pixel-identical output to having no group at all (regression-testable).
- All existing reducer actions that accept `LayerState[]` (`REORDER_LAYERS`, `RESTORE_LAYERS`, `RESTORE_TAB`, etc.) continue to work unchanged; the flat array always includes group layers.

---

## Acceptance Criteria

- [ ] Groups appear in the layer panel with a disclosure triangle.
- [ ] Collapsing a group hides children in the panel but not in the canvas output.
- [ ] Layers can be dragged into and out of groups.
- [ ] Groups can be nested inside other groups.
- [ ] Pass Through group produces the same pixel output as no group.
- [ ] Normal-mode group isolates adjustment layers to its children.
- [ ] Merge Group produces the same pixel output as the pre-merge composite.
- [ ] Delete group removes all descendants.
- [ ] Duplicate group deep-copies all descendants with new IDs.
- [ ] Ctrl+G groups selected layers; Ctrl+Shift+G ungroups.
