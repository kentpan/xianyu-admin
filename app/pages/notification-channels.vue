<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="通知渠道" description="配置 QQ / 钉钉 / 飞书 / 邮件 / Bark / Webhook / 微信 / Telegram 等通知渠道">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 新增渠道
        </button>
      </template>
    </PageHeader>

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
                <th>名称</th>
                <th>类型</th>
                <th>状态</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in channels" :key="c.id">
                <td>
                  <button class="text-slate-800 dark:text-white font-medium hover:text-brand-600" @click="openEdit(c)">
                    {{ c.name }}
                  </button>
                </td>
                <td>
                  <span class="badge" :class="typeMeta(c.type).cls">
                    <Icon :name="typeMeta(c.type).icon" /> {{ typeMeta(c.type).label }}
                  </span>
                </td>
                <td>
                  <button
                    class="badge transition-colors"
                    :class="c.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
                    @click="toggleEnabled(c)"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :class="c.enabled ? 'bg-emerald-500' : 'bg-slate-400'" />
                    {{ c.enabled ? '启用' : '停用' }}
                  </button>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(c.created_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button
                      class="btn-ghost !px-2 !py-1 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20"
                      title="测试发送"
                      :disabled="testingId === c.id"
                      @click="testChannel(c)"
                    >
                      <Icon :name="testingId === c.id ? 'refresh' : 'bell'" :class="testingId === c.id ? 'animate-spin' : ''" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(c)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="confirmDelete(c)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!channels.length" message="还没有通知渠道，点击右上角「新增渠道」开始" icon="channels" />
      </template>
    </div>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑渠道' : '新增渠道'" size="md">
      <div class="space-y-4">
        <div>
          <label class="label">渠道名称 <span class="text-red-500">*</span></label>
          <input v-model="form.name" class="input" placeholder="如 销售群通知" />
        </div>
        <div>
          <label class="label">类型 <span class="text-red-500">*</span></label>
          <select v-model="form.type" class="input" :disabled="editing" @change="onTypeChange">
            <option v-for="t in CHANNEL_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </div>

        <!-- Dynamic config fields -->
        <div v-if="activeType" class="space-y-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-700">
          <div v-for="f in activeType.fields" :key="f.key">
            <label class="label">
              {{ f.label }}
              <span v-if="f.required" class="text-red-500">*</span>
            </label>
            <input
              v-model="form.config[f.key]"
              :type="f.secret ? 'password' : 'text'"
              class="input"
              :placeholder="f.placeholder || ''"
            />
            <p v-if="f.hint" class="text-xs text-slate-400 mt-1">{{ f.hint }}</p>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.enabled" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
          <span class="text-sm text-slate-700 dark:text-slate-200">启用</span>
        </label>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="modalOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="saveChannel">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>

    <!-- Delete confirm modal -->
    <ModalBase :model-value="!!deleteTarget" title="删除渠道" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-sm text-slate-500 mt-2">
          确认删除渠道 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.name }}</span>？
          关联的消息通知关系将一并删除。
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
import { useApi } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const api = useApi()
const toast = useToast()

interface Channel {
  id: number
  name: string
  type: string
  config: string
  enabled: number
  created_at: string
}

interface ConfigField {
  key: string
  label: string
  required?: boolean
  secret?: boolean
  placeholder?: string
  hint?: string
}
interface ChannelTypeDef {
  value: string
  label: string
  icon: string
  cls: string
  fields: ConfigField[]
}

const CHANNEL_TYPES: ChannelTypeDef[] = [
  {
    value: 'qq', label: 'QQ', icon: 'message', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    fields: [
      { key: 'group_id', label: 'QQ 群号', required: true, placeholder: '123456789' },
      { key: 'qq_account', label: 'QQ 账号', required: true, placeholder: '机器人 QQ' },
      { key: 'qq_key', label: 'QQ Key', required: true, secret: true },
    ],
  },
  {
    value: 'dingtalk', label: '钉钉', icon: 'bell', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    fields: [
      { key: 'access_token', label: 'Access Token', required: true, secret: true },
      { key: 'secret', label: '加签密钥', secret: true, hint: '可选，启用加签' },
    ],
  },
  {
    value: 'feishu', label: '飞书', icon: 'bell', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', required: true, placeholder: 'https://open.feishu.cn/...' },
      { key: 'secret', label: '签名密钥', secret: true, hint: '可选' },
    ],
  },
  {
    value: 'bark', label: 'Bark', icon: 'bell', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    fields: [
      { key: 'device_key', label: 'Device Key', required: true, secret: true },
      { key: 'server_url', label: '服务器地址', placeholder: 'https://api.day.app' },
    ],
  },
  {
    value: 'email', label: '邮件', icon: 'message', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    fields: [
      { key: 'smtp_server', label: 'SMTP 服务器', required: true, placeholder: 'smtp.qq.com' },
      { key: 'smtp_port', label: '端口', required: true, placeholder: '587' },
      { key: 'smtp_user', label: '用户名', required: true },
      { key: 'smtp_password', label: '密码', required: true, secret: true },
      { key: 'from', label: '发件人地址', required: true, placeholder: 'noreply@example.com' },
    ],
  },
  {
    value: 'webhook', label: 'Webhook', icon: 'external', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
    fields: [
      { key: 'url', label: '回调 URL', required: true, placeholder: 'https://...' },
      { key: 'secret', label: '签名密钥', secret: true, hint: '可选，请求头 X-Signature 校验' },
    ],
  },
  {
    value: 'wechat', label: '企业微信', icon: 'bell', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    fields: [
      { key: 'corp_id', label: 'Corp ID', required: true },
      { key: 'agent_id', label: 'Agent ID', required: true },
      { key: 'secret', label: 'Secret', required: true, secret: true },
      { key: 'to_user', label: '收件人', placeholder: '@all' },
    ],
  },
  {
    value: 'telegram', label: 'Telegram', icon: 'arrowRight', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    fields: [
      { key: 'bot_token', label: 'Bot Token', required: true, secret: true, placeholder: '123456:ABC-DEF...' },
      { key: 'chat_id', label: 'Chat ID', required: true, placeholder: '@channel 或 -1001234567890' },
    ],
  },
]

function typeMeta(t: string): ChannelTypeDef {
  return CHANNEL_TYPES.find((c) => c.value === t) || CHANNEL_TYPES[0]
}

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const testingId = ref<number | null>(null)
const channels = ref<Channel[]>([])
const modalOpen = ref(false)
const editing = ref(false)
const deleteTarget = ref<Channel | null>(null)

const form = ref<any>({
  id: null,
  name: '',
  type: 'webhook',
  config: {} as Record<string, string>,
  enabled: true,
})

const activeType = computed<ChannelTypeDef>(() => typeMeta(form.value.type))

function onTypeChange() {
  // Preserve existing keys that are valid in the new type; reset others
  const validKeys = new Set(activeType.value.fields.map((f) => f.key))
  const next: Record<string, string> = {}
  for (const k of validKeys) next[k] = form.value.config[k] || ''
  form.value.config = next
}

async function reload() {
  loading.value = true
  try {
    channels.value = await api.get<Channel[]>('/api/notifications/channels')
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  form.value = { id: null, name: '', type: 'webhook', config: {}, enabled: true }
  onTypeChange()
  modalOpen.value = true
}

function openEdit(c: Channel) {
  editing.value = true
  let cfg: Record<string, string> = {}
  try { cfg = JSON.parse(c.config || '{}') } catch { cfg = {} }
  form.value = { id: c.id, name: c.name, type: c.type, config: cfg, enabled: !!c.enabled }
  modalOpen.value = true
}

async function saveChannel() {
  if (!form.value.name.trim()) { toast.error('请填写渠道名称'); return }
  // Validate required fields
  for (const f of activeType.value.fields) {
    if (f.required && !form.value.config[f.key]) {
      toast.error(`请填写 ${f.label}`)
      return
    }
  }
  saving.value = true
  try {
    const payload = {
      name: form.value.name,
      type: form.value.type,
      config: JSON.stringify(form.value.config),
      enabled: form.value.enabled,
    }
    if (editing.value) {
      await api.put(`/api/notifications/channels/${form.value.id}`, payload)
      toast.success('渠道已更新')
    } else {
      await api.post('/api/notifications/channels', payload)
      toast.success('渠道已创建')
    }
    modalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(c: Channel) {
  try {
    await api.put(`/api/notifications/channels/${c.id}`, { enabled: !c.enabled })
    c.enabled = c.enabled ? 0 : 1
    toast.success(c.enabled ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function testChannel(c: Channel) {
  if (testingId.value !== null) return
  testingId.value = c.id
  try {
    const res = await api.post<{ sent?: boolean; error?: string; message?: string }>(
      `/api/notifications/channels/${c.id}/test`,
    )
    if (res && res.sent === false) {
      toast.error('发送失败: ' + (res.error || '未知错误'))
    } else if (res && res.message && res.message.includes('模拟')) {
      toast.info(res.message)
    } else {
      toast.success('测试消息已发送')
    }
  } catch (e: any) {
    toast.error('发送失败: ' + (e.message || '未知错误'))
  } finally {
    testingId.value = null
  }
}

function confirmDelete(c: Channel) {
  deleteTarget.value = c
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await api.del(`/api/notifications/channels/${deleteTarget.value.id}`)
    toast.success('渠道已删除')
    deleteTarget.value = null
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(t.replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
