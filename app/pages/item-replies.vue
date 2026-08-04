<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="指定商品回复" description="为单个商品配置专属自动回复内容">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 新增回复
        </button>
      </template>
    </PageHeader>

    <!-- Filters -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <label class="text-sm text-slate-500 dark:text-slate-400">账号</label>
          <select v-model="filterCookieId" class="input !w-auto min-w-[200px]">
            <option value="">全部账号</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
        </div>
        <div class="relative flex-1 min-w-[200px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input v-model="keyword" class="input pl-9" placeholder="搜索商品 ID / 标题 / 回复内容" />
        </div>
        <p class="text-xs text-slate-400">共 {{ filtered.length }} 条</p>
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
                <th>商品 ID</th>
                <th>标题</th>
                <th>所属账号</th>
                <th>回复内容</th>
                <th>更新时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in filtered" :key="r.id">
                <td class="font-mono text-xs">{{ r.item_id }}</td>
                <td class="max-w-[200px]">
                  <p class="truncate text-slate-800 dark:text-slate-100">{{ r.item_title || '—' }}</p>
                </td>
                <td>
                  <span class="text-slate-600 dark:text-slate-300">{{ r.cookie_remark || r.cookie_id }}</span>
                </td>
                <td class="max-w-[360px]">
                  <p class="truncate text-slate-700 dark:text-slate-200">{{ r.reply_content }}</p>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(r.updated_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(r)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="deleteOne(r)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!filtered.length" message="暂无指定商品回复，点击「新增回复」开始" icon="itemReply" />
      </template>
    </div>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑回复' : '新增回复'" size="md">
      <div class="space-y-4">
        <div>
          <label class="label">所属账号 <span class="text-red-500">*</span></label>
          <select v-model="form.cookie_id" class="input" :disabled="editing">
            <option value="" disabled>请选择账号</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
        </div>
        <div>
          <label class="label">商品 ID <span class="text-red-500">*</span></label>
          <input v-model="form.item_id" class="input" placeholder="闲鱼商品 ID" :disabled="editing" />
        </div>
        <div>
          <label class="label">回复内容 <span class="text-red-500">*</span></label>
          <textarea v-model="form.reply_content" rows="5" class="input" placeholder="该商品的专属自动回复内容"></textarea>
          <p class="text-xs text-slate-400 mt-1">支持多行文本，可包含变量占位符</p>
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
import { useApi } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const api = useApi()
const toast = useToast()

interface ItemReply {
  id: number
  item_id: string
  cookie_id: string
  reply_content: string
  created_at: string
  updated_at: string
  item_title?: string | null
  item_price?: string | null
  item_category?: string | null
  cookie_remark?: string | null
}

interface AccountLite { id: string; remark: string }

const loading = ref(false)
const saving = ref(false)
const replies = ref<ItemReply[]>([])
const accounts = ref<AccountLite[]>([])
const filterCookieId = ref('')
const keyword = ref('')

const modalOpen = ref(false)
const editing = ref(false)
const form = ref<any>({ cookie_id: '', item_id: '', reply_content: '' })

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return replies.value.filter((r) => {
    if (filterCookieId.value && r.cookie_id !== filterCookieId.value) return false
    if (!k) return true
    return (
      r.item_id.toLowerCase().includes(k) ||
      (r.item_title || '').toLowerCase().includes(k) ||
      (r.reply_content || '').toLowerCase().includes(k)
    )
  })
})

async function reload() {
  loading.value = true
  try {
    const [repliesData, accountsData] = await Promise.all([
      api.get<ItemReply[]>('/api/item-replies'),
      api.get<AccountLite[]>('/api/accounts'),
    ])
    replies.value = repliesData
    accounts.value = accountsData
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  form.value = { cookie_id: filterCookieId.value || '', item_id: '', reply_content: '' }
  modalOpen.value = true
}

function openEdit(r: ItemReply) {
  editing.value = true
  form.value = { cookie_id: r.cookie_id, item_id: r.item_id, reply_content: r.reply_content }
  modalOpen.value = true
}

async function save() {
  if (!form.value.cookie_id) {
    toast.error('请选择账号')
    return
  }
  if (!form.value.item_id.trim()) {
    toast.error('请输入商品 ID')
    return
  }
  if (!form.value.reply_content.trim()) {
    toast.error('回复内容不能为空')
    return
  }
  saving.value = true
  try {
    await api.put(
      `/api/item-replies/${encodeURIComponent(form.value.cookie_id)}/${encodeURIComponent(form.value.item_id)}`,
      { reply_content: form.value.reply_content },
    )
    toast.success(editing.value ? '回复已更新' : '回复已添加')
    modalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function deleteOne(r: ItemReply) {
  if (!confirm(`确认删除商品「${r.item_title || r.item_id}」的专属回复？`)) return
  try {
    await api.del(`/api/item-replies/${encodeURIComponent(r.cookie_id)}/${encodeURIComponent(r.item_id)}`)
    toast.success('回复已删除')
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
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
