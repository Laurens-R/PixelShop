import { ipcMain, dialog, BrowserWindow, app, clipboard, nativeImage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function registerIpcHandlers(): void {
  ipcMain.handle('debug:openDevTools', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools()
  })

  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      filters: [
        { name: 'PNG Image', extensions: ['png'] },
        { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }
      ]
    })
    return canceled ? null : filePath
  })

  ipcMain.handle('dialog:openPxshop', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'All Supported',       extensions: ['pxshop', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: 'PixelShop Document',  extensions: ['pxshop'] },
        { name: 'Images',              extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: 'All Files',           extensions: ['*'] },
      ]
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('dialog:savePxshop', async (_event, defaultPath?: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath,
      filters: [{ name: 'PixelShop Document', extensions: ['pxshop'] }]
    })
    return canceled ? null : filePath
  })

  ipcMain.handle('file:openPxshop', async (_event, path: string) => {
    return readFile(path, 'utf-8')
  })

  ipcMain.handle('file:savePxshop', async (_event, path: string, data: string) => {
    await writeFile(path, data, 'utf-8')
  })

  ipcMain.handle('dialog:exportBrowse', async (_event, ext: string) => {
    const filters =
      ext === 'png'  ? [{ name: 'PNG Image',  extensions: ['png']         }] :
      ext === 'webp' ? [{ name: 'WebP Image', extensions: ['webp']        }] :
                       [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }]
    const { canceled, filePath } = await dialog.showSaveDialog({ filters })
    return canceled ? null : filePath
  })

  ipcMain.handle('file:readFileBase64', async (_event, path: string) => {
    const buffer = await readFile(path)
    return buffer.toString('base64')
  })

  ipcMain.handle('file:exportImage', async (_event, path: string, base64: string) => {
    const buffer = Buffer.from(base64, 'base64')
    await writeFile(path, buffer)
  })

  ipcMain.handle('presets:loadCurvesPresets', async () => {
    const presetsPath = join(app.getPath('userData'), 'curves-presets.json')
    try {
      const data = await readFile(presetsPath, 'utf-8')
      return JSON.parse(data)
    } catch {
      // File doesn't exist yet or is corrupt; return empty array
      return []
    }
  })

  ipcMain.handle('presets:saveCurvesPresets', async (_event, presets: unknown) => {
    const presetsPath = join(app.getPath('userData'), 'curves-presets.json')
    const json = JSON.stringify(presets, null, 2)
    await writeFile(presetsPath, json, 'utf-8')
  })

  ipcMain.handle('dialog:openPalette', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Palette', extensions: ['palette'] }],
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('dialog:savePaletteAs', async (_event, defaultPath?: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath,
      filters: [{ name: 'Palette', extensions: ['palette'] }],
    })
    return canceled ? null : filePath
  })

  ipcMain.handle('file:readPalette', async (_event, path: string) => {
    return readFile(path, 'utf-8')
  })

  ipcMain.handle('file:writePalette', async (_event, path: string, data: string) => {
    await writeFile(path, data, 'utf-8')
  })

  ipcMain.handle('clipboard:write-image', (_event, pngBase64: string) => {
    const buf = Buffer.from(pngBase64, 'base64')
    const img = nativeImage.createFromBuffer(buf)
    clipboard.writeImage(img)
  })

  ipcMain.handle('clipboard:read-image', () => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    return img.toPNG().toString('base64')
  })
}
