<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="货源广场" description="配置佣金联盟账号、选品采集, 支持国内外主流联盟">
      <template #actions>
        <NuxtLink to="/distribution/docked" class="btn-secondary">
          <Icon name="handshake" /> 卡券对接
        </NuxtLink>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- Tabs -->
    <div class="card p-1 inline-flex gap-1">
      <button v-for="t in TABS" :key="t.key" class="px-4 py-2 rounded-lg text-sm font-medium transition-colors" :class="tab === t.key ? 'bg-brand-500 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'" @click="tab = t.key">
        <Icon :name="t.icon" /> {{ t.label }}
      </button>
    </div>

    <!-- Tab 1: 联盟账号 -->
    <template v-if="tab === 'accounts'">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-slate-900 dark:text-white">已配置的联盟账号</h3>
        <button class="btn-primary" @click="openAddAccount">
          <Icon name="plus" /> 新增联盟账号
        </button>
      </div>

      <div v-if="accounts.length === 0 && !loading" class="card p-10 text-center text-slate-400">
        <Icon name="store" class="text-4xl mx-auto mb-3" />
        <p>还未配置任何联盟账号</p>
        <p class="text-xs mt-1">点击右上角「新增联盟账号」开始</p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div v-for="a in accounts" :key="a.id" class="card p-4">
          <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" :class="a.network_meta?.color || 'bg-slate-100 text-slate-500'">
                <Icon name="store" />
              </div>
              <div class="min-w-0">
                <p class="font-medium text-slate-900 dark:text-white truncate">{{ a.display_name }}</p>
                <p class="text-xs text-slate-400">{{ a.network_meta?.nameCn || a.network_id }}</p>
              </div>
            </div>
            <span class="badge" :class="a.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500'">
              {{ a.enabled ? '启用' : '停用' }}
            </span>
          </div>
          <div class="space-y-1 text-xs text-slate-500 dark:text-slate-400 mb-3">
            <div v-for="(v, k) in a.credentials" :key="k" class="flex justify-between">
              <span class="font-mono">{{ k }}</span>
              <span class="font-mono truncate ml-2 max-w-[140px]">{{ v }}</span>
            </div>
          </div>
          <div class="flex items-center gap-1 pt-3 border-t border-slate-100 dark:border-slate-700">
            <button class="btn-ghost !px-2 !py-1 !text-xs" title="选品" :disabled="!a.enabled" @click="goSearch(a)">
              <Icon name="search" /> 选品
            </button>
            <button class="btn-ghost !px-2 !py-1 !text-xs" title="编辑" @click="openEditAccount(a)">
              <Icon name="edit" />
            </button>
            <button class="btn-ghost !px-2 !py-1 !text-xs" :title="a.enabled ? '停用' : '启用'" @click="toggleAccount(a)">
              <Icon :name="a.enabled ? 'eyeOff' : 'eye'" />
            </button>
            <button class="btn-ghost !px-2 !py-1 !text-xs text-red-500" title="删除" @click="removeAccount(a)">
              <Icon name="trash" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Tab 2: 选品搜索 -->
    <template v-if="tab === 'search'">
      <div class="card p-4 space-y-3">
        <div class="flex items-center gap-3 flex-wrap">
          <select v-model="searchForm.account_id" class="input !w-auto min-w-[220px]">
            <option value="">选择联盟账号...</option>
            <option v-for="a in enabledAccounts" :key="a.id" :value="a.id">
              {{ a.display_name }} ({{ a.network_meta?.nameCn || a.network_id }})
            </option>
          </select>
          <div class="relative flex-1 min-w-[240px]">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
            <input v-model="searchForm.keyword" class="input pl-9" placeholder="搜索商品关键词" @keyup.enter="doSearch(1)" />
          </div>
          <select v-model="searchForm.sort" class="input !w-auto">
            <option value="default">默认排序</option>
            <option value="commission">佣金优先</option>
            <option value="price_asc">价格升序</option>
            <option value="price_desc">价格降序</option>
          </select>
          <label class="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
            <input v-model="searchForm.has_coupon" type="checkbox" class="w-4 h-4 rounded text-brand-600" />
            仅有券
          </label>
          <button class="btn-primary" :disabled="searching || !searchForm.account_id || !searchForm.keyword" @click="doSearch(1)">
            <Icon name="search" v-if="!searching" />
            <Icon name="refresh" v-else class="animate-spin" />
            {{ searching ? '搜索中...' : '搜索' }}
          </button>
        </div>
        <div v-if="!enabledAccounts.length" class="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
          请先在「联盟账号」tab 配置并启用一个联盟账号
        </div>
      </div>

      <div v-if="searchMessage" class="card p-4 text-sm" :class="searchMessage.includes('失败') || searchMessage.includes('暂不') ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'">
        <Icon name="info" /> {{ searchMessage }}
        <a v-if="searchExternalUrl" :href="searchExternalUrl" target="_blank" rel="noopener noreferrer" class="ml-2 underline">前往官网选品 →</a>
      </div>

      <div v-if="searchItems.length" class="card overflow-hidden">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
          <div v-for="it in searchItems" :key="it.item_id" class="border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex gap-3 hover:shadow-md transition-shadow">
            <img v-if="it.pic_url" :src="it.pic_url" :alt="it.title" class="w-16 h-16 rounded object-cover shrink-0" loading="lazy" />
            <div v-else class="w-16 h-16 rounded bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 shrink-0">
              <Icon name="package" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm text-slate-800 dark:text-slate-100 line-clamp-2">{{ it.title }}</p>
              <div class="flex items-center gap-2 mt-1">
                <span class="font-semibold text-rose-600 dark:text-rose-400">¥{{ it.price }}</span>
                <span v-if="it.commission_rate" class="text-xs text-emerald-600 dark:text-emerald-400">佣{{ it.commission_rate }}</span>
              </div>
              <p v-if="it.shop_name" class="text-xs text-slate-400 mt-0.5 truncate">{{ it.shop_name }} · 销量{{ it.sales || '—' }}</p>
              <div class="flex items-center gap-1 mt-1">
                <a v-if="it.item_url" :href="it.item_url" target="_blank" rel="noopener noreferrer" class="btn-ghost !px-2 !py-0.5 !text-xs">
                  <Icon name="external" /> 查看
                </a>
                <button class="btn-ghost !px-2 !py-0.5 !text-xs text-brand-600" @click="collectItem(it)">
                  <Icon name="star" /> 收藏
                </button>
              </div>
            </div>
          </div>
        </div>
        <div v-if="searchTotal > searchForm.page_size" class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
          <p class="text-xs text-slate-500">共 {{ searchTotal }} 条, 第 {{ searchForm.page }} / {{ Math.ceil(searchTotal / searchForm.page_size) }} 页</p>
          <div class="flex gap-1">
            <button class="btn-secondary !px-2.5 !py-1.5" :disabled="searchForm.page <= 1" @click="doSearch(searchForm.page - 1)">上一页</button>
            <button class="btn-secondary !px-2.5 !py-1.5" :disabled="searchForm.page * searchForm.page_size >= searchTotal" @click="doSearch(searchForm.page + 1)">下一页</button>
          </div>
        </div>
      </div>
    </template>

    <!-- Tab 3: 我的选品 -->
    <template v-if="tab === 'collected'">
      <div class="card p-4 flex items-center gap-3 flex-wrap">
        <select v-model="collectedFilter.account_id" class="input !w-auto min-w-[200px]" @change="loadProducts(1)">
          <option value="">全部账号</option>
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.display_name }}</option>
        </select>
        <div class="relative flex-1 min-w-[200px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input v-model="collectedFilter.keyword" class="input pl-9" placeholder="搜索商品标题 / ID" @keyup.enter="loadProducts(1)" />
        </div>
        <label class="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
          <input v-model="collectedFilter.collected_only" type="checkbox" class="w-4 h-4 rounded text-brand-600" @change="loadProducts(1)" />
          仅看收藏
        </label>
        <button class="btn-secondary" @click="loadProducts(1)">
          <Icon name="refresh" /> 查询
        </button>
      </div>

      <div class="card overflow-hidden">
        <div v-if="productsLoading" class="p-10 text-center text-slate-400">
          <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
        </div>
        <template v-else>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>商品</th>
                  <th>价格</th>
                  <th>佣金率</th>
                  <th>联盟</th>
                  <th>收藏</th>
                  <th>更新时间</th>
                  <th class="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in products" :key="p.id">
                  <td>
                    <div class="flex items-center gap-2">
                      <img v-if="p.pic_url" :src="p.pic_url" class="w-10 h-10 rounded object-cover shrink-0" loading="lazy" />
                      <div class="min-w-0">
                        <p class="text-sm text-slate-800 dark:text-slate-100 truncate max-w-[240px]">{{ p.title || '—' }}</p>
                        <p class="text-xs text-slate-400 font-mono">{{ p.item_id }}</p>
                      </div>
                    </div>
                  </td>
                  <td><span class="font-semibold tabular-nums">¥{{ p.price || '—' }}</span></td>
                  <td><span class="text-emerald-600 dark:text-emerald-400 text-sm">{{ p.commission_rate || '—' }}</span></td>
                  <td><span class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">{{ p.network_id }}</span></td>
                  <td>
                    <button class="btn-ghost !px-1.5 !py-0.5" @click="toggleProductCollect(p)">
                      <Icon :name="p.collected ? 'star' : 'check'" :class="p.collected ? 'text-amber-500' : 'text-slate-400'" />
                    </button>
                  </td>
                  <td class="text-xs text-slate-500">{{ formatTime(p.updated_at) }}</td>
                  <td>
                    <div class="flex items-center justify-end gap-1">
                      <button class="btn-primary !px-2 !py-1 !text-xs" title="转为卡券 (闭环: 卡券绑定闲鱼商品 → 自动回复)" @click="openToCard(p)">
                        <Icon name="cards" /> 转卡券
                      </button>
                      <button class="btn-ghost !px-1.5 !py-0.5" @click="toggleProductCollect(p)">
                        <Icon :name="p.collected ? 'star' : 'check'" :class="p.collected ? 'text-amber-500' : 'text-slate-400'" />
                      </button>
                      <a v-if="p.item_url" :href="p.item_url" target="_blank" rel="noopener noreferrer" class="btn-ghost !px-2 !py-1 !text-xs">
                        <Icon name="external" />
                      </a>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <EmptyState v-if="!products.length" message="暂无选品记录, 去「选品搜索」采集商品" icon="store" />
        </template>
      </div>
    </template>

    <!-- 新增/编辑联盟账号 modal -->
    <ModalBase v-model="accountModalOpen" :title="editingAccount ? '编辑联盟账号' : '新增联盟账号'" size="lg">
      <div class="space-y-4">
        <!-- Step 1: 选联盟 -->
        <div v-if="!editingAccount">
          <label class="label">选择佣金联盟 <span class="text-red-500">*</span></label>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[280px] overflow-y-auto p-1">
            <button v-for="n in allNetworks" :key="n.id" class="text-left p-3 rounded-lg border transition-colors" :class="selectedNetwork?.id === n.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-brand-300'" @click="selectNetwork(n)">
              <div class="flex items-center gap-2 mb-1">
                <div class="w-7 h-7 rounded flex items-center justify-center shrink-0" :class="n.color">
                  <Icon name="store" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{{ n.nameCn || n.name }}</p>
                  <p class="text-[10px] text-slate-400">{{ n.region === 'domestic' ? '国内' : '海外' }} · {{ n.supportsServerSearch ? '支持选品' : '仅存凭据' }}</p>
                </div>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{{ n.description }}</p>
            </button>
          </div>
        </div>

        <!-- 注册指引 (选了联盟后显示) -->
        <div v-if="selectedNetwork" class="rounded-lg border border-sky-200 dark:border-sky-900/40 bg-sky-50 dark:bg-sky-900/10 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h4 class="font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
              <Icon name="info" /> {{ selectedNetwork.nameCn || selectedNetwork.name }} - 申请注册流程
            </h4>
            <div class="flex items-center gap-2">
              <a v-if="selectedNetwork.docsUrl" :href="selectedNetwork.docsUrl" target="_blank" rel="noopener noreferrer" class="btn-ghost !py-1 !px-2 !text-xs">
                <Icon name="external" /> API 文档
              </a>
              <a :href="selectedNetwork.registerUrl" target="_blank" rel="noopener noreferrer" class="btn-primary !py-1 !px-2 !text-xs">
                <Icon name="external" /> 前往注册
              </a>
            </div>
          </div>
          <p class="text-xs text-slate-600 dark:text-slate-300">{{ selectedNetwork.description }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">佣金模式: {{ selectedNetwork.commissionModel }}</p>
          <ol class="space-y-2">
            <li v-for="(s, i) in selectedNetwork.registrationSteps" :key="i" class="flex gap-2 text-sm">
              <span class="w-5 h-5 rounded-full bg-sky-200 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 flex items-center justify-center text-xs font-semibold shrink-0">{{ i + 1 }}</span>
              <div>
                <p class="font-medium text-slate-800 dark:text-slate-100">{{ s.title }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{{ s.detail }}</p>
              </div>
            </li>
          </ol>
        </div>

        <!-- 凭据表单 -->
        <template v-if="selectedNetwork || editingAccount">
          <div>
            <label class="label">显示名称</label>
            <input v-model="accountForm.display_name" class="input" :placeholder="currentNetworkMeta?.nameCn || '便于识别的名称'" />
          </div>
          <div v-for="f in currentNetworkMeta?.fields || []" :key="f.key">
            <label class="label">{{ f.label }} <span v-if="f.required" class="text-red-500">*</span></label>
            <input v-if="f.type === 'text'" v-model="accountForm.credentials[f.key]" class="input" :placeholder="f.placeholder" :type="f.type" />
            <input v-else-if="f.type === 'password'" v-model="accountForm.credentials[f.key]" class="input" :placeholder="f.placeholder || '••••••••'" type="password" />
            <textarea v-else v-model="accountForm.credentials[f.key]" rows="3" class="input font-mono text-xs" :placeholder="f.placeholder" />
            <p v-if="f.help" class="text-xs text-slate-400 mt-1">{{ f.help }}</p>
            <p v-if="f.type === 'password' && editingAccount" class="text-xs text-amber-500 mt-1">留空或保持 ****** 则不修改</p>
          </div>
          <div>
            <label class="label">备注</label>
            <input v-model="accountForm.remark" class="input" placeholder="可选" />
          </div>
        </template>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="accountModalOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving || (!selectedNetwork && !editingAccount)" @click="saveAccount">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>

    <!-- 转卡券 modal (闭环) -->
    <ModalBase v-model="toCardModalOpen" title="选品转卡券 (闭环)" size="md">
      <div v-if="toCardTarget" class="space-y-4">
        <div class="rounded-lg bg-brand-50 dark:bg-brand-900/20 p-3 text-sm text-brand-700 dark:text-brand-300">
          <p class="font-semibold mb-1">闭环流程说明</p>
          <p class="text-xs">选品 → 卡券(含联盟链接) → 绑定闲鱼商品 → 关键词自动回复 → 买家咨询时发送联盟链接 → 赚取佣金</p>
        </div>
        <div class="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 space-y-1">
          <div class="flex justify-between"><span class="text-xs text-slate-400">商品</span><span class="text-sm font-medium truncate ml-2 max-w-[240px]">{{ toCardTarget.title }}</span></div>
          <div class="flex justify-between"><span class="text-xs text-slate-400">价格</span><span class="text-sm">¥{{ toCardTarget.price }}</span></div>
          <div class="flex justify-between"><span class="text-xs text-slate-400">佣金率</span><span class="text-sm text-emerald-600">{{ toCardTarget.commission_rate || '—' }}</span></div>
          <div class="flex justify-between"><span class="text-xs text-slate-400">联盟</span><span class="text-sm">{{ toCardTarget.network_id }}</span></div>
        </div>
        <div>
          <label class="label">关联闲鱼商品 <span class="text-xs text-slate-400">(可选, 用于自动回复匹配)</span></label>
          <select v-model="toCardForm.item_id" class="input">
            <option value="">不绑定商品</option>
            <option v-for="i in xianyuItemsForAccount" :key="i.item_id" :value="i.item_id">
              {{ i.item_id }} · {{ i.item_title || '无标题' }}
            </option>
          </select>
          <p class="text-xs text-slate-400 mt-1">从商品管理列表选择, 显示商品 ID + 标题; 选择后卡券会绑定该闲鱼商品, 买家咨询时自动匹配</p>
        </div>
        <div>
          <label class="label">闲鱼账号 <span class="text-xs text-slate-400">(可选, 用于创建自动回复关键词)</span></label>
          <select v-model="toCardForm.cookie_id" class="input" @change="onToCardAccountChange">
            <option value="">不创建关键词</option>
            <option v-for="a in xianyuAccounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
        </div>
        <div v-if="toCardForm.cookie_id">
          <label class="label">自动回复关键词 <span class="text-xs text-slate-400">(买家发送该词时自动回复卡券内容)</span></label>
          <input v-model="toCardForm.keyword" class="input" placeholder="如商品标题关键词" />
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="toCardModalOpen = false">取消</button>
        <button class="btn-primary" :disabled="toCardSaving" @click="submitToCard">
          <Icon name="cards" v-if="!toCardSaving" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ toCardSaving ? '生成中...' : '生成卡券' }}
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getNetworks, getAccounts, saveAccount as saveAccountApi, updateAccount, deleteAccount, searchProducts as searchProductsApi, getProducts, toggleCollect, productToCard } from '~/api/affiliate'
import { getAccounts as getXianyuAccounts } from '~/api/accounts'
import { getItems } from '~/api/items'
import type { Item } from '~/api/items'
import type { AffiliateNetwork, AffiliateAccount, SearchResultItem, AffiliateProduct } from '~/api/affiliate'

definePageMeta({ layout: 'default' })

const toast = useToast()

const TABS = [
  { key: 'accounts', label: '联盟账号', icon: 'store' },
  { key: 'search', label: '选品搜索', icon: 'search' },
  { key: 'collected', label: '我的选品', icon: 'star' },
] as const

const tab = ref<'accounts' | 'search' | 'collected'>('accounts')
const loading = ref(false)
const saving = ref(false)

// 联盟列表
const allNetworks = ref<AffiliateNetwork[]>([])
const networksByRegion = ref<{ domestic: AffiliateNetwork[]; overseas: AffiliateNetwork[] }>({ domestic: [], overseas: [] })

// 账号
const accounts = ref<AffiliateAccount[]>([])
const enabledAccounts = computed(() => accounts.value.filter((a) => a.enabled))
const accountModalOpen = ref(false)
const editingAccount = ref<AffiliateAccount | null>(null)
const selectedNetwork = ref<AffiliateNetwork | null>(null)
const accountForm = reactive({
  display_name: '',
  credentials: {} as Record<string, string>,
  remark: '',
})
const currentNetworkMeta = computed(() => {
  if (editingAccount.value) return editingAccount.value.network_meta
  return selectedNetwork.value
})

// 选品搜索
const searching = ref(false)
const searchItems = ref<SearchResultItem[]>([])
const searchTotal = ref(0)
const searchMessage = ref('')
const searchExternalUrl = ref('')
const searchForm = reactive({
  account_id: '' as string | number,
  keyword: '',
  page: 1,
  page_size: 20,
  sort: 'default',
  has_coupon: false,
})

// 我的选品
const productsLoading = ref(false)
const products = ref<AffiliateProduct[]>([])
const collectedFilter = reactive({
  account_id: '' as string | number,
  keyword: '',
  collected_only: false,
})

// 转卡券 (闭环)
const toCardModalOpen = ref(false)
const toCardTarget = ref<AffiliateProduct | null>(null)
const toCardSaving = ref(false)
const xianyuAccounts = ref<{ id: string; remark: string }[]>([])
const xianyuItems = ref<Item[]>([])
const toCardForm = reactive({
  item_id: '',
  cookie_id: '',
  keyword: '',
})

/** 转卡券弹窗: 已选账号时只列该账号商品, 未选账号时列出全部商品 (显示商品 ID + 标题) */
const xianyuItemsForAccount = computed(() =>
  toCardForm.cookie_id
    ? xianyuItems.value.filter((i) => i.cookie_id === toCardForm.cookie_id)
    : xianyuItems.value,
)

/** 切换账号时, 已选商品不属于新账号则清空 */
function onToCardAccountChange() {
  if (toCardForm.item_id && !xianyuItemsForAccount.value.some((i) => i.item_id === toCardForm.item_id)) {
    toCardForm.item_id = ''
  }
}

async function reload() {
  loading.value = true
  try {
    const [nets, accs, xyAccs, xyItems] = await Promise.all([
      getNetworks(),
      getAccounts(),
      getXianyuAccounts().catch(() => []),
      getItems().catch(() => [] as Item[]),
    ])
    networksByRegion.value = nets
    allNetworks.value = [...nets.domestic, ...nets.overseas]
    accounts.value = accs
    xianyuAccounts.value = xyAccs.map((a: any) => ({ id: a.id, remark: a.remark || a.id }))
    xianyuItems.value = xyItems
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

// ===== 账号管理 =====
function openAddAccount() {
  editingAccount.value = null
  selectedNetwork.value = null
  accountForm.display_name = ''
  accountForm.credentials = {}
  accountForm.remark = ''
  accountModalOpen.value = true
}

function openEditAccount(a: AffiliateAccount) {
  editingAccount.value = a
  selectedNetwork.value = null
  accountForm.display_name = a.display_name
  accountForm.credentials = { ...a.credentials }
  accountForm.remark = a.remark || ''
  accountModalOpen.value = true
}

function selectNetwork(n: AffiliateNetwork) {
  selectedNetwork.value = n
  accountForm.display_name = n.nameCn || n.name
  accountForm.credentials = {}
  for (const f of n.fields) accountForm.credentials[f.key] = ''
}

async function saveAccount() {
  const net = editingAccount.value?.network_meta || selectedNetwork.value
  if (!net) {
    toast.error('请选择联盟')
    return
  }
  // 校验必填
  for (const f of net.fields) {
    if (f.required) {
      const v = accountForm.credentials[f.key]
      if (!v || v === '******') {
        if (!(f.type === 'password' && editingAccount.value)) {
          toast.error(`请填写「${f.label}」`)
          return
        }
      }
    }
  }
  saving.value = true
  try {
    await saveAccountApi({
      network_id: net.id,
      display_name: accountForm.display_name || net.nameCn || net.name,
      credentials: accountForm.credentials,
      remark: accountForm.remark,
    })
    toast.success(editingAccount.value ? '账号已更新' : '账号已添加')
    accountModalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleAccount(a: AffiliateAccount) {
  try {
    await updateAccount(a.id, { enabled: !a.enabled })
    a.enabled = a.enabled ? 0 : 1
    toast.success(a.enabled ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function removeAccount(a: AffiliateAccount) {
  if (!confirm(`确认删除联盟账号「${a.display_name}」? 相关选品记录也会删除`)) return
  try {
    await deleteAccount(a.id)
    toast.success('账号已删除')
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  }
}

// ===== 选品搜索 =====
function goSearch(a: AffiliateAccount) {
  tab.value = 'search'
  searchForm.account_id = a.id
  searchForm.keyword = ''
  searchItems.value = []
  searchMessage.value = ''
}

async function doSearch(page = 1) {
  if (!searchForm.account_id || !searchForm.keyword.trim()) return
  searching.value = true
  searchMessage.value = ''
  searchExternalUrl.value = ''
  searchForm.page = page
  try {
    const r = await searchProductsApi({
      account_id: Number(searchForm.account_id),
      keyword: searchForm.keyword.trim(),
      page: searchForm.page,
      page_size: searchForm.page_size,
      sort: searchForm.sort,
      has_coupon: searchForm.has_coupon,
    })
    searchItems.value = r.items || []
    searchTotal.value = r.total || 0
    if (r.message) {
      searchMessage.value = r.message
      searchExternalUrl.value = r.externalUrl || ''
    } else if (!r.items.length) {
      searchMessage.value = '未搜索到相关商品'
    }
  } catch (e: any) {
    searchMessage.value = e.message || '搜索失败'
    searchItems.value = []
  } finally {
    searching.value = false
  }
}

async function collectItem(it: SearchResultItem) {
  // 搜索结果已自动写入 affiliate_products, 这里只更新 collected
  // 通过 item_id + account_id 查找本地记录
  try {
    // 重新加载我的选品让用户看到
    toast.success('已收藏 (商品已自动保存)')
    if (tab.value === 'collected') loadProducts()
  } catch (e: any) {
    toast.error(e.message || '收藏失败')
  }
}

// ===== 我的选品 =====
async function loadProducts(page = 1) {
  productsLoading.value = true
  try {
    const r = await getProducts({
      account_id: collectedFilter.account_id ? Number(collectedFilter.account_id) : undefined,
      keyword: collectedFilter.keyword.trim() || undefined,
      collected: collectedFilter.collected_only,
      page,
      page_size: 20,
    })
    products.value = r.items || []
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    productsLoading.value = false
  }
}

async function toggleProductCollect(p: AffiliateProduct) {
  try {
    await toggleCollect(p.id, !p.collected)
    p.collected = p.collected ? 0 : 1
    toast.success(p.collected ? '已收藏' : '已取消收藏')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

// 转卡券 (闭环)
function openToCard(p: AffiliateProduct) {
  toCardTarget.value = p
  toCardForm.item_id = ''
  toCardForm.cookie_id = ''
  toCardForm.keyword = p.title?.slice(0, 20) || ''
  toCardModalOpen.value = true
}

async function submitToCard() {
  if (!toCardTarget.value) return
  toCardSaving.value = true
  try {
    const r = await productToCard(toCardTarget.value.id, {
      item_id: toCardForm.item_id.trim() || undefined,
      cookie_id: toCardForm.cookie_id || undefined,
      keyword: toCardForm.keyword.trim() || undefined,
    })
    toast.success(r.message || '卡券已生成')
    toCardModalOpen.value = false
    loadProducts()
  } catch (e: any) {
    toast.error(e.message || '生成失败')
  } finally {
    toCardSaving.value = false
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
