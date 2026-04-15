import { contextBridge, ipcRenderer } from 'electron'
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
