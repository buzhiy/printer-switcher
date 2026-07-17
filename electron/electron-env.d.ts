/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer
  printerAPI: {
    list: (options?: { forceDeviceProbe?: boolean; skipDeviceProbe?: boolean }) => Promise<
      {
        name: string
        isDefault: boolean
        isConnected: boolean
        driverName: string
        portName: string
        status: 'Online' | 'Offline' | 'Busy' | 'Error' | 'Unknown'
        statusText: string
      }[]
    >
    setDefault: (name: string) => Promise<boolean>
  }
}
