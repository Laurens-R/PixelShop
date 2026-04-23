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
      readFileBase64: (path: string) => Promise<string>
      loadCurvesPresets: () => Promise<CurvesPreset[]>
      saveCurvesPresets: (presets: CurvesPreset[]) => Promise<void>
      openPaletteDialog: () => Promise<string | null>
      savePaletteAsDialog: (defaultPath?: string) => Promise<string | null>
      readPaletteFile: (path: string) => Promise<string>
      writePaletteFile: (path: string, data: string) => Promise<void>
      clipboardWriteImage: (pngBase64: string) => Promise<void>
      clipboardReadImage: () => Promise<string | null>
      // Recent files
      getRecentFiles: () => Promise<string[]>
      addRecentFile: (path: string) => Promise<string[]>
      clearRecentFiles: () => Promise<void>
      // App lifecycle
      exitApp: () => Promise<void>
      // Platform & native menu (macOS)
      platform: string
      onMenuAction: (callback: (actionId: string) => void) => (() => void)
      buildNativeMenu: (payload: {
        adjustments:  Array<{ id: string; label: string; group?: string }>
        effects:      Array<{ id: string; label: string; group?: string }>
        filters:      Array<{ id: string; label: string; instant?: boolean; group?: string }>
        recentFiles:  string[]
      }) => void
      setMenuItemEnabled: (updates: Record<string, boolean>) => void
      setMenuItemChecked: (updates: Record<string, boolean>) => void
    }
  }

  interface CurvesControlPoint {
    id: string
    x: number
    y: number
  }

  interface CurvesChannelCurve {
    points: CurvesControlPoint[]
  }

  type CurvesChannel = 'rgb' | 'red' | 'green' | 'blue'

  interface CurvesPreset {
    id: string
    name: string
    channels: Record<CurvesChannel, CurvesChannelCurve>
  }
}
