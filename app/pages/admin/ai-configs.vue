<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="AI 配置" description="统一管理大模型接入配置 (模型 / API Key / 地址), 自动回复与指定商品回复直接下拉引用, 一处修改全局生效">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 新建配置
        </button>
      </template>
    </PageHeader>

    <!-- Filters -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[220px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input v-model="keyword" class="input pl-9" placeholder="搜索配置名称 / 模型 / 备注" @keyup.enter="resetAndReload" />
        </div>
        <select v-model="enabledFilter" class="input !w-auto min-w-[140px]" @change="resetAndReload">
          <option value="">全部状态</option>
          <option value="1">已启用</option>
          <option value="0">已停用</option>
        </select>
        <p class="text-slate-400">共 {{ total }} 条</p>
      </div>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>配置名称</th>
                <th>模型</th>
                <th>API 地址</th>
                <th>API Key</th>
                <th>状态</th>
                <th>备注</th>
                <th>更新时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in configs" :key="c.id">
                <td>
                  <span class="font-medium text-slate-800 dark:text-slate-100">{{ c.name }}</span>
                </td>
                <td class="font-mono text-slate-600 dark:text-slate-300">{{ c.model_name }}</td>
                <td class="max-w-[260px]">
                  <p class="truncate font-mono text-slate-500 dark:text-slate-400" :title="c.base_url">{{ c.base_url }}</p>
                </td>
                <td>
                  <span v-if="c.api_key_masked" class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    <Icon name="check" /> 已配置
                  </span>
                  <span v-else class="badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    <Icon name="alert" /> 未配置
                  </span>
                </td>
                <td>
                  <button
                    class="badge cursor-pointer transition-colors"
                    :class="Number(c.enabled)
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'"
                    :title="Number(c.enabled) ? '点击停用' : '点击启用'"
                    @click="toggleEnabled(c)"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :class="Number(c.enabled) ? 'bg-brand-500' : 'bg-slate-400'" />
                    {{ Number(c.enabled) ? '启用中' : '已停用' }}
                  </button>
                </td>
                <td class="max-w-[180px]">
                  <p class="truncate text-slate-500 dark:text-slate-400" :title="c.remark">{{ c.remark || '—' }}</p>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(c.updated_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="连通性测试" :disabled="testingId === c.id" @click="quickTest(c)">
                      <Icon name="sparkles" :class="testingId === c.id ? 'animate-pulse' : ''" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(c)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="deleteOne(c)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!configs.length" message="暂无 AI 配置，点击「新建配置」接入大模型" icon="sparkles" />
      </template>

      <div v-if="total > pageSize" class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
        <p class="text-slate-500">共 {{ total }} 条，第 {{ page }} / {{ totalPages }} 页</p>
        <div class="flex items-center gap-1">
          <button class="btn-secondary !px-2.5 !py-1.5" :disabled="page <= 1" @click="goPage(page - 1)">
            <Icon name="chevronRight" class="rotate-180" />
          </button>
          <button class="btn-secondary !px-2.5 !py-1.5" :disabled="page >= totalPages" @click="goPage(page + 1)">
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
    </div>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑 AI 配置' : '新建 AI 配置'" size="md">
      <div class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="label">配置名称 <span class="text-red-500">*</span></label>
            <input v-model="form.name" class="input" placeholder="如 阿里百炼-主力 / GLM-4-Flash" />
          </div>
          <div>
            <label class="label">模型名称</label>
            <input v-model="form.model_name" class="input" placeholder="如 qwen-plus / gpt-4o-mini / glm-4-flash" />
          </div>
        </div>
        <div>
          <label class="label">API Key <span v-if="form.api_key_masked" class="text-emerald-600">(已配置)</span></label>
          <input v-model="form.api_key" type="password" class="input" :placeholder="form.api_key_masked ? '已配置, 留空保持不变' : 'sk-...'" />
        </div>
        <div>
          <label class="label">API 地址 (Base URL)</label>
          <input v-model="form.base_url" class="input" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
          <p class="mt-1 text-slate-400">OpenAI 兼容接口地址；模型名含 gemini 自动走 Gemini 协议，地址含 /apps/ 自动走百炼应用协议</p>
        </div>
        <div>
          <label class="label">备注 (可选)</label>
          <input v-model="form.remark" class="input" placeholder="用途 / 额度 / 适用范围等说明" />
        </div>
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="form.enabled" type="checkbox" class="w-4 h-4 mt-0.5 rounded text-brand-600 focus:ring-brand-500" />
          <span>
            启用该配置
            <span class="block mt-0.5 text-slate-400">停用后所有引用此配置的自动回复将暂停 AI 接管</span>
          </span>
        </label>
        <div class="pt-2 border-t border-slate-100 dark:border-slate-700">
          <label class="label">连通性测试</label>
          <div class="flex gap-2">
            <input v-model="testMessage" class="input" placeholder="模拟买家消息, 例如: 能便宜点吗" />
            <button class="btn-secondary shrink-0" :disabled="testing || !editing" :title="editing ? '' : '请先保存配置后再测试'" @click="runTest">
              <Icon name="sparkles" /> {{ testing ? '测试中...' : '发送测试' }}
            </button>
          </div>
          <p v-if="testReply" class="mt-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">AI 回复: {{ testReply }}</p>
          <p v-if="testError" class="mt-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-red-600 dark:text-red-300 whitespace-pre-wrap">{{ testError }}</p>
          <!-- 调试面板: 原始发送 URL 与响应 (能用的 API 报「未返回内容」时, 对照这里一眼定位) -->
          <div v-if="testDebug" class="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div class="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between gap-2 flex-wrap">
              <span class="font-semibold text-slate-700 dark:text-slate-200">请求 / 响应详情</span>
              <span class="badge" :class="testDebug.status >= 200 && testDebug.status < 300 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'">
                HTTP {{ testDebug.status || '—' }} · {{ testDebug.elapsed_ms }}ms
              </span>
            </div>
            <div class="p-3 space-y-2">
              <div class="flex gap-2 flex-wrap">
                <span class="text-slate-400 shrink-0 w-20">基础 URL</span>
                <span class="font-mono break-all text-slate-700 dark:text-slate-200">{{ baseUrlPreview }}</span>
              </div>
              <div class="flex gap-2 flex-wrap">
                <span class="text-slate-400 shrink-0 w-20">发送 URL</span>
                <span class="font-mono break-all text-slate-700 dark:text-slate-200">{{ testDebug.url }}</span>
              </div>
              <div v-if="testDebug.error" class="flex gap-2 flex-wrap">
                <span class="text-slate-400 shrink-0 w-20">错误</span>
                <span class="text-red-500 break-all">{{ testDebug.error }}</span>
              </div>
              <details>
                <summary class="cursor-pointer select-none text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">发送体 (JSON)</summary>
                <pre class="mt-1 p-2 rounded bg-slate-50 dark:bg-slate-800/60 overflow-x-auto whitespace-pre-wrap break-all font-mono text-slate-600 dark:text-slate-300">{{ prettyBody(testDebug.request_body) }}</pre>
              </details>
              <details>
                <summary class="cursor-pointer select-none text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">响应原文</summary>
                <pre class="mt-1 p-2 rounded bg-slate-50 dark:bg-slate-800/60 overflow-x-auto whitespace-pre-wrap break-all font-mono text-slate-600 dark:text-slate-300">{{ prettyBody(testDebug.response_body) || '(空)' }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="modalOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="save">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          保存
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getAiConfigs, createAiConfig, updateAiConfig, deleteAiConfig, testAiConfig } from '~/api/ai-configs'
import type { AiConfig, AiTestDebug } from '~/api/ai-configs'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const configs = ref<AiConfig[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const enabledFilter = ref('')
const testingId = ref(0)

const modalOpen = ref(false)
const editing = ref(false)
const editingId = ref(0)
const form = ref<any>({ name: '', model_name: 'qwen-plus', api_key: '', api_key_masked: false, base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', enabled: true, remark: '' })
const testMessage = ref('')
const testing = ref(false)
const testReply = ref('')
const testError = ref('')
const testDebug = ref<AiTestDebug | null>(null)

const baseUrlPreview = computed(() => {
  const u = String(testDebug.value?.url || '')
  return u.replace(/\/chat\/completions$/, '') || form.value.base_url || '—'
})

function prettyBody(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

async function reload() {
  loading.value = true
  try {
    const res = await getAiConfigs({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      enabled: enabledFilter.value || undefined,
    })
    configs.value = res.data
    total.value = res.total
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function resetAndReload() {
  page.value = 1
  reload()
}

function goPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  reload()
}

function openCreate() {
  editing.value = false
  editingId.value = 0
  testReply.value = ''
  testError.value = ''
  testDebug.value = null
  form.value = { name: '', model_name: 'qwen-plus', api_key: '', api_key_masked: false, base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', enabled: true, remark: '' }
  modalOpen.value = true
}

function openEdit(c: AiConfig) {
  editing.value = true
  editingId.value = c.id
  testReply.value = ''
  testError.value = ''
  testDebug.value = null
  form.value = {
    name: c.name,
    model_name: c.model_name,
    api_key: '',
    api_key_masked: !!c.api_key_masked,
    base_url: c.base_url,
    enabled: !!Number(c.enabled),
    remark: c.remark || '',
  }
  modalOpen.value = true
}

async function save() {
  if (!form.value.name.trim()) {
    toast.error('请填写配置名称')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      model_name: form.value.model_name.trim() || 'qwen-plus',
      api_key: form.value.api_key,
      base_url: form.value.base_url.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      enabled: form.value.enabled,
      remark: form.value.remark.trim(),
    }
    if (editing.value) {
      await updateAiConfig(editingId.value, payload)
      toast.success('AI 配置已更新')
    } else {
      await createAiConfig(payload)
      toast.success('AI 配置已创建')
    }
    modalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(c: AiConfig) {
  const next = !Number(c.enabled)
  try {
    await updateAiConfig(c.id, {
      name: c.name,
      model_name: c.model_name,
      api_key: '',
      base_url: c.base_url,
      enabled: next,
      remark: c.remark || '',
    })
    toast.success(next ? `「${c.name}」已启用` : `「${c.name}」已停用`)
    reload()
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function deleteOne(c: AiConfig) {
  if (!confirm(`确认删除 AI 配置「${c.name}」？仍被引用的配置无法删除。`)) return
  try {
    await deleteAiConfig(c.id)
    toast.success('AI 配置已删除')
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  }
}

async function quickTest(c: AiConfig) {
  testingId.value = c.id
  try {
    const r = await testAiConfig(c.id, '你好，这个能便宜点吗')
    if (r.ok) toast.success(`「${c.name}」连通正常 (${r.model}): ${r.reply.slice(0, 60)}`)
    else toast.error(`「${c.name}」${r.error || '测试未通过'} — 打开编辑弹窗查看请求/响应详情`)
  } catch (e: any) {
    toast.error(e.message || '测试失败')
  } finally {
    testingId.value = 0
  }
}

async function runTest() {
  if (!editing.value) return
  testing.value = true
  testReply.value = ''
  testError.value = ''
  testDebug.value = null
  try {
    const r = await testAiConfig(editingId.value, testMessage.value)
    testReply.value = r.reply
    testDebug.value = r.debug || null
    if (!r.ok) testError.value = r.error || 'AI 接口未返回内容, 请根据下方请求/响应原文排查'
  } catch (e: any) {
    testError.value = e.message || '测试失败'
  } finally {
    testing.value = false
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(t.replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
