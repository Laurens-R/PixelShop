import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  openDevTools: (): Promise<void> => ipcRenderer.invoke('debug:openDevTools'),
  openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:saveFile'),
  openPxshopDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openPxshop'),
  savePxshopDialog: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:savePxshop', defaultPath),
  openPxshopFile: (path: string): Promise<string> => ipcRenderer.invoke('file:openPxshop', path),
  savePxshopFile: (path: string, data: string): Promise<void> =>
    ipcRenderer.invoke('file:savePxshop', path, data),
  exportBrowse: (ext: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportBrowse', ext),
  exportImage: (path: string, base64: string): Promise<void> =>
    ipcRenderer.invoke('file:exportImage', path, base64),
  readFileBase64: (path: string): Promise<string> =>
    ipcRenderer.invoke('file:readFileBase64', path),
  loadCurvesPresets: (): Promise<unknown> =>
    ipcRenderer.invoke('presets:loadCurvesPresets'),
  saveCurvesPresets: (presets: unknown): Promise<void> =>
    ipcRenderer.invoke('presets:saveCurvesPresets', presets),
  openPaletteDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openPalette'),
  savePaletteAsDialog: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:savePaletteAs', defaultPath),
  readPaletteFile: (path: string): Promise<string> =>
    ipcRenderer.invoke('file:readPalette', path),
  writePaletteFile: (path: string, data: string): Promise<void> =>
    ipcRenderer.invoke('file:writePalette', path, data),
  clipboardWriteImage: (pngBase64: string): Promise<void> =>
    ipcRenderer.invoke('clipboard:write-image', pngBase64),
  clipboardReadImage: (): Promise<string | null> =>
    ipcRenderer.invoke('clipboard:read-image'),

  // ── Platform & native menu (macOS) ────────────────────────────────
  platform: process.platform as string,

  /** Listen for native menu actions. Returns a cleanup function that removes the listener. */
  onMenuAction: (callback: (actionId: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, actionId: string): void => callback(actionId)
    ipcRenderer.on('menu:action', handler)
    return () => ipcRenderer.removeListener('menu:action', handler)
  },

  /** Send the full menu structure to the main process to build the native macOS menu. */
  buildNativeMenu: (payload: {
    adjustments: Array<{ id: string; label: string; group?: string }>
    effects:     Array<{ id: string; label: string; group?: string }>
    filters:     Array<{ id: string; label: string; instant?: boolean; group?: string }>
  }): void => {
    ipcRenderer.send('menu:build', payload)
  },

  /** Update the enabled state of one or more native menu items by ID. */
  setMenuItemEnabled: (updates: Record<string, boolean>): void => {
    ipcRenderer.send('menu:set-enabled', updates)
  },

  /** Update the checked state of one or more native menu checkboxes by ID. */
  setMenuItemChecked: (updates: Record<string, boolean>): void => {
    ipcRenderer.send('menu:set-checked', updates)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
