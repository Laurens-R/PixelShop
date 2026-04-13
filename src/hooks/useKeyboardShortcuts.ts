import { useEffect } from 'react'
import { selectionStore } from '@/store/selectionStore'
import { cropStore } from '@/store/cropStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseKeyboardShortcutsOptions {
  handleUndo:               () => void
  handleRedo:               () => void
  handleCopy:               () => void
  handleCut:                () => void
  handlePaste:              () => void
  handleDelete:             () => void
  handleZoomIn:             () => void
  handleZoomOut:            () => void
  handleFitToWindow:        () => void
  handleToggleGrid:         () => void
  handleKeyboardShortcuts?: () => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useKeyboardShortcuts({
  handleUndo,
  handleRedo,
  handleCopy,
  handleCut,
  handlePaste,
  handleDelete,
  handleZoomIn,
  handleZoomOut,
  handleFitToWindow,
  handleToggleGrid,
  handleKeyboardShortcuts,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape')                                  { selectionStore.clear(); cropStore.clear(); return }
      if (e.key === 'Delete' || e.key === 'Backspace')         { e.preventDefault(); handleDelete(); return }
      if (e.key === '?' && !e.ctrlKey && !e.altKey)            { e.preventDefault(); handleKeyboardShortcuts?.(); return }
      if (!e.ctrlKey) return
      if      (e.key === 'z')              { e.preventDefault(); handleUndo() }
      else if (e.key === 'y')              { e.preventDefault(); handleRedo() }
      else if (e.key === 'c')              { e.preventDefault(); handleCopy() }
      else if (e.key === 'x')              { e.preventDefault(); handleCut() }
      else if (e.key === 'v')              { e.preventDefault(); handlePaste() }
      else if (e.key === '=' || e.key === '+') { e.preventDefault(); handleZoomIn() }
      else if (e.key === '-')              { e.preventDefault(); handleZoomOut() }
      else if (e.key === '0')              { e.preventDefault(); handleFitToWindow() }
      else if (e.key === 'g')              { e.preventDefault(); handleToggleGrid() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleUndo, handleRedo, handleCopy, handleCut, handlePaste, handleDelete, handleZoomIn, handleZoomOut, handleFitToWindow, handleToggleGrid, handleKeyboardShortcuts])
}
