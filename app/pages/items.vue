<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="商品管理" description="查看账号同步的商品，配置多规格 / 多数量发货">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-secondary" :disabled="syncing || accounts.length === 0" @click="openSyncModal">
          <Icon name="download" :class="syncing ? 'animate-spin' : ''" /> 同步闲鱼商品
        </button>
        <button class="btn-secondary" @click="openPublishTemplate">
          <Icon name="edit" /> 发布模板
        </button>
        <button class="btn-secondary" title="外部获取商品列表 API 调用说明" @click="apiDocOpen = true">
          <Icon name="info" /> 外部调用
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
                    <button class="btn-ghost !px-2 !py-1 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20" title="擦亮宝贝 (提升排名)" :disabled="polishingIds.has(i.id)" @click="polishOne(i)">
                      <Icon name="trendUp" :class="polishingIds.has(i.id) ? 'animate-spin' : ''" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="deleteOne(i)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!filtered.length" message="暂无商品数据，点击右上角「同步闲鱼商品」从闲鱼拉取" icon="items" />
      </template>
    </div>

    <!-- 同步商品 modal -->
    <ModalBase v-model="syncModalOpen" title="同步闲鱼商品" size="md">
      <div class="space-y-4">
        <p class="text-sm text-slate-500 dark:text-slate-400">
          选择一个闲鱼账号，系统将调用闲鱼接口拉取该账号的全部在售商品并同步到本地。
        </p>
        <div>
          <label class="label">选择账号</label>
          <select v-model="syncCookieId" class="input">
            <option value="">请选择账号...</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">
              {{ a.remark || a.id }}
            </option>
          </select>
        </div>
        <div v-if="syncResult" class="rounded-lg p-3 text-sm" :class="syncResult.success ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'">
          {{ syncResult.message }}
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="syncModalOpen = false">关闭</button>
        <button class="btn-primary" :disabled="!syncCookieId || syncing" @click="doSync">
          <Icon name="download" v-if="!syncing" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ syncing ? '同步中...' : '开始同步' }}
        </button>
      </template>
    </ModalBase>

    <!-- 发布模板 modal (规避风控: 仅生成文案, 引导手动发布) -->
    <ModalBase v-model="pubModalOpen" title="发布模板 (规避风控)" size="lg">
      <div class="space-y-4">
        <div class="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-700 dark:text-amber-300">
          <p class="font-semibold mb-1 flex items-center gap-1"><Icon name="alert" /> 重要说明</p>
          <p class="text-xs">闲鱼无公开发布 API, 程序化发布会触发风控 (滑块/人脸验证/封号)。本工具仅生成规范文案, 请复制到闲鱼 App 内手动发布。</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">商品标题 <span class="text-red-500">*</span></label>
            <input v-model="pubForm.title" class="input" placeholder="如: H5网站定制开发" />
          </div>
          <div>
            <label class="label">价格 <span class="text-red-500">*</span></label>
            <input v-model="pubForm.price" class="input" placeholder="如: 99" />
          </div>
        </div>
        <div>
          <label class="label">商品描述</label>
          <textarea v-model="pubForm.description" rows="3" class="input" placeholder="商品详细描述, 留空将自动生成"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">分类</label>
            <input v-model="pubForm.category" class="input" placeholder="虚拟物品" />
          </div>
          <div>
            <label class="label">发货方式</label>
            <select v-model="pubForm.delivery_method" class="input">
              <option value="自动发货">自动发货</option>
              <option value="手动发货">手动发货</option>
              <option value="虚拟物品">虚拟物品</option>
            </select>
            <p class="text-xs text-slate-400 mt-1">仅写入发布文案给买家看；实际是否自动发货由「自动发货」页规则决定</p>
          </div>
        </div>
        <div v-if="pubResult" class="space-y-2">
          <label class="label">文案模板 (点击复制)</label>
          <pre class="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg text-xs whitespace-pre-wrap max-h-[200px] overflow-y-auto font-mono">{{ pubResult.template }}</pre>
          <div v-if="pubResult.tips?.length" class="space-y-1">
            <p v-for="(tip, i) in pubResult.tips" :key="i" class="text-xs text-slate-500 flex items-start gap-1">
              <Icon name="info" class="text-slate-400 shrink-0 mt-0.5" /> {{ tip }}
            </p>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="pubModalOpen = false">关闭</button>
        <button v-if="pubResult" class="btn-secondary" @click="copyTemplate">
          <Icon name="copy" /> 复制文案
        </button>
        <button class="btn-primary" :disabled="pubSaving || !pubForm.title || !pubForm.price" @click="generateTemplate">
          <Icon name="edit" v-if="!pubSaving" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ pubSaving ? '生成中...' : '生成文案' }}
        </button>
      </template>
    </ModalBase>

    <!-- 外部调用 API 文档弹窗 -->
    <ModalBase v-model="apiDocOpen" title="外部获取商品列表 API · 调用说明" size="lg">
      <div class="space-y-4">
        <div>
          <label class="label">接口说明</label>
          <p class="text-slate-600 dark:text-slate-300">供外部系统（发卡平台/下单系统/比价工具等）拉取本系统已同步的闲鱼在售商品列表，<span class="font-medium">按闲鱼账号分组</span>返回。每个账号默认返回最新 10 条商品，可通过 <span class="font-mono">limit</span> 参数调整返回条数。</p>
        </div>
        <div>
          <label class="label">鉴权方式</label>
          <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">Authorization: Bearer &lt;API Key&gt;      ← 「管理员 → API Key管理」生成的业务方 Key (xyk_ 前缀)</pre>
          <p class="mt-1.5 text-slate-500 dark:text-slate-400">Key 需处于启用状态且未过期；每个 Key 独立限速（默认 30 次/60 秒，超限返回 429）。每次调用（成功/失败）均留痕到调用日志，可在「API Key管理」查看。</p>
        </div>
        <div>
          <label class="label">请求方式与参数</label>
          <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">GET /api/open/items

Query 参数 (均可选):
  limit    每个闲鱼账号返回的商品条数, 默认 10, 可传 1-200 (按更新时间取最新 N 条)
  keyword  商品标题 / 商品ID 模糊过滤</pre>
        </div>
        <div>
          <label class="label">响应示例（统一 envelope）</label>
          <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">200 { "success": true, "data": {
  "total": 25,              ← 全部在售商品总数 (不受 limit 影响)
  "returned": 20,           ← 本次实际返回条数
  "account_count": 2,       ← 闲鱼账号数
  "limit": 10, "keyword": "", "called_by": "发卡平台A",
  "groups": [ {
    "cookie_id": "xy_2214...", "username": "店铺A", "remark": "主号",
    "item_count": 15,       ← 该账号全部商品数
    "returned_count": 10,   ← 本次实际返回条数 (受 limit 限制)
    "items": [ { "item_id": "1090...", "item_title": "...", "item_price": "9.9",
      "item_description": "...", "item_category": "...", "item_detail": "...",
      "is_multi_spec": false, "multi_quantity_delivery": false,
      "updated_at": "..." } ]
  } ] } }</pre>
        </div>
        <div>
          <label class="label">curl 调用示例</label>
          <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">curl 'https://你的域名/api/open/items?limit=20&amp;keyword=话费' \
  -H 'Authorization: Bearer xyk_xxxxxxxx'</pre>
        </div>
        <div class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
          <p class="font-medium text-slate-700 dark:text-slate-200 mb-1">错误响应</p>
          <p class="text-slate-500 dark:text-slate-400">401 = Key 缺失/无效；403 = Key 已停用/已过期；429 = 触发限速（响应头/消息含重试等待秒数）。均返回 <span class="font-mono">{ "success": false, "msg": "原因" }</span>。</p>
        </div>
        <p class="text-slate-500 dark:text-slate-400">仅返回启用状态闲鱼账号的在售商品；停用账号不会出现在分组中。商品数据来自「同步闲鱼商品」拉取结果，同步后即可被外部获取。</p>
      </div>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getItems, updateItem, deleteItem, batchDeleteItems } from '~/api/items'
import type { Item } from '~/api/items'
import { getAccounts } from '~/api/accounts'
import type { AccountLite } from '~/api/accounts'
import { syncXianyuItems, refreshXianyuItem, generatePublishTemplate } from '~/api/xianyu-items'
import type { PublishTemplateResult } from '~/api/xianyu-items'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const items = ref<Item[]>([])
const accounts = ref<AccountLite[]>([])
const filterCookieId = ref('')
const keyword = ref('')
const selected = ref<number[]>([])

// 同步 + 擦亮状态
const syncing = ref(false)
const syncModalOpen = ref(false)
const syncCookieId = ref('')
const syncResult = ref<{ success: boolean; message: string } | null>(null)
const polishingIds = ref<Set<number>>(new Set())

// 发布模板
const pubModalOpen = ref(false)
const pubSaving = ref(false)
// 外部调用 API 文档
const apiDocOpen = ref(false)
const pubResult = ref<PublishTemplateResult | null>(null)
const pubForm = reactive({
  title: '',
  price: '',
  description: '',
  category: '虚拟物品',
  delivery_method: '自动发货',
})

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
      getItems(),
      getAccounts(),
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
    await updateItem(i.cookie_id, i.item_id, { [flag]: next })
    i[flag] = next
    toast.success('已更新')
  } catch (e: any) {
    toast.error(e.message || '更新失败')
  }
}

async function deleteOne(i: Item) {
  if (!confirm(`确认删除商品「${i.item_title || i.item_id}」？`)) return
  try {
    await deleteItem(i.cookie_id, i.item_id)
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
    const r = await batchDeleteItems(selected.value)
    toast.success(`已删除 ${r.deleted} 件商品`)
    selected.value = []
    reload()
  } catch (e: any) {
    toast.error(e.message || '批量删除失败')
  }
}

// ===== 同步闲鱼商品 =====
function openSyncModal() {
  syncResult.value = null
  syncCookieId.value = filterCookieId.value || ''
  syncModalOpen.value = true
}

async function doSync() {
  if (!syncCookieId.value) {
    toast.error('请选择账号')
    return
  }
  syncing.value = true
  syncResult.value = null
  try {
    const r = await syncXianyuItems(syncCookieId.value)
    syncResult.value = { success: true, message: `同步完成，共 ${r.total} 件，新增/更新 ${r.synced} 件` }
    toast.success('商品同步完成')
    reload()
  } catch (e: any) {
    syncResult.value = { success: false, message: e.message || '同步失败' }
    toast.error(e.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

// ===== 擦亮宝贝 =====
async function polishOne(i: Item) {
  if (polishingIds.value.has(i.id)) return
  polishingIds.value.add(i.id)
  try {
    const r = await refreshXianyuItem(i.item_id, i.cookie_id)
    toast.success(r.message)
  } catch (e: any) {
    toast.error(e.message || '擦亮失败')
  } finally {
    polishingIds.value.delete(i.id)
  }
}

// 发布模板 (规避风控)
function openPublishTemplate() {
  pubResult.value = null
  pubForm.title = ''
  pubForm.price = ''
  pubForm.description = ''
  pubForm.category = '虚拟物品'
  pubForm.delivery_method = '自动发货'
  pubModalOpen.value = true
}

async function generateTemplate() {
  if (!pubForm.title.trim() || !pubForm.price.trim()) {
    toast.error('请填写标题和价格')
    return
  }
  pubSaving.value = true
  try {
    const r = await generatePublishTemplate({
      title: pubForm.title.trim(),
      price: pubForm.price.trim(),
      description: pubForm.description.trim() || undefined,
      category: pubForm.category,
      delivery_method: pubForm.delivery_method,
    })
    pubResult.value = r
    toast.success('文案已生成')
  } catch (e: any) {
    toast.error(e.message || '生成失败')
  } finally {
    pubSaving.value = false
  }
}

async function copyTemplate() {
  if (!pubResult.value?.template) return
  try {
    await copyToClipboard(pubResult.value.template)
    toast.success('已复制, 请粘贴到闲鱼 App 内发布')
  } catch (e: any) {
    toast.error(`复制失败 (${e?.message || e}), 请手动选择复制`)
  }
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
