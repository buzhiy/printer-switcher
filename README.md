# PrinterSwitcher

自动识别当前在线设备并一键切换 Windows 默认打印机。

## 功能

- 🔌 自动探测当前通过 USB 连接、真实在线的打印机（区分"已安装但设备不在线"和"当前物理连接"）
- 🖱️ 一键切换 Windows 默认打印机
- 📋 打印机列表展示：名称、驱动、端口、连接状态、是否为当前默认
- ⚡ 内置设备探测结果缓存，避免频繁的 WMI 查询拖慢响应
- 🪟 Windows 桌面客户端，基于 Electron，开箱即用

## 技术栈

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [Vue 3](https://vuejs.org/) + TypeScript
- [Element Plus](https://element-plus.org/) 组件库
- 打印机信息获取与默认打印机切换通过调用 Windows PowerShell（`Get-Printer` / `Get-CimInstance` / `WScript.Network` COM 对象）实现

## 项目结构

```
printer-switcher/
├── electron/               # Electron 相关配置
├── src/
│   ├── assets/
│   ├── components/
│   │   └── PrinterSwitcher.vue   # 打印机切换主界面
│   ├── main/
│   │   ├── index.ts               # Electron 主进程入口
│   │   └── printer.ts             # 打印机探测 / 切换核心逻辑（PowerShell 调用）
│   ├── preload/                   # 预加载脚本，暴露安全的 IPC 接口
│   ├── App.vue
│   ├── main.ts
│   └── style.css
├── public/
├── electron-builder.json5         # 打包配置
├── vite.config.ts
└── package.json
```

## 环境要求

- Windows 10 / 11（依赖 Windows PowerShell 与打印机相关 Windows API，暂不支持 macOS / Linux）
- Node.js 18+
- pnpm / npm / yarn 任一包管理器

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/buzhiy/printer-switcher.git
cd printer-switcher

# 安装依赖
npm install

# 开发模式启动
npm run dev
```

## 打包

```bash
npm run build
```

打包产物会输出到 `release/` 目录下（基于 electron-builder 配置）。

## 工作原理简述

1. 通过 `Get-Printer` 获取 Windows 上已安装的打印机列表；
2. 通过 `Get-CimInstance` / `Get-PnpDevice` 探测哪些打印机对应的物理设备当前处于"在线/已连接"状态，用于区分同一根 USB 线切换后哪台才是真正当前接入的打印机；
3. 用户选择目标打印机后，通过 `WScript.Network` COM 对象的 `SetDefaultPrinter` 方法设置为系统默认打印机。

![alt text](/img/image.png)
## 已知限制

- 仅支持 Windows，依赖 PowerShell 环境
- 打印机在线状态的探测依赖设备名称与驱动名称的模糊匹配，极少数情况下可能识别不准确
- `SetDefaultPrinter` 调用后系统会广播设置变更通知，个别系统环境下该广播耗时较长，属于 Windows 自身行为

## 贡献

欢迎提 Issue 和 PR。如果你在其他打印机型号 / 驱动上遇到探测不准确的情况，欢迎附上 `Get-Printer` 和 `Get-CimInstance` 的原始输出以便排查。

## License

[MIT](./LICENSE)