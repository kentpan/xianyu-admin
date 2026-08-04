<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="卡券管理" description="维护 api / 文本 / 数据 / 图片 卡券，支持多规格与延时发货">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 新增卡券
        </button>
      </template>
    </PageHeader>

    <!-- Search -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[240px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input v-model="keyword" class="input pl-9" placeholder="搜索卡券名称 / 描述" />
        </div>
        <div class="flex items-center gap-2">
          <button
            v-for="t in TYPE_OPTIONS"
            :key="t.value"
            class="badge cursor-pointer transition-colors"
            :class="filterType === t.value ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
            @click="filterType = filterType === t.value ? '' : t.value"
          >
            {{ t.label }}
          </button>
        </div>
        <p class="text-xs text-slate-400">共 {{ filtered.length }} 张</p>
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
                <th>名称</th>
                <th>类型</th>
                <th>多规格</th>
                <th>延时</th>
                <th>状态</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in filtered" :key="c.id">
                <td>
                  <button class="text-slate-800 dark:text-white font-medium hover:text-brand-600" @click="openEdit(c)">
                    {{ c.name }}
                  </button>
                  <p v-if="c.description" class="text-xs text-slate-400 mt-0.5 truncate max-w-[240px]">{{ c.description }}</p>
                </td>
                <td>
                  <span class="badge" :class="typeMeta(c.type).cls">
                    <Icon :name="typeMeta(c.type).icon" /> {{ typeMeta(c.type).label }}
                  </span>
                </td>
                <td>
                  <template v-if="c.is_multi_spec">
                    <span class="text-xs text-slate-500 dark:text-slate-400">
                      {{ c.spec_name || '规格' }}: {{ c.spec_value || '—' }}
                    </span>
                  </template>
                  <span v-else class="text-slate-400">—</span>
                </td>
                <td>{{ c.delay_seconds || 0 }}s</td>
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
        <EmptyState v-if="!filtered.length" message="还没有卡券，点击右上角「新增卡券」开始" icon="cards" />
      </template>
    </div>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑卡券' : '新增卡券'" size="lg">
      <div class="space-y-4">
        <div>
          <label class="label">名称 <span class="text-red-500">*</span></label>
          <input v-model="form.name" class="input" placeholder="如 30元话费卡" />
        </div>
        <div>
          <label class="label">类型 <span class="text-red-500">*</span></label>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="t in TYPE_OPTIONS"
              :key="t.value"
              type="button"
              class="rounded-lg border px-3 py-2 text-sm transition-colors"
              :class="form.type === t.value
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'"
              @click="form.type = t.value"
            >
              <Icon :name="t.icon" class="block mx-auto mb-1" />
              {{ t.label }}
            </button>
          </div>
        </div>

        <!-- Type-specific content -->
        <div v-if="form.type === 'api'">
          <label class="label">API 配置 (JSON)</label>
          <textarea v-model="form.api_config" rows="4" class="input font-mono text-xs" placeholder='{"url":"https://...","method":"POST","headers":{}}'></textarea>
          <p class="text-xs text-slate-400 mt-1">请求外部接口获取发货内容</p>
        </div>
        <div v-else-if="form.type === 'text'">
          <label class="label">文本内容</label>
          <textarea v-model="form.text_content" rows="4" class="input" placeholder="直接回复的文本内容" />
        </div>
        <div v-else-if="form.type === 'data'">
          <label class="label">数据内容 (每行一条)</label>
          <textarea v-model="form.data_content" rows="6" class="input font-mono text-xs" placeholder="卡号1,卡密1&#10;卡号2,卡密2"></textarea>
          <p class="text-xs text-slate-400 mt-1">按顺序发放，每订单消耗一条</p>
        </div>
        <div v-else-if="form.type === 'image'">
          <label class="label">图片 URL</label>
          <input v-model="form.image_url" class="input" placeholder="https://.../card.png" />
        </div>

        <div>
          <label class="label">描述</label>
          <input v-model="form.description" class="input" placeholder="可选" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">延时发货 (秒)</label>
            <input v-model.number="form.delay_seconds" type="number" min="0" class="input" />
          </div>
          <div class="flex items-end pb-1">
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="form.enabled" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
              <span class="text-sm text-slate-700 dark:text-slate-200">启用</span>
            </label>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.is_multi_spec" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
            <span class="text-sm text-slate-700 dark:text-slate-200">多规格卡券</span>
          </label>
          <div v-if="form.is_multi_spec" class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">规格名称</label>
              <input v-model="form.spec_name" class="input" placeholder="如 面值" />
            </div>
            <div>
              <label class="label">规格值</label>
              <input v-model="form.spec_value" class="input" placeholder="如 30元" />
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="modalOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="saveCard">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>

    <!-- Delete confirm modal -->
    <ModalBase :model-value="!!deleteTarget" title="删除卡券" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-sm text-slate-500 mt-2">
          确认删除卡券 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.name }}</span>？
          关联的自动发货规则将保留但不再生效。
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

interface Card {
  id: number
  name: string
  type: 'api' | 'text' | 'data' | 'image'
  api_config: string | null
  text_content: string | null
  data_content: string | null
  image_url: string | null
  description: string | null
  enabled: number
  delay_seconds: number
  is_multi_spec: number
  spec_name: string | null
  spec_value: string | null
  created_at: string
}

const TYPE_OPTIONS = [
  { value: 'api',   label: 'API',   icon: 'server',   cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  { value: 'text',  label: '文本',  icon: 'message',  cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { value: 'data',  label: '数据',  icon: 'database', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'image', label: '图片',  icon: 'package',  cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
] as const

function typeMeta(t: string) {
  return TYPE_OPTIONS.find((o) => o.value === t) || TYPE_OPTIONS[1]
}

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const cards = ref<Card[]>([])
const keyword = ref('')
const filterType = ref('')
const modalOpen = ref(false)
const editing = ref(false)
const deleteTarget = ref<Card | null>(null)

const form = ref<any>({
  id: null,
  name: '',
  type: 'text',
  api_config: '',
  text_content: '',
  data_content: '',
  image_url: '',
  description: '',
  enabled: true,
  delay_seconds: 0,
  is_multi_spec: false,
  spec_name: '',
  spec_value: '',
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return cards.value.filter((c) => {
    if (filterType.value && c.type !== filterType.value) return false
    if (!k) return true
    return c.name.toLowerCase().includes(k) || (c.description || '').toLowerCase().includes(k)
  })
})

async function reload() {
  loading.value = true
  try {
    cards.value = await api.get<Card[]>('/api/cards')
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  form.value = {
    id: null, name: '', type: 'text',
    api_config: '', text_content: '', data_content: '', image_url: '',
    description: '', enabled: true, delay_seconds: 0,
    is_multi_spec: false, spec_name: '', spec_value: '',
  }
  modalOpen.value = true
}

function openEdit(c: Card) {
  editing.value = true
  form.value = {
    id: c.id, name: c.name, type: c.type,
    api_config: c.api_config || '',
    text_content: c.text_content || '',
    data_content: c.data_content || '',
    image_url: c.image_url || '',
    description: c.description || '',
    enabled: !!c.enabled,
    delay_seconds: c.delay_seconds || 0,
    is_multi_spec: !!c.is_multi_spec,
    spec_name: c.spec_name || '',
    spec_value: c.spec_value || '',
  }
  modalOpen.value = true
}

async function saveCard() {
  if (!form.value.name.trim()) {
    toast.error('请填写卡券名称')
    return
  }
  saving.value = true
  try {
    const payload: any = {
      name: form.value.name,
      type: form.value.type,
      description: form.value.description,
      enabled: form.value.enabled,
      delay_seconds: Number(form.value.delay_seconds) || 0,
      is_multi_spec: form.value.is_multi_spec,
      spec_name: form.value.spec_name,
      spec_value: form.value.spec_value,
    }
    if (form.value.type === 'api') payload.api_config = form.value.api_config
    if (form.value.type === 'text') payload.text_content = form.value.text_content
    if (form.value.type === 'data') payload.data_content = form.value.data_content
    if (form.value.type === 'image') payload.image_url = form.value.image_url

    if (editing.value) {
      await api.put(`/api/cards/${form.value.id}`, payload)
      toast.success('卡券已更新')
    } else {
      await api.post('/api/cards', payload)
      toast.success('卡券已创建')
    }
    modalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(c: Card) {
  try {
    await api.put(`/api/cards/${c.id}`, { enabled: !c.enabled })
    c.enabled = c.enabled ? 0 : 1
    toast.success(c.enabled ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

function confirmDelete(c: Card) {
  deleteTarget.value = c
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await api.del(`/api/cards/${deleteTarget.value.id}`)
    toast.success('卡券已删除')
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
