<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="数据管理" description="查看 / 清空 / 导出 / 导入数据库表">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-secondary" @click="exportBackup">
          <Icon name="download" /> 导出备份
        </button>
        <button class="btn-secondary" @click="importOpen = true">
          <Icon name="upload" /> 导入备份
        </button>
      </template>
    </PageHeader>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
      <StatCard label="表总数" :value="tables.length" icon="database" color="amber" />
      <StatCard label="总记录数" :value="totalRows" icon="activity" color="sky" />
      <StatCard label="上次刷新" :value="lastRefreshLabel" icon="clock" color="slate" />
    </div>

    <!-- ER Diagram -->
    <SchemaDiagram :tables="schemaTablesWithCounts" @select="openTable" />

    <!-- Table list -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>表名</th>
                <th class="w-32 text-right">行数</th>
                <th class="w-48 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in tables" :key="t.name">
                <td>
                  <span class="font-mono text-slate-800 dark:text-white">{{ t.name }}</span>
                </td>
                <td class="text-right font-medium">{{ t.rows.toLocaleString() }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="查看数据" @click="openTable(t.name)">
                      <Icon name="eye" />
                    </button>
                    <button
                      class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="清空表"
                      :disabled="t.name === 'users'"
                      @click="confirmTruncate(t.name)"
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!tables.length" message="暂无数据表" icon="data" />
      </template>
    </div>

    <!-- Table viewer modal -->
    <ModalBase v-model="viewerOpen" :title="viewerTable" size="xl">
      <template #footer>
        <p class="text-xs text-slate-400 mr-auto">共 {{ viewerTotal }} 行，第 {{ viewerPage }} / {{ viewerTotalPages }} 页</p>
        <button class="btn-secondary !px-2.5 !py-1.5" :disabled="viewerPage <= 1" @click="viewerPageGo(viewerPage - 1)">
          <Icon name="chevronRight" class="rotate-180" />
        </button>
        <button class="btn-secondary !px-2.5 !py-1.5" :disabled="viewerPage >= viewerTotalPages" @click="viewerPageGo(viewerPage + 1)">
          <Icon name="chevronRight" />
        </button>
        <button class="btn-secondary" @click="viewerOpen = false">关闭</button>
      </template>
      <div class="-mx-5 -my-4">
        <!-- Search bar -->
        <div class="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <div class="relative flex-1">
            <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
            <input v-model="viewerSearch" class="input !py-1.5 pl-8 !text-xs" placeholder="搜索当前页数据..." @input="filterViewerRows" />
          </div>
          <span class="text-xs text-slate-400 shrink-0">{{ filteredViewerRows.length }} / {{ viewerRows.length }} 行</span>
        </div>
        <div v-if="viewerLoading" class="p-10 flex items-center justify-center text-slate-400">
          <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
        </div>
        <div v-else class="table-wrap max-h-[400px] overflow-auto scrollbar-thin">
          <table class="table">
            <thead class="sticky top-0">
              <tr>
                <th v-for="col in viewerColumns" :key="col" class="font-mono text-xs cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 select-none" @click="toggleSort(col)">
                  <span class="flex items-center gap-1">
                    {{ col }}
                    <Icon v-if="viewerSortBy === col" :name="viewerSortDir === 'asc' ? 'chevronDown' : 'chevronDown'" class="rotate-0 text-brand-500" :class="viewerSortDir === 'desc' ? 'rotate-180' : ''" />
                  </span>
                </th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in filteredViewerRows" :key="idx">
                <td v-for="col in viewerColumns" :key="col" class="text-xs font-mono align-top max-w-[200px] truncate" :title="String(row[col] ?? '')">
                  {{ formatCell(row[col]) }}
                </td>
                <td class="text-right">
                  <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" @click="deleteRow(row)">
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!filteredViewerRows.length" :message="viewerSearch ? '未找到匹配数据' : '该表无数据'" icon="data" />
      </div>
    </ModalBase>

    <!-- Truncate confirm modal -->
    <ModalBase :model-value="!!truncateTarget" title="清空表" size="sm" @update:model-value="truncateTarget = null" @close="truncateTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-sm text-slate-500 mt-2">
          确认清空表 <span class="font-mono font-medium text-slate-800 dark:text-slate-200">{{ truncateTarget }}</span> 的全部数据？此操作不可撤销。
        </p>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="truncateTarget = null">取消</button>
        <button class="btn-danger flex-1" :disabled="truncating" @click="doTruncate">
          <Icon name="refresh" v-if="truncating" class="animate-spin" />
          确认清空
        </button>
      </template>
    </ModalBase>

    <!-- Import modal -->
    <ModalBase v-model="importOpen" title="导入备份" size="lg">
      <div class="space-y-3">
        <p class="text-sm text-slate-500 dark:text-slate-400">
          粘贴备份 JSON（含 <code class="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700">tables</code> 字段）或选择本地备份文件。导入将按主键 upsert。
        </p>
        <input type="file" accept="application/json" class="input" @change="onFileChange" />
        <textarea v-model="importText" rows="8" class="input font-mono text-xs" placeholder='{"tables": {"cards": [...]}}'></textarea>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="importOpen = false">取消</button>
        <button class="btn-primary" :disabled="importing" @click="doImport">
          <Icon name="upload" v-if="!importing" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ importing ? '导入中...' : '确认导入' }}
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getAdminTables, getAdminTableData, deleteAdminRow, truncateAdminTable, exportBackup as exportBackupApi, importBackup } from '~/api/admin'
import type { TableInfo } from '~/api/admin'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const tables = ref<TableInfo[]>([])
const totalRows = ref(0)
const lastRefresh = ref<Date | null>(null)

// Schema diagram
const { tables: schemaTables } = useSchemaDiagram()
// Enrich schema tables with live row counts from the DB
const schemaTablesWithCounts = computed(() =>
  schemaTables.value.map((t) => ({
    ...t,
    rowCount: tables.value.find((x) => x.name === t.name)?.rows ?? 0,
  })),
)

const lastRefreshLabel = computed(() => {
  if (!lastRefresh.value) return '—'
  return lastRefresh.value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
})

async function reload() {
  loading.value = true
  try {
    const r = await getAdminTables()
    tables.value = r.tables
    totalRows.value = r.total
    lastRefresh.value = new Date()
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

// Table viewer
const viewerOpen = ref(false)
const viewerTable = ref('')
const viewerLoading = ref(false)
const viewerRows = ref<any[]>([])
const viewerColumns = ref<string[]>([])
const viewerTotal = ref(0)
const viewerPage = ref(1)
const viewerPageSize = ref(50)
const viewerTotalPages = computed(() => Math.max(1, Math.ceil(viewerTotal.value / viewerPageSize.value)))
// Client-side search + sort (within current page)
const viewerSearch = ref('')
const viewerSortBy = ref('')
const viewerSortDir = ref<'asc' | 'desc'>('asc')
const filteredViewerRows = computed(() => {
  let rows = viewerRows.value
  const q = viewerSearch.value.trim().toLowerCase()
  if (q) {
    rows = rows.filter((r) =>
      viewerColumns.value.some((c) => String(r[c] ?? '').toLowerCase().includes(q)),
    )
  }
  if (viewerSortBy.value) {
    const col = viewerSortBy.value
    const dir = viewerSortDir.value === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      const av = a[col]
      const bv = b[col]
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }
  return rows
})
function toggleSort(col: string) {
  if (viewerSortBy.value === col) {
    viewerSortDir.value = viewerSortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    viewerSortBy.value = col
    viewerSortDir.value = 'asc'
  }
}

async function openTable(name: string) {
  viewerTable.value = name
  viewerPage.value = 1
  viewerOpen.value = true
  await loadViewer()
}

async function loadViewer() {
  viewerLoading.value = true
  try {
    const r = await getAdminTableData(viewerTable.value, {
      page: viewerPage.value,
      pageSize: viewerPageSize.value,
    })
    viewerColumns.value = r.columns
    viewerRows.value = r.rows
    viewerTotal.value = r.total
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    viewerLoading.value = false
  }
}

function viewerPageGo(p: number) {
  if (p < 1 || p > viewerTotalPages.value) return
  viewerPage.value = p
  loadViewer()
}

async function deleteRow(row: any) {
  const pk = row.id ?? row.order_id ?? row.cookie_id ?? row.key_name ?? row.username
  if (!pk) { toast.error('未找到主键'); return }
  if (!confirm(`确认删除该行（${pk}）？`)) return
  try {
    await deleteAdminRow(viewerTable.value, String(pk))
    toast.success('已删除')
    loadViewer()
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  }
}

// Truncate
const truncateTarget = ref<string | null>(null)
const truncating = ref(false)

function confirmTruncate(name: string) {
  if (name === 'users') {
    toast.error('不能清空 users 表')
    return
  }
  truncateTarget.value = name
}

async function doTruncate() {
  if (!truncateTarget.value) return
  truncating.value = true
  try {
    await truncateAdminTable(truncateTarget.value)
    toast.success(`已清空 ${truncateTarget.value}`)
    truncateTarget.value = null
    reload()
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  } finally {
    truncating.value = false
  }
}

// Export
async function exportBackup() {
  try {
    // useApi 会自动加 basePath；端点返回原始 JSON（无 success 信封），useApi 会原样透传
    const res: any = await exportBackupApi()
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `xianyu-admin-backup-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('备份已导出')
  } catch (e: any) {
    toast.error(e.message || '导出失败')
  }
}

// Import
const importOpen = ref(false)
const importText = ref('')
const importing = ref(false)

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { importText.value = String(reader.result || '') }
  reader.readAsText(file)
}

async function doImport() {
  if (!importText.value.trim()) { toast.error('请粘贴或选择备份文件'); return }
  let payload: any
  try { payload = JSON.parse(importText.value) }
  catch (e: any) { toast.error('JSON 格式错误: ' + e.message); return }
  importing.value = true
  try {
    const r = await importBackup(payload)
    let inserted = 0, updated = 0, skipped = 0
    for (const k of Object.keys(r.report || {})) {
      inserted += r.report[k].inserted
      updated += r.report[k].updated
      skipped += r.report[k].skipped
    }
    toast.success(`导入完成：新增 ${inserted}，更新 ${updated}，跳过 ${skipped}`)
    importOpen.value = false
    importText.value = ''
    reload()
  } catch (e: any) {
    toast.error(e.message || '导入失败')
  } finally {
    importing.value = false
  }
}

function formatCell(v: any): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
