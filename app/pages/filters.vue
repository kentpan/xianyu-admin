<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="消息过滤" description="命中关键词的消息跳过自动回复或不发外部通知，优先级高于所有回复链">
      <template #actions>
        <button class="btn-secondary" @click="load">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 新增规则
        </button>
      </template>
    </PageHeader>

    <!-- Filters -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <label class="text-sm text-slate-500 dark:text-slate-400">账号</label>
          <select v-model="filterCookieId" class="input !w-auto min-w-[200px]" @change="load">
            <option value="">全部账号</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
        </div>
        <p class="text-xs text-slate-400">共 {{ filters.length }} 条</p>
      </div>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <div v-else-if="!filters.length" class="p-10 text-center text-slate-400">
        还没有过滤规则 — 买家消息包含规则关键词时，将跳过自动回复或跳过外部通知。
      </div>
      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>所属账号</th>
                <th>关键词</th>
                <th>类型</th>
                <th>状态</th>
                <th>更新时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in filters" :key="f.id">
                <td class="text-slate-700 dark:text-slate-300">{{ accountName(f.cookie_id) }}</td>
                <td class="font-medium text-slate-900 dark:text-white">{{ f.keyword }}</td>
                <td>
                  <span class="badge" :class="f.filter_type === 'skip_reply' ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400'">
                    {{ f.filter_type === 'skip_reply' ? '跳过回复' : '跳过通知' }}
                  </span>
                </td>
                <td>
                  <button
                    class="badge cursor-pointer"
                    :class="f.enabled ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'"
                    @click="toggleEnabled(f)"
                  >
                    {{ f.enabled ? '启用' : '停用' }}
                  </button>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(f.updated_at || f.created_at) }}</td>
                <td class="text-right">
                  <div class="flex items-center justify-end gap-1">
                    <button class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-brand-600" title="编辑" @click="openEdit(f)">
                      <Icon name="edit" />
                    </button>
                    <button class="p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 text-slate-500 hover:text-rose-600" title="删除" @click="remove(f)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <!-- Create/Edit Modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑过滤规则' : '新增过滤规则'" size="md">
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">所属账号</label>
          <select v-model="form.cookie_id" class="input w-full" :disabled="!!editing">
            <option value="" disabled>选择账号</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">关键词</label>
          <input v-model="form.keyword" class="input w-full" placeholder="消息包含此关键词即命中" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">过滤类型</label>
          <div class="grid grid-cols-2 gap-2">
            <button
              class="p-3 rounded-lg border text-left transition-colors"
              :class="form.filter_type === 'skip_reply' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'"
              @click="form.filter_type = 'skip_reply'"
            >
              <p class="font-medium text-slate-900 dark:text-white">跳过回复</p>
              <p class="text-xs text-slate-400 mt-0.5">命中后不自动回复</p>
            </button>
            <button
              class="p-3 rounded-lg border text-left transition-colors"
              :class="form.filter_type === 'skip_notify' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'"
              @click="form.filter_type = 'skip_notify'"
            >
              <p class="font-medium text-slate-900 dark:text-white">跳过通知</p>
              <p class="text-xs text-slate-400 mt-0.5">命中后不发外部通知</p>
            </button>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="modalOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving || !form.cookie_id || !form.keyword.trim()" @click="save">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getFilters, createFilter, updateFilter, deleteFilter, type MessageFilter } from '~/api/filters'
import { getAccounts, type AccountLite } from '~/api/accounts'
import { useToast } from '~/composables/useToast'

const toast = useToast()
const filters = ref<MessageFilter[]>([])
const accounts = ref<AccountLite[]>([])
const loading = ref(true)
const saving = ref(false)
const modalOpen = ref(false)
const editing = ref<MessageFilter | null>(null)
const filterCookieId = ref('')
const form = reactive({ cookie_id: '', keyword: '', filter_type: 'skip_reply' })

async function load() {
  loading.value = true
  try {
    filters.value = await getFilters(filterCookieId.value || undefined)
  } catch (e: any) {
    toast.error(e?.message || '获取过滤规则失败')
  } finally {
    loading.value = false
  }
}

function accountName(id: string) {
  const a = accounts.value.find((x) => x.id === id)
  return a ? (a.remark || a.id) : id
}

function openCreate() {
  editing.value = null
  form.cookie_id = filterCookieId.value || (accounts.value[0]?.id ?? '')
  form.keyword = ''
  form.filter_type = 'skip_reply'
  modalOpen.value = true
}

function openEdit(f: MessageFilter) {
  editing.value = f
  form.cookie_id = f.cookie_id
  form.keyword = f.keyword
  form.filter_type = f.filter_type
  modalOpen.value = true
}

async function save() {
  saving.value = true
  try {
    if (editing.value) {
      await updateFilter(editing.value.id, { keyword: form.keyword.trim(), filter_type: form.filter_type })
      toast.success('规则已更新')
    } else {
      await createFilter({ cookie_id: form.cookie_id, keyword: form.keyword.trim(), filter_type: form.filter_type })
      toast.success('规则已添加')
    }
    modalOpen.value = false
    await load()
  } catch (e: any) {
    toast.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(f: MessageFilter) {
  try {
    await updateFilter(f.id, { enabled: !f.enabled })
    f.enabled = f.enabled ? 0 : 1
    toast.success(f.enabled ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e?.message || '操作失败')
  }
}

async function remove(f: MessageFilter) {
  if (!confirm(`确定删除关键词"${f.keyword}"的过滤规则？`)) return
  try {
    await deleteFilter(f.id)
    toast.success('规则已删除')
    await load()
  } catch (e: any) {
    toast.error(e?.message || '删除失败')
  }
}

function formatTime(t: string) {
  if (!t) return '-'
  try {
    const d = t.includes('T') || t.includes('Z') ? new Date(t) : new Date(t.replace(' ', 'T') + 'Z')
    if (Number.isNaN(d.getTime())) return t
    return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return t
  }
}

onMounted(async () => {
  try {
    accounts.value = await getAccounts()
  } catch { /* 不阻塞 */ }
  await load()
})
</script>
