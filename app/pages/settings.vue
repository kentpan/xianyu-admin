<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="系统设置" description="通用 / AI / SMTP / 商品同步 等全局配置">
      <template #actions>
        <button class="btn-secondary" @click="exportConfig" :disabled="exporting">
          <Icon v-if="exporting" name="refresh" class="animate-spin" />
          <Icon v-else name="download" /> 导出配置
        </button>
        <button class="btn-secondary" @click="importOpen = true">
          <Icon name="upload" /> 导入配置
        </button>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <div v-if="loading && !loaded" class="card p-10 flex items-center justify-center text-slate-400">
      <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-4 gap-5">
      <!-- Tabs -->
      <div class="card p-2 lg:sticky lg:top-4 h-fit">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors text-left"
          :class="activeTab === t.key
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300 font-medium'
            : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/40'"
          @click="activeTab = t.key"
        >
          <Icon :name="t.icon" /> {{ t.label }}
        </button>
      </div>

      <!-- Panel -->
      <div class="card p-5 lg:col-span-3 space-y-5">
        <!-- General -->
        <div v-if="activeTab === 'general'" class="space-y-4">
          <h3 class="font-semibold text-slate-900 dark:text-white">通用设置</h3>
          <SettingRow label="应用名称" desc="显示在侧边栏与浏览器标题">
            <input v-model="form.app_name" class="input" />
          </SettingRow>
          <SettingRow label="开启用户注册" desc="允许访客自助注册账号">
            <Toggle v-model="form.registration_enabled" />
          </SettingRow>
          <SettingRow label="显示默认登录信息" desc="登录页是否显示 admin/admin123 提示">
            <Toggle v-model="form.show_default_login_info" />
          </SettingRow>
          <SettingRow label="登录验证码" desc="开启后登录需输入图形验证码">
            <Toggle v-model="form.login_captcha_enabled" />
          </SettingRow>
        </div>

        <!-- AI -->
        <div v-if="activeTab === 'ai'" class="space-y-4">
          <h3 class="font-semibold text-slate-900 dark:text-white">AI 回复</h3>
          <SettingRow label="默认 AI 模型" desc="如 qwen-plus / gpt-4o-mini / glm-4">
            <input v-model="form.ai_model" class="input" placeholder="qwen-plus" />
          </SettingRow>
          <SettingRow label="AI API 地址" desc="OpenAI 兼容 API 端点">
            <input v-model="form.ai_api_url" class="input" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
          </SettingRow>
          <SettingRow label="默认回复内容" desc="AI 不可用时的兜底回复">
            <textarea v-model="form.default_reply" rows="3" class="input" />
          </SettingRow>
        </div>

        <!-- SMTP -->
        <div v-if="activeTab === 'smtp'" class="space-y-4">
          <h3 class="font-semibold text-slate-900 dark:text-white">SMTP 邮件</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SettingRow label="SMTP 服务器">
              <input v-model="form.smtp_server" class="input" placeholder="smtp.qq.com" />
            </SettingRow>
            <SettingRow label="端口">
              <input v-model.number="form.smtp_port" class="input" placeholder="587" />
            </SettingRow>
          </div>
          <SettingRow label="用户名">
            <input v-model="form.smtp_user" class="input" />
          </SettingRow>
          <SettingRow label="密码">
            <input v-model="form.smtp_password" type="password" class="input" />
          </SettingRow>
          <SettingRow label="发件人地址">
            <input v-model="form.smtp_from" class="input" placeholder="noreply@example.com" />
          </SettingRow>
        </div>

        <!-- Item sync -->
        <div v-if="activeTab === 'item_sync'" class="space-y-4">
          <h3 class="font-semibold text-slate-900 dark:text-white">商品同步</h3>
          <SettingRow label="自动同步" desc="开启后定时拉取闲鱼商品信息">
            <Toggle v-model="form.item_sync_enabled" />
          </SettingRow>
          <SettingRow label="同步间隔 (秒)" desc="两次同步之间的最小间隔">
            <input v-model.number="form.item_sync_interval" type="number" min="60" class="input" />
          </SettingRow>
          <SettingRow label="最大页数" desc="每次同步最多翻页数">
            <input v-model.number="form.item_sync_max_pages" type="number" min="1" class="input" />
          </SettingRow>
        </div>

        <div class="pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-end gap-2">
          <button class="btn-secondary" @click="reset">还原</button>
          <button class="btn-primary" :disabled="saving" @click="save">
            <Icon name="save" v-if="!saving" />
            <Icon name="refresh" v-else class="animate-spin" />
            {{ saving ? '保存中...' : '保存设置' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Import config modal -->
    <ModalBase v-model="importOpen" title="导入配置" size="lg">
      <div class="space-y-3">
        <p class="text-sm text-slate-500">粘贴之前导出的配置 JSON，或上传 .json 文件。导入会覆盖同名配置项。</p>
        <input ref="fileInput" type="file" accept=".json" class="input" @change="onFileChange" />
        <textarea v-model="importText" rows="10" class="input font-mono text-xs" placeholder='{ "settings": { "ai_model": { "value": "qwen-plus", "description": "默认AI模型" } } }' />
      </div>
      <template #footer>
        <button class="btn-secondary" @click="importOpen = false">取消</button>
        <button class="btn-primary" :disabled="importing" @click="doImport">
          <Icon v-if="importing" name="refresh" class="animate-spin" />
          <Icon v-else name="upload" /> 确认导入
        </button>
      </template>
    </ModalBase>

    <!-- Theme color live preview -->
    <div class="card p-5">
      <h3 class="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
        <Icon name="star" class="text-brand-500" /> 主题色实时预览
      </h3>
      <p class="text-xs text-slate-400 mb-4">点击下方色块切换主题色，所有界面元素将实时更新。</p>
      <div class="grid grid-cols-5 gap-3 mb-5">
        <button
          v-for="t in themes"
          :key="t.key"
          class="group flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all"
          :class="currentTheme === t.key ? 'border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-800' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'"
          @click="applyTheme(t.key)"
        >
          <span class="w-10 h-10 rounded-full shadow-md ring-2 ring-offset-2 dark:ring-offset-slate-800 transition-transform group-hover:scale-110" :class="currentTheme === t.key ? 'ring-slate-400' : 'ring-transparent'" :style="{ background: t[500] }" />
          <span class="text-xs font-medium" :class="currentTheme === t.key ? 'text-slate-900 dark:text-white' : 'text-slate-500'">{{ t.label }}</span>
        </button>
      </div>
      <!-- Preview cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
          <p class="text-xs text-slate-400 mb-2">按钮</p>
          <button class="btn-primary w-full">主要按钮</button>
        </div>
        <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
          <p class="text-xs text-slate-400 mb-2">徽章</p>
          <div class="flex items-center gap-2">
            <span class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">品牌色</span>
            <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">成功</span>
          </div>
        </div>
        <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
          <p class="text-xs text-slate-400 mb-2">进度条</p>
          <div class="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div class="h-full rounded-full bg-brand-500" style="width: 70%" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'
import { useThemeColor } from '~/composables/useThemeColor'
import { defineComponent, h } from 'vue'

definePageMeta({ layout: 'default' })

const api = useApi()
const toast = useToast()

// Theme color
const { current: currentTheme, themes, apply: applyTheme } = useThemeColor()

const TABS = [
  { key: 'general', label: '通用', icon: 'settings' },
  { key: 'ai', label: 'AI 回复', icon: 'message' },
  { key: 'smtp', label: 'SMTP 邮件', icon: 'bell' },
  { key: 'item_sync', label: '商品同步', icon: 'refresh' },
] as const

const activeTab = ref<typeof TABS[number]['key']>('general')

const loading = ref(false)
const loaded = ref(false)
const saving = ref(false)

// Config import/export
const exporting = ref(false)
const importing = ref(false)
const importOpen = ref(false)
const importText = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

async function exportConfig() {
  exporting.value = true
  try {
    const r = await api.get<{ settings: Record<string, any>; exportedAt: string; version: string }>('/api/settings/export')
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `xianyu_settings_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('配置已导出')
  } catch (e: any) {
    toast.error(e.message || '导出失败')
  } finally {
    exporting.value = false
  }
}
function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { importText.value = String(reader.result || '') }
  reader.readAsText(file)
}
async function doImport() {
  if (!importText.value.trim()) return toast.warning('请粘贴配置 JSON 或上传文件')
  importing.value = true
  try {
    const parsed = JSON.parse(importText.value)
    const settings = parsed.settings || parsed
    const r = await api.post<{ imported: number; skipped: number }>('/api/settings/import', { settings })
    toast.success(r.imported ? `已导入 ${r.imported} 项配置` : '未导入任何配置')
    importOpen.value = false
    importText.value = ''
    if (fileInput.value) fileInput.value.value = ''
    await reload()
  } catch (e: any) {
    toast.error(e.message || '导入失败，请检查 JSON 格式')
  } finally {
    importing.value = false
  }
}

const FIELDS = [
  'app_name', 'registration_enabled', 'show_default_login_info', 'login_captcha_enabled',
  'ai_model', 'ai_api_url', 'default_reply',
  'smtp_server', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from',
  'item_sync_enabled', 'item_sync_interval', 'item_sync_max_pages',
] as const

const form = reactive<Record<string, any>>({
  app_name: '闲鱼超级管家',
  registration_enabled: false,
  show_default_login_info: false,
  login_captcha_enabled: false,
  ai_model: 'qwen-plus',
  ai_api_url: '',
  default_reply: '',
  smtp_server: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_password: '',
  smtp_from: '',
  item_sync_enabled: true,
  item_sync_interval: 600,
  item_sync_max_pages: 5,
})

let snapshot: Record<string, any> = {}

async function reload() {
  loading.value = true
  try {
    const r = await api.get<{ settings: Record<string, any> }>('/api/settings/public')
    const s = r.settings || {}
    for (const k of FIELDS) {
      if (s[k] !== undefined) form[k] = s[k]
    }
    // ensure numbers/booleans
    form.smtp_port = Number(form.smtp_port) || 587
    form.item_sync_interval = Number(form.item_sync_interval) || 600
    form.item_sync_max_pages = Number(form.item_sync_max_pages) || 5
    snapshot = { ...form }
    loaded.value = true
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function reset() {
  Object.assign(form, snapshot)
  toast.info('已还原到上次加载的值')
}

function toStr(v: any): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v ?? '')
}

async function save() {
  // Detect changes vs snapshot
  const changes: { key: string; value: string }[] = []
  for (const k of FIELDS) {
    const cur = form[k]
    const old = snapshot[k]
    const curStr = toStr(cur)
    const oldStr = toStr(old)
    if (curStr !== oldStr) {
      changes.push({ key: k, value: curStr })
    }
  }
  if (!changes.length) {
    toast.info('没有需要保存的更改')
    return
  }
  saving.value = true
  try {
    for (const c of changes) {
      await api.put(`/api/settings/${encodeURIComponent(c.key)}`, { value: c.value })
    }
    snapshot = { ...form }
    toast.success(`已保存 ${changes.length} 项设置`)
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// Inline SettingRow & Toggle (simple, no extra deps)
const SettingRow = defineComponent({
  props: { label: String, desc: String },
  setup(p, { slots }) {
    return () => h('div', { class: 'grid grid-cols-1 md:grid-cols-3 gap-1 md:gap-3 items-start' }, [
      h('div', { class: 'md:col-span-1' }, [
        h('p', { class: 'text-sm font-medium text-slate-700 dark:text-slate-200' }, p.label as string),
        p.desc ? h('p', { class: 'text-xs text-slate-400 mt-0.5' }, p.desc as string) : null,
      ]),
      h('div', { class: 'md:col-span-2' }, slots.default?.()),
    ])
  },
})

const Toggle = defineComponent({
  props: { modelValue: Boolean },
  emits: ['update:modelValue'],
  setup(p, { emit }) {
    return () => h('button', {
      type: 'button',
      class: ['inline-flex items-center justify-center w-10 h-6 rounded-full transition-colors',
        p.modelValue ? 'bg-brand-600' : 'bg-slate-200 dark:bg-slate-700'],
      onClick: () => emit('update:modelValue', !p.modelValue),
    }, [
      h('span', {
        class: ['w-5 h-5 rounded-full bg-white shadow transform transition-transform',
          p.modelValue ? 'translate-x-4' : 'translate-x-0.5'],
      }),
    ])
  },
})

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
