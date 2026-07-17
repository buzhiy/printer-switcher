import { ElectronAPI } from '@electron-toolkit/preload'

export interface PrinterInfo {
  name: string
  isDefault: boolean
  status: string
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    printerAPI: {
      list: () => Promise<PrinterInfo[]>
      setDefault: (name: string) => Promise<boolean>
    }
  }
}