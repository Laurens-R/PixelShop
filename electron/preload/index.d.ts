import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openDevTools: () => Promise<void>
      openFile: () => Promise<string | null>
      saveFile: () => Promise<string | null>
      openPxshopDialog: () => Promise<string | null>
      savePxshopDialog: (defaultPath?: string) => Promise<string | null>
      openPxshopFile: (path: string) => Promise<string>
      savePxshopFile: (path: string, data: string) => Promise<void>
      exportBrowse: (ext: string) => Promise<string | null>
      exportImage: (path: string, base64: string) => Promise<void>
    }
  }
}
