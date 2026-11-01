<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="备份管理" description="表数据导出 (sql/db/json) / 定时备份到 R2 / 备份列表下载·导入·删除">
      <template #actions>
        <button class="btn-secondary" @click="reloadAll">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" :disabled="running" @click="runNow">
          <Icon name="refresh" v-if="running" class="animate-spin" />
          <Icon v-else name="database" /> 立即备份到 {{ storageShort }}
        </button>
      </template>
    </PageHeader>

    <!-- 存储模式提示 -->
    <div v-if="storageError" class="card p-4 border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
      <div class="flex items-start gap-2">
        <Icon name="alert" class="text-amber-500 mt-0.5" />
        <div>
          <p class="font-medium text-amber-700 dark:text-amber-300">云端备份存储未就绪</p>
          <p class="text-amber-600 dark:text-amber-400 mt-1">{{ storageError }}</p>
          <p class="text-amber-600 dark:text-amber-400 mt-1">
            本地 Node 部署自动回落 db-snapshots/backups/; Cloudflare 部署需在 wrangler.toml 配置 R2 绑定 BACKUP_R2。
          </p>
        </div>
      </div>
    </div>

    <!-- 数据导出 -->
    <div class="card p-5">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <h3 class="font-medium text-slate-900 dark:text-white flex items-center gap-2">
          <Icon name="download" class="text-brand-500" /> 数据导出
        </h3>
        <div class="flex items-center gap-2 flex-wrap">
          <button class="btn-secondary !py-1.5 !px-3" @click="selectAll">全选</button>
          <button class="btn-secondary !py-1.5 !px-3" @click="selectedTables = []">取消</button>
          <div class="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
            <button
              v-for="f in FORMAT_OPTIONS"
              :key="f.value"
              class="px-3 py-1.5 rounded-md text-slate-600 dark:text-slate-300 transition-colors"
              :class="exportFormat === f.value ? 'bg-brand-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-700'"
              @click="exportFormat = f.value"
            >
              {{ f.label }}
            </button>
          </div>
          <button class="btn-primary" :disabled="!selectedTables.length || exporting" @click="doExport">
            <Icon name="download" /> 导出 ({{ selectedTables.length }} 表)
          </button>
        </div>
      </div>
      <p class="text-slate-400 mt-2">
        .sql = 逐表 DELETE+INSERT 语句 · .db = SQLite 快照文件 (仅本地 SQLite 驱动) · .json = 与导入格式同源
        <template v-if="exportTablesHint"> · 已选 {{ exportTablesHint }}</template>
      </p>
      <div class="table-wrap max-h-80 overflow-y-auto mt-3 border border-slate-200 dark:border-slate-700 rounded-lg">
        <table class="table">
          <thead>
            <tr>
              <th class="w-10">
                <input type="checkbox" class="w-4 h-4 accent-brand-500" :checked="allSelected" @change="toggleAll" />
              </th>
              <th>表名</th>
              <th>行数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in tables" :key="t.name" class="cursor-pointer" @click="toggleTable(t.name)">
              <td @click.stop>
                <input type="checkbox" class="w-4 h-4 accent-brand-500" :value="t.name" v-model="selectedTables" />
              </td>
              <td class="font-mono text-slate-700 dark:text-slate-200">{{ t.name }}</td>
              <td class="text-slate-500 dark:text-slate-400">{{ t.rows }}</td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-if="!tables.length" message="暂无可备份表" icon="database" />
      </div>
    </div>

    <!-- 定时备份配置 -->
    <div class="card p-5">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <h3 class="font-medium text-slate-900 dark:text-white flex items-center gap-2">
          <Icon name="clock" class="text-brand-500" /> 定时备份 (每 X 天 X时X分X秒, 备份到 {{ storageShort }})
        </h3>
        <div class="flex items-center gap-2">
          <span class="text-slate-500 dark:text-slate-400">{{ schedForm.enabled ? '已开启' : '已关闭 (默认)' }}</span>
          <ToggleSwitch v-model="schedForm.enabled" />
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div class="flex items-end gap-2 flex-wrap">
          <div class="w-24">
            <label class="label">每 X 天</label>
            <input v-model.number="schedForm.interval_days" type="number" min="1" max="3650" class="input" />
          </div>
          <div class="w-20">
            <label class="label">时 (0-23)</label>
            <input v-model.number="schedForm.hour" type="number" min="0" max="23" class="input" />
          </div>
          <div class="w-20">
            <label class="label">分 (0-59)</label>
            <input v-model.number="schedForm.minute" type="number" min="0" max="59" class="input" />
          </div>
          <div class="w-20">
            <label class="label">秒 (0-59)</label>
            <input v-model.number="schedForm.second" type="number" min="0" max="59" class="input" />
          </div>
        </div>
        <div class="space-y-2">
          <div>
            <label class="label">备份表范围</label>
            <select v-model="schedForm.tables" class="input">
              <option value="all">全部白名单表</option>
              <option v-if="schedForm.tables !== 'all'" :value="schedForm.tables">自定义: {{ schedForm.tables }}</option>
            </select>
          </div>
          <p class="text-slate-400">
            上次运行: {{ formatTime(config?.last_run_at) || '从未运行' }}
            <template v-if="config?.next_due"> · 下次到点: {{ formatTime(config.next_due) }}</template>
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 mt-4 flex-wrap">
        <button class="btn-primary" :disabled="savingConfig" @click="saveConfig">
          <Icon name="refresh" v-if="savingConfig" class="animate-spin" /> 保存配置
        </button>
        <button class="btn-secondary" :disabled="savingConfig" @click="generateToken">
          <Icon name="key" /> 生成回调令牌
        </button>
        <span v-if="config?.cron_token" class="font-mono text-slate-500 dark:text-slate-400 break-all">
          令牌: {{ config.cron_token }}
        </span>
      </div>

      <div class="mt-4 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-4 space-y-1.5">
        <p class="font-medium text-slate-600 dark:text-slate-300">Cloudflare 定时任务接入 (Cron Triggers 最小粒度 1 分钟, 秒级到点由服务端判定兑现):</p>
        <p class="text-slate-500 dark:text-slate-400">配套实时 Worker (edge-realtime) 已内置 scheduled 处理器, 每分钟回调下方端点; 也可用任意外部定时器:</p>
        <code class="block font-mono break-all bg-slate-100 dark:bg-slate-900 rounded px-2 py-1.5 text-slate-600 dark:text-slate-300">
          curl -X POST "&lt;站点地址&gt;/api/admin/backup/cron?token=&lt;回调令牌&gt;"
        </code>
        <p class="text-slate-400">edge-realtime/wrangler.toml 配置: [triggers] crons = ["* * * * *"] + vars SITE_URL / BACKUP_TOKEN。</p>
      </div>
    </div>

    <!-- 备份列表 -->
    <div class="card overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 flex-wrap">
        <Icon name="database" class="text-brand-500" />
        <span class="font-medium text-slate-800 dark:text-white">备份列表</span>
        <span class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ storage || '存储未就绪' }}</span>
        <span v-if="cdnBaseUrl" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">CDN: {{ cdnBaseUrl }}</span>
      </div>
      <div class="table-wrap max-h-96 overflow-y-auto">
        <table class="table">
          <thead>
            <tr>
              <th>文件名</th>
              <th>大小</th>
              <th>时间</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in backups" :key="b.key">
              <td class="font-mono text-slate-700 dark:text-slate-200">{{ b.key }}</td>
              <td class="text-slate-500 dark:text-slate-400">{{ formatSize(b.size) }}</td>
              <td class="text-slate-500 dark:text-slate-400">{{ formatTime(b.modified_at) }}</td>
              <td>
                <div class="flex items-center justify-end gap-1">
                  <a class="btn-ghost !px-2 !py-1" title="下载" :href="backupDownloadUrl(b.key)">
                    <Icon name="download" />
                  </a>
                  <button
                    class="btn-ghost !px-2 !py-1"
                    :title="b.key.endsWith('.json') ? '导入 (按表 PK upsert 回灌)' : '仅 .json 支持在线导入'"
                    :disabled="!b.key.endsWith('.json') || restoring === b.key"
                    @click="doRestore(b)"
                  >
                    <Icon name="refresh" v-if="restoring === b.key" class="animate-spin" />
                    <Icon v-else name="upload" />
                  </button>
                  <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="confirmDelete(b)">
                    <Icon name="trash" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-if="!backups.length" message="暂无备份 — 点击右上角「立即备份」生成第一份" icon="database" />
      </div>
    </div>

    <!-- 删除备份确认 -->
    <ModalBase :model-value="!!deleteTarget" title="删除备份" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-slate-500 mt-2">
          确认删除备份 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.key }}</span>？操作不可撤销。
        </p>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="deleteTarget = null">取消</button>
        <button class="btn-danger flex-1" :disabled="deleting" @click="doDelete">
          <Icon name="refresh" v-if="deleting" class="animate-spin" />
          确认删除
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import {
  getBackupTables, backupExportUrl, getBackupConfig, updateBackupConfig,
  runBackupNow, listBackups, deleteBackup, restoreBackup, backupDownloadUrl,
  type BackupTableInfo, type BackupConfigInfo, type BackupObjectInfo,
} from '~/api/backup'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const tables = ref<BackupTableInfo[]>([])
const selectedTables = ref<string[]>([])
const exportFormat = ref<'sql' | 'db' | 'json'>('sql')
const exporting = ref(false)

const config = ref<BackupConfigInfo | null>(null)
const storage = ref('')
const storageError = ref('')
const cdnBaseUrl = ref('')
const schedForm = reactive({ enabled: false, interval_days: 1, hour: 4, minute: 38, second: 0, tables: 'all' })
const savingConfig = ref(false)

const backups = ref<BackupObjectInfo[]>([])
const running = ref(false)
const restoring = ref('')
const deleteTarget = ref<BackupObjectInfo | null>(null)
const deleting = ref(false)

const FORMAT_OPTIONS = [
  { value: 'sql', label: '.SQL' },
  { value: 'db', label: '.DB' },
  { value: 'json', label: '.JSON' },
] as const

const allSelected = computed(() => tables.value.length > 0 && selectedTables.value.length === tables.value.length)
const storageShort = computed(() => {
  if (!storage.value) return '存储'
  if (storage.value.includes('R2')) return 'R2'
  if (storage.value.includes('S3')) return 'S3'
  return '本地快照'
})
const exportTablesHint = computed(() => {
  if (!selectedTables.value.length) return ''
  const names = selectedTables.value
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} 等 ${names.length} 表`
})

function toggleAll(e: Event) {
  selectedTables.value = (e.target as HTMLInputElement).checked ? tables.value.map((t) => t.name) : []
}
function selectAll() {
  selectedTables.value = tables.value.map((t) => t.name)
}
function toggleTable(name: string) {
  selectedTables.value = selectedTables.value.includes(name)
    ? selectedTables.value.filter((n) => n !== name)
    : [...selectedTables.value, name]
}

function doExport() {
  if (!selectedTables.value.length) return
  // db 格式可用性由服务端按驱动判定 (sqlite=可, d1/mysql=如实报错), 前端不预判
  exporting.value = true
  try {
    const url = backupExportUrl(selectedTables.value.join(','), exportFormat.value)
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success(`已触发导出 (${exportFormat.value.toUpperCase()}, ${selectedTables.value.length} 表)`)
  } finally {
    exporting.value = false
  }
}

async function saveConfig() {
  savingConfig.value = true
  try {
    const r = await updateBackupConfig({
      enabled: schedForm.enabled,
      interval_days: schedForm.interval_days,
      hour: schedForm.hour,
      minute: schedForm.minute,
      second: schedForm.second,
      tables: schedForm.tables,
    })
    config.value = r.config
    toast.success(schedForm.enabled ? '定时备份已开启' : '定时备份已关闭')
    loadConfig()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    savingConfig.value = false
  }
}

async function generateToken() {
  savingConfig.value = true
  try {
    const r = await updateBackupConfig({ generate_cron_token: true })
    config.value = r.config
    toast.success('回调令牌已生成 — 请同步到 Cloudflare Worker 环境变量 BACKUP_TOKEN')
  } catch (e: any) {
    toast.error(e.message || '生成失败')
  } finally {
    savingConfig.value = false
  }
}

async function runNow() {
  running.value = true
  try {
    const r = await runBackupNow()
    toast.success(r.backup ? `备份完成: ${r.backup.key} (${r.backup.tables.length} 表 / ${r.backup.rows} 行)` : '备份完成')
    loadBackups()
    loadConfig()
  } catch (e: any) {
    toast.error(e.message || '备份失败')
  } finally {
    running.value = false
  }
}

function confirmDelete(b: BackupObjectInfo) {
  deleteTarget.value = b
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteBackup(deleteTarget.value.key)
    toast.success('备份已删除')
    deleteTarget.value = null
    loadBackups()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

async function doRestore(b: BackupObjectInfo) {
  if (!confirm(`确认把备份「${b.key}」导入当前库？按表 PK upsert (同名数据会被备份内容覆盖)。`)) return
  restoring.value = b.key
  try {
    const r = await restoreBackup(b.key)
    const parts: string[] = []
    for (const [table, s] of Object.entries(r.report || {})) {
      parts.push(`${table}: 新增 ${s.inserted} / 更新 ${s.updated}${s.skipped ? ` / 跳过 ${s.skipped}` : ''}`)
    }
    toast.success(parts.length ? `导入完成 — ${parts.slice(0, 4).join(', ')}${parts.length > 4 ? ' 等' : ''}` : '导入完成 (无变化)')
  } catch (e: any) {
    toast.error(e.message || '导入失败')
  } finally {
    restoring.value = ''
  }
}

async function loadTables() {
  const r = await getBackupTables()
  tables.value = r.tables
}
async function loadConfig() {
  const r = await getBackupConfig()
  config.value = r.config
  storage.value = r.storage
  storageError.value = r.storage_error || ''
  cdnBaseUrl.value = r.storage_settings?.cdn_base_url || ''
  Object.assign(schedForm, {
    enabled: !!r.config.enabled,
    interval_days: r.config.interval_days,
    hour: r.config.hour,
    minute: r.config.minute,
    second: r.config.second,
    tables: r.config.tables || 'all',
  })
}
async function loadBackups() {
  const r = await listBackups()
  backups.value = r.items
  if (r.storage) storage.value = r.storage
}

async function reloadAll() {
  loading.value = true
  try {
    await Promise.all([loadTables(), loadConfig().catch(() => {}), loadBackups().catch(() => {})])
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function formatTime(t?: string) {
  if (!t) return ''
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

onMounted(reloadAll)
if (import.meta.client) window.addEventListener('app:refresh', reloadAll)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reloadAll))
</script>
