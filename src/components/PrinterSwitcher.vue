<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Aim, Connection, Printer, Refresh, SwitchButton, Timer } from '@element-plus/icons-vue'

interface PrinterInfo {
  name: string
  isDefault: boolean
  isConnected: boolean
  driverName: string
  portName: string
  status: 'Online' | 'Offline' | 'Busy' | 'Error' | 'Unknown'
  statusText: string
}

type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

interface RefreshOptions {
  autoSwitch?: boolean
  forceDeviceProbe?: boolean
  showLoading?: boolean
}

const TARGET_KEY = 'printer-switcher.target'
const AUTO_REFRESH_KEY = 'printer-switcher.auto-refresh'
const REFRESH_SECONDS_KEY = 'printer-switcher.refresh-seconds'
const DEEP_PROBE_KEY = 'printer-switcher.deep-probe'

const printers = ref<PrinterInfo[]>([])
const loading = ref(false)
const switching = ref<string | null>(null)
const refreshingInBackground = ref(false)
const targetPrinter = ref(localStorage.getItem(TARGET_KEY) ?? '')
const autoRefreshEnabled = ref(localStorage.getItem(AUTO_REFRESH_KEY) !== 'false')
const refreshSeconds = ref(Number(localStorage.getItem(REFRESH_SECONDS_KEY)) || 3)
const deepProbeEnabled = ref(localStorage.getItem(DEEP_PROBE_KEY) === 'true')
let timer: ReturnType<typeof setInterval> | null = null

const normalizedRefreshSeconds = computed(() => Math.min(60, Math.max(1, refreshSeconds.value || 3)))
const defaultPrinter = computed(() => printers.value.find((printer) => printer.isDefault))
const connectedCount = computed(() => printers.value.filter((printer) => printer.isConnected).length)
const selectedTarget = computed(() => printers.value.find((printer) => printer.name === targetPrinter.value))
const canAutoSwitch = computed(
  () => selectedTarget.value?.isConnected && selectedTarget.value.status !== 'Error' && !selectedTarget.value.isDefault
)

function connectionType(printer: PrinterInfo): TagType {
  if (!printer.isConnected) return 'danger'
  if (printer.status === 'Error') return 'danger'
  if (printer.status === 'Busy') return 'warning'
  if (printer.status === 'Unknown') return 'info'
  return 'success'
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function startTimer() {
  stopTimer()

  if (!autoRefreshEnabled.value) return

  timer = setInterval(() => {
    void refresh({ showLoading: false })
  }, normalizedRefreshSeconds.value * 1000)
}

async function refresh(options: RefreshOptions = {}) {
  if (loading.value || refreshingInBackground.value) return

  const showLoading = options.showLoading ?? true
  const autoSwitch = options.autoSwitch ?? true

  if (showLoading) {
    loading.value = true
  } else {
    refreshingInBackground.value = true
  }

  try {
    printers.value = await window.printerAPI.list({
      forceDeviceProbe: options.forceDeviceProbe,
      skipDeviceProbe: !options.forceDeviceProbe
    })

    if (autoSwitch) {
      await switchToTargetIfReady()
    }
  } catch (e: any) {
    ElMessage.error(e?.message ?? '获取打印机列表失败')
  } finally {
    loading.value = false
    refreshingInBackground.value = false
  }
}

async function switchToTargetIfReady() {
  if (!targetPrinter.value || switching.value || !canAutoSwitch.value) return

  await selectPrinter(targetPrinter.value, false)
}

async function selectPrinter(name: string, refreshAfterSwitch = true) {
  switching.value = name

  try {
    await window.printerAPI.setDefault(name)
    ElMessage.success(`已切换默认打印机：${name}`)

    if (refreshAfterSwitch) {
      await refresh({ autoSwitch: false, forceDeviceProbe: false })
    } else {
      printers.value = printers.value.map((printer) => ({
        ...printer,
        isDefault: printer.name === name
      }))
    }
  } catch (e: any) {
    ElMessage.error(`设置默认打印机失败：${e?.message ?? e}`)
  } finally {
    switching.value = null
  }
}

function setTarget(name: string) {
  targetPrinter.value = name
  localStorage.setItem(TARGET_KEY, name)
  ElMessage.success(`已锁定目标打印机：${name}`)
  void switchToTargetIfReady()
}

function clearTarget() {
  targetPrinter.value = ''
  localStorage.removeItem(TARGET_KEY)
  ElMessage.info('已取消自动切换')
}

function manualRefresh() {
  void refresh({ forceDeviceProbe: deepProbeEnabled.value })
}

watch(autoRefreshEnabled, (value) => {
  localStorage.setItem(AUTO_REFRESH_KEY, String(value))
  startTimer()
})

watch(refreshSeconds, (value) => {
  refreshSeconds.value = Math.min(60, Math.max(1, value || 3))
  localStorage.setItem(REFRESH_SECONDS_KEY, String(refreshSeconds.value))
  startTimer()
})

watch(deepProbeEnabled, (value) => {
  localStorage.setItem(DEEP_PROBE_KEY, String(value))
})

onMounted(() => {
  void refresh({ forceDeviceProbe: deepProbeEnabled.value })
  startTimer()
})

onUnmounted(() => {
  stopTimer()
})
</script>

<template>
  <main class="app-shell">
    <section class="hero-bar">
      <div>
        <p class="eyebrow">打印机切换程序</p>
        <h1>默认打印机控制台</h1>
      </div>

      <el-button :icon="Refresh" :loading="loading" type="primary" @click="manualRefresh">
        刷新
      </el-button>
    </section>

    <el-card class="settings-card" shadow="never">
      <div class="settings-row">
        <div class="setting-item">
          <span class="setting-label">自动刷新</span>
          <el-switch v-model="autoRefreshEnabled" active-text="开" inactive-text="关" />
        </div>

        <div class="setting-item">
          <span class="setting-label">刷新间隔</span>
          <el-input-number
            v-model="refreshSeconds"
            :min="1"
            :max="60"
            :step="1"
            controls-position="right"
            size="small"
          />
          <span class="unit">秒</span>
        </div>

        <div class="setting-item">
          <span class="setting-label">深度检测</span>
          <el-switch v-model="deepProbeEnabled" active-text="开" inactive-text="关" />
        </div>

        <div class="refresh-state">
          <el-icon><Timer /></el-icon>
          <span>{{ refreshingInBackground ? '后台刷新中' : autoRefreshEnabled ? `${normalizedRefreshSeconds} 秒/次` : '自动刷新已关闭' }}</span>
        </div>
      </div>
    </el-card>

    <el-row :gutter="14" class="summary-grid">
      <el-col :xs="24" :sm="8">
        <el-card shadow="never">
          <el-statistic title="当前默认打印机" :value="defaultPrinter?.name ?? '未检测到'" />
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="8">
        <el-card shadow="never">
          <el-statistic title="锁定目标" :value="targetPrinter || '未锁定'" />
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="8">
        <el-card shadow="never">
          <el-statistic title="已连接设备" :value="`${connectedCount}/${printers.length}`" />
        </el-card>
      </el-col>
    </el-row>

    <el-alert
      class="hint"
      :closable="false"
      show-icon
      type="info"
      title="自动刷新使用快速模式；需要确认 USB 拔插状态时打开“深度检测 USB”后点刷新。深度检测会更准，但会比普通刷新慢。"
    />

    <el-card class="table-card" shadow="never">
      <template #header>
        <div class="table-header">
          <span>打印机列表</span>
          <el-button v-if="targetPrinter" text type="primary" @click="clearTarget">
            取消锁定
          </el-button>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="printers"
        row-key="name"
        empty-text="未检测到打印机"
        class="printer-table"
      >
        <el-table-column label="打印机" min-width="280">
          <template #default="{ row }: { row: PrinterInfo }">
            <div class="printer-name">
              <el-icon><Printer /></el-icon>
              <span>{{ row.name }}</span>
            </div>
            <div class="printer-subline">
              端口：{{ row.portName || '未知' }}
              <span v-if="row.driverName"> · 驱动：{{ row.driverName }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="连接状态" width="150">
          <template #default="{ row }: { row: PrinterInfo }">
            <el-tag :type="connectionType(row)" effect="light">
              {{ row.isConnected ? row.statusText : 'USB 未连接' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="标记" width="210">
          <template #default="{ row }: { row: PrinterInfo }">
            <div class="tag-stack">
              <el-tag v-if="row.isDefault" :icon="SwitchButton" type="primary" effect="plain">
                当前默认
              </el-tag>
              <el-tag v-if="row.name === targetPrinter" :icon="Aim" type="warning" effect="plain">
                自动目标
              </el-tag>
              <el-tag v-if="row.isConnected" :icon="Connection" type="success" effect="plain">
                已连接
              </el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }: { row: PrinterInfo }">
            <div class="row-actions">
              <el-button
                :disabled="row.name === targetPrinter"
                size="small"
                @click="setTarget(row.name)"
              >
                锁定
              </el-button>
              <el-button
                :disabled="row.isDefault || !row.isConnected"
                :loading="switching === row.name"
                size="small"
                type="primary"
                @click="selectPrinter(row.name)"
              >
                设为默认
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </main>
</template>
