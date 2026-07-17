import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type PrinterStatus = 'Online' | 'Offline' | 'Busy' | 'Error' | 'Unknown'

export interface PrinterInfo {
  name: string
  isDefault: boolean
  isConnected: boolean
  driverName: string
  portName: string
  status: PrinterStatus
  statusText: string
}

export interface PrinterListOptions {
  forceDeviceProbe?: boolean
  skipDeviceProbe?: boolean
}

interface DeviceProbeCache {
  expiresAt: number
  ready: boolean
  connectedPrinterNames: string[]
}

const DEVICE_PROBE_TTL = 10_000
// 不带设备探测（用缓存或跳过探测）的普通超时
const DEFAULT_TIMEOUT = 5000
// 带 Get-CimInstance / Get-PnpDevice 设备探测的调用，容易在冷启动、WMI 较慢或杀软拦截时超过默认超时，单独放宽
const DEVICE_PROBE_TIMEOUT = 12000

let deviceProbeCache: DeviceProbeCache = {
  expiresAt: 0,
  ready: false,
  connectedPrinterNames: []
}

const PS_HEADER = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
`

function toPowerShellStringArray(values: string[]) {
  if (values.length === 0) return '@()'

  return `@(${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ')})`
}

async function runPowerShell(script: string, timeout = DEFAULT_TIMEOUT) {
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `${PS_HEADER}\n${script}`],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout }
    )

    if (stderr.trim()) {
      throw new Error(stderr.trim())
    }

    return stdout.trim()
  } catch (err: any) {
    // execFile 超时会 kill 子进程，此时 code 为 null、signal 为 SIGTERM，且没有 stdout/stderr
    if (err?.killed && err?.signal === 'SIGTERM') {
      throw new Error(`PowerShell 命令超时（>${timeout}ms），已终止进程`)
    }
    throw err
  }
}

function normalizeStatus(printer: any): PrinterStatus {
  const printerStatus = String(printer.PrinterStatus ?? '').toLowerCase()

  if (printer.IsConnected === false || printer.WorkOffline || printer.PrinterStatus === 7) return 'Offline'
  if (printerStatus.includes('offline')) return 'Offline'
  if (printerStatus.includes('error')) return 'Error'
  if (printerStatus.includes('busy') || printerStatus.includes('printing')) return 'Busy'
  if (printerStatus.includes('normal') || printerStatus.includes('idle')) return 'Online'
  if ([1, 2, 5, 6, 8, 9, 10, 11].includes(Number(printer.DetectedErrorState))) return 'Error'
  if ([4, 5].includes(Number(printer.PrinterStatus))) return 'Busy'
  if (printer.PrinterStatus === 3 || printer.PrinterStatus === 0) return 'Online'
  return 'Unknown'
}

function statusLabel(status: PrinterStatus) {
  const labels: Record<PrinterStatus, string> = {
    Online: '在线',
    Offline: '离线',
    Busy: '忙碌',
    Error: '异常',
    Unknown: '未知'
  }

  return labels[status]
}

function willRunDeviceProbe(options: PrinterListOptions) {
  const hasFreshCache = Date.now() < deviceProbeCache.expiresAt
  return !options.skipDeviceProbe && (options.forceDeviceProbe || !hasFreshCache)
}

function buildDeviceProbeScript(options: PrinterListOptions) {
  const hasFreshCache = Date.now() < deviceProbeCache.expiresAt

  if (options.skipDeviceProbe || (!options.forceDeviceProbe && hasFreshCache)) {
    if (!deviceProbeCache.ready) {
      return '$cachedConnectedPrinterNames = $null'
    }

    return `$cachedConnectedPrinterNames = ${toPowerShellStringArray(deviceProbeCache.connectedPrinterNames)}`
  }

  return `
$presentPrinterNames = @()
try {
  $presentPrinterNames = @(
    Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPClass='Printer' AND Status='OK'" -ErrorAction Stop |
      ForEach-Object { $_.Name }
  )
} catch {
  try {
    $presentPrinterNames = @(
      Get-PnpDevice -PresentOnly -Class Printer -ErrorAction Stop |
        Where-Object { $_.Status -eq 'OK' } |
        ForEach-Object { $_.FriendlyName }
    )
  } catch {
    $presentPrinterNames = @()
  }
}
$cachedConnectedPrinterNames = $null
`
}

export async function getPrinters(options: PrinterListOptions = {}): Promise<PrinterInfo[]> {
  const probing = willRunDeviceProbe(options)

  let stdout: string
  try {
    stdout = await runPowerShell(
      `
$defaultDevice = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name Device -ErrorAction SilentlyContinue).Device
$defaultName = if ($defaultDevice) { ($defaultDevice -split ',')[0] } else { '' }

${buildDeviceProbeScript(options)}

try {
  Get-Printer -ErrorAction Stop |
    ForEach-Object {
      $name = [string]$_.Name
      $portName = [string]$_.PortName
      $driverName = [string]$_.DriverName
      $isUsbPort = $portName -match '^(USB|DOT4)'
      $normalizedName = $name.ToLowerInvariant()
      $normalizedDriverName = $driverName.ToLowerInvariant()
      $hasPresentDevice = $false

      if ($null -ne $cachedConnectedPrinterNames) {
        $hasPresentDevice = $cachedConnectedPrinterNames -contains $name
      } else {
        foreach ($pnpName in $presentPrinterNames) {
          if ([string]::IsNullOrWhiteSpace($pnpName)) { continue }

          $normalizedPnpName = ([string]$pnpName).ToLowerInvariant()
          if (
            $normalizedPnpName.Contains($normalizedName) -or
            $normalizedName.Contains($normalizedPnpName) -or
            ($normalizedDriverName.Length -gt 0 -and $normalizedPnpName.Contains($normalizedDriverName)) -or
            ($normalizedDriverName.Length -gt 0 -and $normalizedDriverName.Contains($normalizedPnpName))
          ) {
            $hasPresentDevice = $true
            break
          }
        }
      }

      $isConnected = if ($isUsbPort -and (($null -ne $cachedConnectedPrinterNames) -or $presentPrinterNames.Count -gt 0)) {
        $hasPresentDevice
      } else {
        -not $_.WorkOffline
      }

      [PSCustomObject]@{
        Name = $name
        Default = $name -eq $defaultName
        IsConnected = $isConnected
        DriverName = $driverName
        PortName = $portName
        PrinterStatus = $_.PrinterStatus
        WorkOffline = $_.WorkOffline
        DetectedErrorState = 0
      }
    } |
    ConvertTo-Json -Depth 4
} catch {
  $devices = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Devices' -ErrorAction SilentlyContinue
  if ($null -eq $devices) {
    @() | ConvertTo-Json -Depth 4
  } else {
    $devices.PSObject.Properties |
      Where-Object { $_.Name -notlike 'PS*' } |
      ForEach-Object {
        [PSCustomObject]@{
          Name = $_.Name
          Default = $_.Name -eq $defaultName
          IsConnected = $true
          DriverName = ''
          PortName = ([string]$_.Value -split ',')[-1]
          PrinterStatus = 'Unknown'
          WorkOffline = $false
          DetectedErrorState = 0
        }
      } |
      ConvertTo-Json -Depth 4
  }
}
`,
      probing ? DEVICE_PROBE_TIMEOUT : DEFAULT_TIMEOUT
    )
  } catch (err) {
    // 探测阶段超时/失败时，退化为跳过设备探测重试一次，保证至少能拿到打印机列表（只是连接状态可能不准）
    if (probing && !options.skipDeviceProbe) {
      console.warn('设备探测失败，回退为跳过探测重试:', err)
      return getPrinters({ ...options, skipDeviceProbe: true })
    }
    throw err
  }

  const rawOutput = stdout || '[]'

  let raw = JSON.parse(rawOutput)
  if (!Array.isArray(raw)) raw = [raw]

  if (!options.skipDeviceProbe) {
    deviceProbeCache = {
      expiresAt: Date.now() + DEVICE_PROBE_TTL,
      ready: true,
      connectedPrinterNames: raw
        .filter((p: any) => p.IsConnected !== false)
        .map((p: any) => String(p.Name ?? ''))
        .filter((name: string) => name.length > 0)
    }
  }

  return raw
    .filter((p: any) => typeof p.Name === 'string' && p.Name.length > 0)
    .map((p: any) => {
      const status = normalizeStatus(p)

      return {
        name: p.Name,
        isDefault: p.Default === true,
        isConnected: p.IsConnected !== false,
        driverName: String(p.DriverName ?? ''),
        portName: String(p.PortName ?? ''),
        status,
        statusText: statusLabel(status)
      }
    })
    .sort(
      (a: PrinterInfo, b: PrinterInfo) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        Number(b.isConnected) - Number(a.isConnected) ||
        a.name.localeCompare(b.name, 'zh-CN')
    )
}

// 只读注册表，不走 COM/WMI，速度极快，用来在 SetDefaultPrinter 超时后确认真实结果
async function getDefaultPrinterNameFast(): Promise<string> {
  const stdout = await runPowerShell(
    `
$defaultDevice = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name Device -ErrorAction SilentlyContinue).Device
if ($defaultDevice) { ($defaultDevice -split ',')[0] } else { '' }
`,
    3000
  )
  return stdout.trim()
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function setDefaultPrinter(name: string): Promise<void> {
  const safeName = name.replace(/'/g, "''")

  try {
    // 注意：这里不再用 Get-Printer 做存在性预检查——该 cmdlet 走 WMI/CIM，
    // 当目标打印机当前物理设备不在线（本项目里同一根 USB 线切换多台打印机时很常见）
    // 会长时间挂起甚至不返回。直接调用 SetDefaultPrinter 并用 try/catch 兜底即可，
    // 打印机名是否存在由 SetDefaultPrinter 自身的异常来反映。
    await runPowerShell(`
try {
  $network = New-Object -ComObject WScript.Network
  $network.SetDefaultPrinter('${safeName}')
} catch {
  throw "设置默认打印机失败: $($_.Exception.Message)"
}
`)
  } catch (err: any) {
    // WScript.Network.SetDefaultPrinter 在切换成功后会同步广播 WM_SETTINGCHANGE
    // 通知所有顶层窗口，如果系统里有窗口处理消息慢，这条广播会阻塞很久，
    // 导致 PowerShell 进程迟迟不退出而被我们的超时机制杀掉——但此时切换动作
    // 其实已经完成了。所以超时发生时，不要直接判定失败，而是用极快的注册表
    // 读取（不走 COM，不会被广播卡住）做几次重试确认，真的没切换成功再报错。
    const isTimeout = /PowerShell 命令超时/.test(err?.message ?? '')
    if (!isTimeout) throw err

    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(500)
      try {
        const currentDefault = await getDefaultPrinterNameFast()
        if (currentDefault === name) {
          // 实际已切换成功，吞掉这次超时错误
          return
        }
      } catch {
        // 确认查询本身失败，继续下一次重试
      }
    }

    throw err
  }
}