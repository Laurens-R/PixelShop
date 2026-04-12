import { ipcMain, dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'

export function registerIpcHandlers(): void {
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
      filters: [{ name: 'PixelShop Document', extensions: ['pxshop'] }]
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
}
