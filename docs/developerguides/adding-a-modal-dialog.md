# Adding a Modal Dialog

Modal dialogs are blocking UI that appear over the main canvas and require a user decision before the app can continue. They're used for operations like New Image, Export Settings, Resize Canvas, Keyboard Shortcuts, etc.

This guide uses a hypothetical **Rename Layer** dialog as the running example — a simple text-input dialog that lets the user rename the active layer.

---

## How modals work

Modal dialogs use the `ModalDialog` base component, which renders its children into a portal attached to `document.body`. This ensures the dialog is always on top, regardless of z-index stacking contexts in the layer panel or canvas.

```
User triggers action (menu click, keyboard shortcut, button press)
  ↓
App.tsx sets showRenameLayerDialog = true
  ↓
<RenameLayerDialog open={true} ...> mounts
  ↓
ModalDialog renders a backdrop + dialog box via createPortal
  ↓
User confirms → onConfirm() → App.tsx sets showRenameLayerDialog = false
User cancels or presses Escape → onCancel() / onClose() → closes
```

`ModalDialog` automatically handles:
- Closing on Escape key
- Closing on backdrop click
- Focus trapping (first focusable element is auto-focused)

You handle:
- Enter key (if the dialog has a confirm action)
- Input state
- Calling `onConfirm` / `onClose` at the right time

---

## Component category: Modals

Modals live in `src/ux/modals/<DialogName>/`. Do not put them in `ux/windows/` (which is for floating non-blocking panels) or `ux/main/` (which is for layout chrome).

---

## Step 1: Create the dialog folder and files

```
src/ux/modals/RenameLayerDialog/
  RenameLayerDialog.tsx
  RenameLayerDialog.module.scss
```

---

## Step 2: Write the component

```typescript
// src/ux/modals/RenameLayerDialog/RenameLayerDialog.tsx

import React, { useEffect, useRef, useState } from 'react'
import { ModalDialog, DialogButton } from '@/ux'
import styles from './RenameLayerDialog.module.scss'

interface Props {
  open:         boolean
  currentName:  string
  onConfirm(newName: string): void
  onCancel():   void
}

export function RenameLayerDialog({
  open,
  currentName,
  onConfirm,
  onCancel,
}: Props): React.JSX.Element | null {
  const [name, setName] = useState(currentName)
  const inputRef        = useRef<HTMLInputElement>(null)

  // Sync input when the dialog opens with a different layer name.
  useEffect(() => {
    if (open) {
      setName(currentName)
    }
  }, [open, currentName])

  // Auto-focus and select text when dialog opens.
  useEffect(() => {
    if (open) {
      // Small timeout allows the portal render to complete first.
      const id = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 16)
      return () => clearTimeout(id)
    }
  }, [open])

  const handleConfirm = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    }
  }

  return (
    <ModalDialog
      open={open}
      title="Rename Layer"
      width={360}
      onClose={onCancel}
    >
      <div className={styles.body} onKeyDown={handleKeyDown}>
        <label className={styles.label} htmlFor="layer-name">
          Layer name
        </label>
        <input
          id="layer-name"
          ref={inputRef}
          className={styles.input}
          type="text"
          value={name}
          maxLength={100}
          onChange={e => setName(e.target.value)}
        />
      </div>
      <div className={styles.actions}>
        <DialogButton variant="secondary" onClick={onCancel}>
          Cancel
        </DialogButton>
        <DialogButton
          variant="primary"
          onClick={handleConfirm}
          disabled={!name.trim()}
        >
          Rename
        </DialogButton>
      </div>
    </ModalDialog>
  )
}
```

### `ModalDialog` props

| Prop | Type | Description |
|---|---|---|
| `open` | `boolean` | Whether the dialog is visible. Keep the component mounted even when `open={false}` — `ModalDialog` handles the visibility. |
| `title` | `string` | Title bar text |
| `width` | `number` | Dialog width in CSS pixels (default: 480) |
| `onClose` | `() => void` | Called when Escape is pressed or backdrop is clicked |

`ModalDialog` does not render a footer — you provide the action buttons as children. Use `DialogButton` from `src/ux/widgets/` for consistent styling.

### Enter key handling

`ModalDialog` does not automatically confirm on Enter — only Escape is handled automatically. If your dialog has a primary action that should fire on Enter, add a `onKeyDown` handler that checks for `e.key === 'Enter'` and calls your confirm handler. Attach it to the dialog body `<div>`, not the input, so it fires from anywhere in the dialog.

### Auto-focus

`ModalDialog` does not auto-focus the first input. Add the `useEffect` pattern shown above to focus the primary input when the dialog opens. The 16 ms delay ensures the React render committed before you call `.focus()`.

### When to use `null` vs `false`

Returning `null` when `!open` prevents the component from rendering entirely. This is fine for dialogs that don't need to preserve state between opens. For dialogs that track unsaved input (e.g. New Image with preset fields), keep the component mounted with `open={false}` instead of conditionally rendering — `ModalDialog` will hide it.

---

## Step 3: Write the SCSS

```scss
// src/ux/modals/RenameLayerDialog/RenameLayerDialog.module.scss

.body {
  padding: 20px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 12px;
  color: var(--label-color);
  user-select: none;
}

.input {
  width: 100%;
  padding: 6px 8px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;

  &:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px var(--accent-color-faint);
  }
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
}
```

Use CSS variables from `src/styles/_variables.scss` for colors. Never hard-code `#hex` values in component styles — this ensures the dialog follows the dark/light theme automatically.

---

## Step 4: Export the dialog

```typescript
// src/ux/index.ts
export { RenameLayerDialog } from './modals/RenameLayerDialog/RenameLayerDialog'
```

All components are exported from this barrel. Never import from the full path in consuming files.

---

## Step 5: Add dialog state in `App.tsx`

```typescript
const [showRenameLayerDialog, setShowRenameLayerDialog] = React.useState(false)
```

---

## Step 6: Mount the dialog in `App.tsx`

```typescript
<RenameLayerDialog
  open={showRenameLayerDialog}
  currentName={activeLayer?.name ?? ''}
  onConfirm={(newName) => {
    handleRenameLayer(newName)           // dispatch to update layer name
    setShowRenameLayerDialog(false)
  }}
  onCancel={() => setShowRenameLayerDialog(false)}
/>
```

Keep `<RenameLayerDialog>` mounted at all times (not conditionally rendered). `ModalDialog` hides it when `open={false}`.

---

## Step 7: Open the dialog from menu actions and shortcuts

### From a top menu item

In `TopBar.tsx` (or the relevant menu builder), add a `MenuItem`:

```typescript
{
  label: 'Rename Layer',
  action: 'renameLayer',
  shortcut: { key: 'F2' },
}
```

In `App.tsx`'s menu handler:

```typescript
case 'renameLayer':
  setShowRenameLayerDialog(true)
  break
```

### From a keyboard shortcut

In `src/core/services/useKeyboardShortcuts.ts`:

```typescript
case 'F2':
  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
    setShowRenameLayerDialog(true)
    e.preventDefault()
  }
  break
```

### From a button press (e.g., Layer Panel context menu)

Pass `onRenameLayer` as a callback prop down to `LayerPanel`, which can call it from a context menu or double-click handler.

---

## Step 8: Add to the macOS native menu (if needed)

If the dialog is accessible from the top menu bar, also add it to the native macOS menu in `App.tsx`'s `macMenuHandlerRef`:

```typescript
case 'renameLayer':
  setShowRenameLayerDialog(true)
  break
```

---

## Complete example: a multi-input dialog

For reference, here's the pattern for a dialog with multiple inputs and presets (from `NewImageDialog`):

```typescript
export function NewImageDialog({ open, onConfirm, onCancel }: Props) {
  const [width,  setWidth]  = useState(1920)
  const [height, setHeight] = useState(1080)
  const [name,   setName]   = useState('Untitled')

  // Reset to defaults when dialog opens
  useEffect(() => {
    if (open) {
      setWidth(1920); setHeight(1080); setName('Untitled')
    }
  }, [open])

  const handleConfirm = () => {
    if (width < 1 || height < 1) return
    onConfirm({ width, height, name: name.trim() || 'Untitled' })
  }

  return (
    <ModalDialog open={open} title="New Image" width={440} onClose={onCancel}>
      <div className={styles.body} onKeyDown={e => e.key === 'Enter' && handleConfirm()}>
        <div className={styles.presets}>
          <button onClick={() => { setWidth(1920); setHeight(1080) }}>1080p</button>
          <button onClick={() => { setWidth(3840); setHeight(2160) }}>4K</button>
        </div>
        <FieldRow label="Width">
          <input type="number" value={width} min={1} max={16384}
            onChange={e => setWidth(Number(e.target.value))} />
          <span>px</span>
        </FieldRow>
        <FieldRow label="Height">
          <input type="number" value={height} min={1} max={16384}
            onChange={e => setHeight(Number(e.target.value))} />
          <span>px</span>
        </FieldRow>
        <FieldRow label="Name">
          <input type="text" value={name} maxLength={100}
            onChange={e => setName(e.target.value)} />
        </FieldRow>
      </div>
      <div className={styles.actions}>
        <DialogButton variant="secondary" onClick={onCancel}>Cancel</DialogButton>
        <DialogButton variant="primary" onClick={handleConfirm}
          disabled={width < 1 || height < 1}>
          Create
        </DialogButton>
      </div>
    </ModalDialog>
  )
}
```

---

## Complete checklist

- [ ] Create `src/ux/modals/RenameLayerDialog/RenameLayerDialog.tsx`
  - [ ] Wraps `<ModalDialog open title width onClose>`
  - [ ] Enter key handler on the body `<div>`
  - [ ] Auto-focus primary input on open (16 ms delayed `useEffect`)
  - [ ] `DialogButton` for Cancel and confirm actions
- [ ] Create `RenameLayerDialog.module.scss` using CSS variables
- [ ] Export from `src/ux/index.ts`
- [ ] Add `showRenameLayerDialog` state in `App.tsx`
- [ ] Mount `<RenameLayerDialog>` in `App.tsx` render (always mounted, not conditional)
- [ ] Open from menu action handler in `App.tsx`
- [ ] Open from keyboard shortcut in `useKeyboardShortcuts.ts`
- [ ] List shortcut in `KeyboardShortcutsDialog.tsx`
- [ ] Open from macOS native menu handler (if applicable)
