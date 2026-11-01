<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="系统设置" description="通用 / SMTP / 商品同步 / R2·S3 存储 等全局配置">
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
          <SettingRow label="全局默认回复内容" desc="无关键词/AI 命中时的兜底回复 (AI 模型接入请在管理员「AI配置」页维护)">
            <textarea v-model="form.default_reply" rows="3" class="input" />
          </SettingRow>
        </div>

        <!-- 邮件服务 -->
        <div v-if="activeTab === 'smtp'" class="space-y-4">
          <h3 class="font-semibold text-slate-900 dark:text-white">邮件服务</h3>
          <SettingRow label="邮件服务商" desc="统一发信出口按此分流：SMTP 或 Resend">
            <select v-model="form.mail_provider" class="input">
              <option value="smtp">SMTP 邮件服务器</option>
              <option value="resend">Resend 邮件服务</option>
            </select>
          </SettingRow>
          <template v-if="form.mail_provider === 'smtp'">
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
          </template>
          <template v-else>
            <SettingRow label="Resend API Key" desc="在 resend.com/api-keys 创建，需包含发送权限">
              <input v-model="form.resend_api_key" type="password" class="input" placeholder="re_..." />
            </SettingRow>
            <SettingRow label="发件人地址" desc="必须是已在 Resend 验证域名下的地址">
              <input v-model="form.resend_from" class="input" placeholder="noreply@yourdomain.com" />
            </SettingRow>
          </template>
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

        <!-- R2/S3 存储 -->
        <div v-if="activeTab === 'storage'" class="space-y-4">
          <h3 class="font-semibold text-slate-900 dark:text-white">R2/S3 存储</h3>
          <p class="text-base text-slate-400">备份管理云端存储目标。配置齐全后优先于平台 R2 绑定 (BACKUP_R2) 生效；本地/自托管部署也可用此直连 R2/S3。</p>
          <SettingRow label="存储类型" desc="Cloudflare R2 或任意 S3 兼容存储">
            <select v-model="form.storage_driver" class="input">
              <option value="r2">Cloudflare R2</option>
              <option value="s3">S3 兼容存储 (AWS S3 / MinIO / OSS / COS)</option>
            </select>
          </SettingRow>
          <template v-if="form.storage_driver === 'r2'">
            <SettingRow label="R2 账户 ID" desc="Cloudflare 控制台 R2 页右侧 Account ID">
              <input v-model="form.r2_account_id" class="input" placeholder="a1b2c3..." />
            </SettingRow>
            <SettingRow label="R2 Access Key ID" desc="R2 → Manage R2 API Tokens 创建">
              <input v-model="form.r2_access_key_id" class="input" autocomplete="off" />
            </SettingRow>
            <SettingRow label="R2 Secret Access Key">
              <input v-model="form.r2_secret_access_key" type="password" class="input" autocomplete="new-password" />
            </SettingRow>
            <SettingRow label="R2 存储桶名" desc="不存在时可在仓库工作流自动创建 (r2Name)">
              <input v-model="form.r2_bucket" class="input" placeholder="xianyu-backups" />
            </SettingRow>
          </template>
          <template v-else>
            <SettingRow label="S3 Endpoint" desc="如 https://s3.amazonaws.com 或 MinIO 地址">
              <input v-model="form.s3_endpoint" class="input" placeholder="https://s3.amazonaws.com" />
            </SettingRow>
            <SettingRow label="S3 区域" desc="AWS 如 us-east-1；R2 为 auto">
              <input v-model="form.s3_region" class="input" placeholder="us-east-1" />
            </SettingRow>
            <SettingRow label="S3 Access Key ID">
              <input v-model="form.s3_access_key_id" class="input" autocomplete="off" />
            </SettingRow>
            <SettingRow label="S3 Secret Access Key">
              <input v-model="form.s3_secret_access_key" type="password" class="input" autocomplete="new-password" />
            </SettingRow>
            <SettingRow label="S3 存储桶名">
              <input v-model="form.s3_bucket" class="input" placeholder="xianyu-backups" />
            </SettingRow>
            <SettingRow label="Path-Style 寻址" desc="R2/MinIO 必须开启；AWS 可关闭用虚拟域名寻址">
              <Toggle v-model="form.s3_path_style" />
            </SettingRow>
          </template>
          <SettingRow label="外部访问 CDN 域名" desc="绑定自定义域名/CDN 后对象的外部访问地址 (如 https://cdn.example.com)">
            <input v-model="form.storage_cdn_base_url" class="input" placeholder="https://cdn.example.com" />
          </SettingRow>
          <div class="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-3 text-base text-amber-700 dark:text-amber-300">
            保存后即可在「管理员 → 备份管理」使用该存储云端备份。密钥仅存于系统设置表，不回传明文（加载时按配置态显示）。
          </div>
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
        <textarea v-model="importText" rows="10" class="input font-mono text-xs" placeholder='{ "settings": { "app_name": { "value": "闲鱼超级管家", "description": "应用名称" } } }' />
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
import { getAllSettings, exportSettings, importSettings, updateSetting } from '~/api/settings'
import { useThemeColor } from '~/composables/useThemeColor'
import { defineComponent, h } from 'vue'

definePageMeta({ layout: 'default' })

const toast = useToast()

// Theme color
const { current: currentTheme, themes, apply: applyTheme } = useThemeColor()

const TABS = [
  { key: 'general', label: '通用', icon: 'settings' },
  { key: 'smtp', label: '邮件服务', icon: 'bell' },
  { key: 'item_sync', label: '商品同步', icon: 'refresh' },
  { key: 'storage', label: 'R2/S3 存储', icon: 'database' },
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
    const r = await exportSettings()
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
    const r = await importSettings(settings)
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
  'app_name', 'registration_enabled', 'show_default_login_info', 'login_captcha_enabled', 'default_reply',
  'mail_provider', 'smtp_server', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from',
  'resend_api_key', 'resend_from',
  'item_sync_enabled', 'item_sync_interval', 'item_sync_max_pages',
  'storage_driver', 'r2_account_id', 'r2_access_key_id', 'r2_secret_access_key', 'r2_bucket',
  's3_endpoint', 's3_region', 's3_access_key_id', 's3_secret_access_key', 's3_bucket', 's3_path_style',
  'storage_cdn_base_url',
] as const

const form = reactive<Record<string, any>>({
  app_name: '闲鱼超级管家',
  registration_enabled: false,
  show_default_login_info: false,
  login_captcha_enabled: false,
  default_reply: '',
  mail_provider: 'smtp',
  smtp_server: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_password: '',
  smtp_from: '',
  resend_api_key: '',
  resend_from: '',
  item_sync_enabled: true,
  item_sync_interval: 600,
  item_sync_max_pages: 5,
  storage_driver: 'r2',
  r2_account_id: '',
  r2_access_key_id: '',
  r2_secret_access_key: '',
  r2_bucket: '',
  s3_endpoint: '',
  s3_region: 'us-east-1',
  s3_access_key_id: '',
  s3_secret_access_key: '',
  s3_bucket: '',
  s3_path_style: true,
  storage_cdn_base_url: '',
})

let snapshot: Record<string, any> = {}

async function reload() {
  loading.value = true
  try {
    // 管理页走鉴权端点读取全部设置 (含密钥字段)；公共端点已收敛为仅非敏感键
    const rows = await getAllSettings()
    const s: Record<string, any> = {}
    for (const r of rows || []) s[r.key_name] = r.value
    for (const k of FIELDS) {
      if (s[k] !== undefined) form[k] = s[k]
    }
    // ensure numbers/booleans
    form.smtp_port = Number(form.smtp_port) || 587
    form.item_sync_interval = Number(form.item_sync_interval) || 600
    form.item_sync_max_pages = Number(form.item_sync_max_pages) || 5
    form.s3_path_style = form.s3_path_style === true || form.s3_path_style === 'true'
    for (const bk of ['registration_enabled', 'show_default_login_info', 'login_captcha_enabled', 'item_sync_enabled', 's3_path_style']) {
      form[bk] = form[bk] === true || form[bk] === 'true'
    }
    if (form.mail_provider !== 'resend') form.mail_provider = 'smtp'
    if (form.storage_driver !== 's3') form.storage_driver = 'r2'
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
      await updateSetting(c.key, c.value)
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
