<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="自动发货" description="按关键词匹配卡券，自动多次发货">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 新增规则
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
                <th>关键词</th>
                <th>关联卡券</th>
                <th>发货数量</th>
                <th>已发货次数</th>
                <th>状态</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rules" :key="r.id">
                <td>
                  <button class="text-slate-800 dark:text-white font-medium hover:text-brand-600" @click="openEdit(r)">
                    <span class="font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60">{{ r.keyword }}</span>
                  </button>
                  <p v-if="r.description" class="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{{ r.description }}</p>
                </td>
                <td>
                  <template v-if="r.card_name">
                    <span class="text-slate-700 dark:text-slate-200">{{ r.card_name }}</span>
                    <span class="text-xs text-slate-400 ml-1">({{ r.card_type }})</span>
                  </template>
                  <span v-else class="text-rose-500 text-xs">卡券已删除</span>
                </td>
                <td>{{ r.delivery_count }}</td>
                <td>
                  <span class="badge" :class="r.delivery_times > 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'">
                    {{ r.delivery_times || 0 }} 次
                  </span>
                </td>
                <td>
                  <button
                    class="badge transition-colors"
                    :class="r.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
                    @click="toggleEnabled(r)"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :class="r.enabled ? 'bg-emerald-500' : 'bg-slate-400'" />
                    {{ r.enabled ? '启用' : '停用' }}
                  </button>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(r.created_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(r)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="confirmDelete(r)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!rules.length" message="还没有发货规则，点击右上角「新增规则」开始" icon="delivery" />
      </template>
    </div>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑规则' : '新增规则'" size="md">
      <div class="space-y-4">
        <div>
          <label class="label">触发关键词 <span class="text-red-500">*</span></label>
          <input v-model="form.keyword" class="input" placeholder="如 开卡 / 充值" />
          <p class="text-xs text-slate-400 mt-1">买家消息包含此关键词时触发发货</p>
        </div>
        <div>
          <label class="label">关联卡券 <span class="text-red-500">*</span></label>
          <select v-model.number="form.card_id" class="input">
            <option :value="0" disabled>请选择卡券</option>
            <option v-for="c in cards" :key="c.id" :value="c.id">
              {{ c.name }} ({{ c.type }})
            </option>
          </select>
          <p v-if="!cards.length" class="text-xs text-rose-500 mt-1">尚无卡券，请先到「卡券管理」创建</p>
        </div>
        <div>
          <label class="label">发货数量</label>
          <input v-model.number="form.delivery_count" type="number" min="1" class="input" />
          <p class="text-xs text-slate-400 mt-1">每次触发发货的份数</p>
        </div>
        <div>
          <label class="label">描述</label>
          <input v-model="form.description" class="input" placeholder="可选" />
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.enabled" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
          <span class="text-sm text-slate-700 dark:text-slate-200">启用规则</span>
        </label>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="modalOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="saveRule">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>

    <!-- Delete confirm modal -->
    <ModalBase :model-value="!!deleteTarget" title="删除规则" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-sm text-slate-500 mt-2">
          确认删除关键词为 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.keyword }}</span> 的发货规则？
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

interface DeliveryRule {
  id: number
  keyword: string
  card_id: number
  delivery_count: number
  delivery_times: number
  enabled: number
  description: string | null
  created_at: string
  card_name: string | null
  card_type: string | null
}
interface CardLite { id: number; name: string; type: string }

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const rules = ref<DeliveryRule[]>([])
const cards = ref<CardLite[]>([])
const modalOpen = ref(false)
const editing = ref(false)
const deleteTarget = ref<DeliveryRule | null>(null)

const form = ref<any>({
  id: null,
  keyword: '',
  card_id: 0,
  delivery_count: 1,
  description: '',
  enabled: true,
})

async function reload() {
  loading.value = true
  try {
    const [rulesData, cardsData] = await Promise.all([
      api.get<DeliveryRule[]>('/api/delivery'),
      api.get<CardLite[]>('/api/cards'),
    ])
    rules.value = rulesData
    cards.value = cardsData
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  form.value = { id: null, keyword: '', card_id: cards.value[0]?.id || 0, delivery_count: 1, description: '', enabled: true }
  modalOpen.value = true
}

function openEdit(r: DeliveryRule) {
  editing.value = true
  form.value = {
    id: r.id,
    keyword: r.keyword,
    card_id: r.card_id,
    delivery_count: r.delivery_count,
    description: r.description || '',
    enabled: !!r.enabled,
  }
  modalOpen.value = true
}

async function saveRule() {
  if (!form.value.keyword.trim()) { toast.error('请填写关键词'); return }
  if (!form.value.card_id) { toast.error('请选择关联卡券'); return }
  saving.value = true
  try {
    const payload = {
      keyword: form.value.keyword,
      card_id: form.value.card_id,
      delivery_count: Number(form.value.delivery_count) || 1,
      description: form.value.description,
      enabled: form.value.enabled,
    }
    if (editing.value) {
      await api.put(`/api/delivery/${form.value.id}`, payload)
      toast.success('规则已更新')
    } else {
      await api.post('/api/delivery', payload)
      toast.success('规则已创建')
    }
    modalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(r: DeliveryRule) {
  try {
    await api.put(`/api/delivery/${r.id}`, { enabled: !r.enabled })
    r.enabled = r.enabled ? 0 : 1
    toast.success(r.enabled ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

function confirmDelete(r: DeliveryRule) {
  deleteTarget.value = r
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await api.del(`/api/delivery/${deleteTarget.value.id}`)
    toast.success('规则已删除')
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
