import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 自定义 API
const api = {}

const printerAPI = {
  list: () => ipcRenderer.invoke('printer:list'),
  setDefault: (name: string) => ipcRenderer.invoke('printer:setDefault', name)
}

// 通过 contextBridge 暴露给渲染进程，前提是 contextIsolation 打开（默认就是打开的）
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('printerAPI', printerAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.printerAPI = printerAPI
}