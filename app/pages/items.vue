<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="商品管理" description="查看账号同步的商品，配置多规格 / 多数量发货">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button
          class="btn-danger"
          :disabled="selected.length === 0"
          @click="batchDelete"
        >
          <Icon name="trash" /> 批量删除 ({{ selected.length }})
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
            <option v-for="a in accounts" :key="a.id" :value="a.id">
              {{ a.remark || a.id }}
            </option>
          </select>
        </div>
        <div class="relative flex-1 min-w-[200px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input v-model="keyword" class="input pl-9" placeholder="搜索商品 ID / 标题 / 分类" />
        </div>
        <p class="text-xs text-slate-400">共 {{ filtered.length }} 件商品</p>
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
                <th class="w-10">
                  <input
                    type="checkbox"
                    class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500"
                    :checked="allChecked"
                    :indeterminate.prop="someChecked"
                    @change="toggleAll"
                  />
                </th>
                <th>商品 ID</th>
                <th>标题</th>
                <th>价格</th>
                <th>分类</th>
                <th>多规格</th>
                <th>多数量发货</th>
                <th>所属账号</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in filtered" :key="i.id">
                <td>
                  <input
                    v-model="selected"
                    :value="i.id"
                    type="checkbox"
                    class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500"
                  />
                </td>
                <td class="font-mono text-xs">{{ i.item_id }}</td>
                <td class="max-w-[260px]">
                  <p class="truncate text-slate-800 dark:text-slate-100">{{ i.item_title || '—' }}</p>
                </td>
                <td>
                  <span class="text-slate-700 dark:text-slate-200">¥{{ i.item_price || '—' }}</span>
                </td>
                <td>
                  <span v-if="i.item_category" class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">{{ i.item_category }}</span>
                  <span v-else class="text-slate-400">—</span>
                </td>
                <td>
                  <button
                    class="badge transition-colors"
                    :class="i.is_multi_spec ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
                    @click="toggleFlag(i, 'is_multi_spec')"
                  >
                    <Icon name="check" v-if="i.is_multi_spec" />
                    {{ i.is_multi_spec ? '多规格' : '普通' }}
                  </button>
                </td>
                <td>
                  <button
                    class="badge transition-colors"
                    :class="i.multi_quantity_delivery ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
                    @click="toggleFlag(i, 'multi_quantity_delivery')"
                  >
                    <Icon name="packageCheck" v-if="i.multi_quantity_delivery" />
                    {{ i.multi_quantity_delivery ? '已开启' : '已关闭' }}
                  </button>
                </td>
                <td>
                  <NuxtLink v-if="i.cookie_id" :to="`/accounts`" class="text-sky-600 hover:underline">
                    {{ i.cookie_remark || i.cookie_id }}
                  </NuxtLink>
                  <span v-else class="text-slate-400">—</span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="deleteOne(i)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!filtered.length" message="暂无商品数据" icon="items" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const api = useApi()
const toast = useToast()

interface Item {
  id: number
  cookie_id: string
  item_id: string
  item_title: string | null
  item_category: string | null
  item_price: string | null
  is_multi_spec: number
  multi_quantity_delivery: number
  created_at: string
  updated_at: string
  cookie_remark: string | null
}

interface AccountLite { id: string; remark: string }

const loading = ref(false)
const items = ref<Item[]>([])
const accounts = ref<AccountLite[]>([])
const filterCookieId = ref('')
const keyword = ref('')
const selected = ref<number[]>([])

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return items.value.filter((i) => {
    if (filterCookieId.value && i.cookie_id !== filterCookieId.value) return false
    if (!k) return true
    return (
      i.item_id.toLowerCase().includes(k) ||
      (i.item_title || '').toLowerCase().includes(k) ||
      (i.item_category || '').toLowerCase().includes(k)
    )
  })
})

const allChecked = computed(() => filtered.value.length > 0 && selected.value.length === filtered.value.length)
const someChecked = computed(() => selected.value.length > 0 && selected.value.length < filtered.value.length)

function toggleAll(e: any) {
  if (e.target.checked) {
    selected.value = filtered.value.map((i) => i.id)
  } else {
    selected.value = []
  }
}

async function reload() {
  loading.value = true
  try {
    const [itemsData, accountsData] = await Promise.all([
      api.get<Item[]>('/api/items'),
      api.get<AccountLite[]>('/api/accounts'),
    ])
    items.value = itemsData
    accounts.value = accountsData
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function toggleFlag(i: Item, flag: 'is_multi_spec' | 'multi_quantity_delivery') {
  const next = i[flag] ? 0 : 1
  try {
    await api.put(`/api/items/${encodeURIComponent(i.cookie_id)}/${encodeURIComponent(i.item_id)}`, { [flag]: next })
    i[flag] = next
    toast.success('已更新')
  } catch (e: any) {
    toast.error(e.message || '更新失败')
  }
}

async function deleteOne(i: Item) {
  if (!confirm(`确认删除商品「${i.item_title || i.item_id}」？`)) return
  try {
    await api.del(`/api/items/${encodeURIComponent(i.cookie_id)}/${encodeURIComponent(i.item_id)}`)
    toast.success('商品已删除')
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  }
}

async function batchDelete() {
  if (selected.value.length === 0) return
  if (!confirm(`确认删除选中的 ${selected.value.length} 件商品？`)) return
  try {
    const r = await api.del<{ deleted: number }>('/api/items/batch', { body: { ids: selected.value } })
    toast.success(`已删除 ${r.deleted} 件商品`)
    selected.value = []
    reload()
  } catch (e: any) {
    toast.error(e.message || '批量删除失败')
  }
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
