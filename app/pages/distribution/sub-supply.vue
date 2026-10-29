<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="二级货源广场" description="浏览其他分销商开启二级分销的一级对接记录，创建你的二级对接">
      <template #actions>
        <NuxtLink to="/distribution/supply" class="btn-secondary">
          <Icon name="store" /> 一级货源
        </NuxtLink>
        <NuxtLink to="/distribution/docked" class="btn-secondary">
          <Icon name="handshake" /> 我的对接
        </NuxtLink>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- Search -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[240px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input
            v-model="search"
            class="input pl-9"
            placeholder="搜索对接名称 / 卡券 / 一级分销商"
            @keyup.enter="goPage(1)"
          />
        </div>
        <p class="text-xs text-slate-400">共 {{ total }} 条</p>
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
                <th>对接名称</th>
                <th>卡券</th>
                <th>一级分销商</th>
                <th>二级拿货价</th>
                <th>可见性</th>
                <th>已提货</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in items" :key="s.id">
                <td>
                  <p class="font-medium text-slate-800 dark:text-white">{{ s.dock_name }}</p>
                </td>
                <td>
                  <p class="text-slate-700 dark:text-slate-200">{{ s.card_name || '—' }}</p>
                  <p v-if="s.card_type" class="text-xs text-slate-400">{{ s.card_type }}</p>
                </td>
                <td>
                  <span class="text-slate-700 dark:text-slate-200">{{ s.level1_username || `#${s.level1_user_id}` }}</span>
                </td>
                <td>
                  <span class="font-semibold tabular-nums text-violet-600 dark:text-violet-400">¥{{ s.sub_dock_price || '0.00' }}</span>
                  <p class="text-xs text-slate-400">卡券原价 ¥{{ s.card_price || '0.00' }}</p>
                </td>
                <td>
                  <span class="badge" :class="s.sub_dock_visibility === 'dealer_only'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'">
                    {{ s.sub_dock_visibility === 'dealer_only' ? '仅指定分销商' : '公开' }}
                  </span>
                </td>
                <td>
                  <span class="tabular-nums text-slate-700 dark:text-slate-200">{{ s.delivery_count || 0 }}</span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-primary !py-1 !px-2.5 !text-xs" @click="openDock(s)">
                      <Icon name="link" /> 创建二级对接
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!items.length" message="暂无开启二级分销的货源" icon="link" />
      </template>

      <!-- Pagination -->
      <div v-if="total > pageSize" class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
        <p class="text-xs text-slate-500">共 {{ total }} 条，第 {{ page }} / {{ totalPages }} 页</p>
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

    <!-- Sub-dock modal -->
    <ModalBase v-model="dockOpen" title="创建二级对接" size="md">
      <div v-if="dockTarget" class="space-y-4">
        <div class="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs text-slate-400">一级对接</span>
            <span class="font-medium text-slate-800 dark:text-white">{{ dockTarget.dock_name }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-slate-400">一级分销商</span>
            <span class="text-slate-700 dark:text-slate-200">{{ dockTarget.level1_username || `#${dockTarget.level1_user_id}` }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-slate-400">二级拿货价</span>
            <span class="font-semibold tabular-nums text-violet-600 dark:text-violet-400">¥{{ dockTarget.sub_dock_price || '0.00' }}</span>
          </div>
        </div>

        <div>
          <label class="label">对接名称 <span class="text-red-500">*</span></label>
          <input v-model="dockForm.dock_name" class="input" placeholder="便于识别的二级对接名称" />
        </div>
        <div>
          <label class="label">加价金额 <span class="text-xs text-slate-400">(在二级拿货价基础上额外加价)</span></label>
          <input v-model="dockForm.markup_amount" type="number" min="0" step="0.01" class="input" placeholder="0.00" />
          <p class="text-xs text-slate-400 mt-1">最终提货价 = 二级拿货价 + 加价 = ¥{{ finalPrice }}</p>
        </div>
        <div>
          <label class="label">备注</label>
          <textarea v-model="dockForm.remark" rows="3" class="input" placeholder="可选"></textarea>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="dockOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="submitDock">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ saving ? '提交中...' : '确认对接' }}
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getSubSupply, createSubDockRecord } from '~/api/distribution'
import type { SubSupplyItem } from '~/api/distribution'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const items = ref<SubSupplyItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const search = ref('')

const dockOpen = ref(false)
const dockTarget = ref<SubSupplyItem | null>(null)
const dockForm = reactive({ dock_name: '', markup_amount: '0.00', remark: '' })

const finalPrice = computed(() => {
  const base = Number(dockTarget.value?.sub_dock_price || 0)
  const markup = Number(dockForm.markup_amount || 0)
  return (base + markup).toFixed(2)
})

async function reload() {
  loading.value = true
  try {
    const r = await getSubSupply({
      page: page.value,
      page_size: pageSize.value,
      search: search.value.trim() || undefined,
    })
    items.value = r.items || []
    total.value = r.total || 0
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function goPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value)
  reload()
}

function openDock(s: SubSupplyItem) {
  dockTarget.value = s
  dockForm.dock_name = `${s.level1_username || 'L1'}-${s.card_name || '卡券'}`.slice(0, 40)
  dockForm.markup_amount = '0.00'
  dockForm.remark = ''
  dockOpen.value = true
}

async function submitDock() {
  if (!dockTarget.value) return
  if (!dockForm.dock_name.trim()) {
    toast.error('请填写对接名称')
    return
  }
  saving.value = true
  try {
    await createSubDockRecord({
      parent_dock_id: dockTarget.value.id,
      dock_name: dockForm.dock_name.trim(),
      markup_amount: dockForm.markup_amount || '0.00',
      remark: dockForm.remark.trim() || undefined,
    })
    toast.success('二级对接成功')
    dockOpen.value = false
  } catch (e: any) {
    toast.error(e.message || '对接失败')
  } finally {
    saving.value = false
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(String(t).replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
