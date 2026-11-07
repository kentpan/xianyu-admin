<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="订单管理" description="订单列表 / 获取最新订单 / 手动发货 / 导入导出">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-secondary" :disabled="syncing" @click="syncAll">
          <Icon name="refresh" :class="syncing ? 'animate-spin' : ''" /> 获取最新的订单列表
        </button>
        <button
          class="btn-secondary"
          :disabled="backfilling"
          title="闲鱼列表接口 11-06 起不再返回收货人信息，点击用订单详情接口补全缺失的手机号/收货人/地址"
          @click="runBackfillReceiver"
        >
          <Icon name="refresh" :class="backfilling ? 'animate-spin' : ''" /> 补全收货信息
        </button>
        <button class="btn-secondary" @click="openImport">
          <Icon name="upload" /> 导入
        </button>
        <button class="btn-secondary" @click="exportOrders">
          <Icon name="download" /> 导出JSON
        </button>
        <button class="btn-secondary" @click="exportCSV">
          <Icon name="download" /> 导出CSV
        </button>
      </template>
    </PageHeader>

    <!-- Tab 切换 (v2.2.5): 我的订单 = 已添加账号订单 (筛选+列表) / 闲鱼趋势 = 全账号7天趋势 + 全量订单列表 -->
    <div class="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700" role="tablist" aria-label="订单视图切换">
      <button
        role="tab"
        :aria-selected="activeTab === 'mine'"
        class="px-4 py-2.5 -mb-px border-b-2 font-medium transition-colors flex items-center gap-1.5"
        :class="activeTab === 'mine' ? 'border-brand-600 text-brand-600 dark:text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'"
        @click="switchTab('mine')"
      >
        <Icon name="orders" /> 我的订单
      </button>
      <button
        role="tab"
        :aria-selected="activeTab === 'trend'"
        class="px-4 py-2.5 -mb-px border-b-2 font-medium transition-colors flex items-center gap-1.5"
        :class="activeTab === 'trend' ? 'border-brand-600 text-brand-600 dark:text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'"
        @click="switchTab('trend')"
      >
        <Icon name="activity" /> 闲鱼趋势
        <span v-if="trendOtherTotal > 0" class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300">{{ trendOtherTotal }}</span>
      </button>
    </div>

    <template v-if="activeTab === 'mine'">
    <!-- Filters -->
    <div class="card p-4">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label class="label">订单状态</label>
          <select v-model="filters.status" class="input" @change="reload">
            <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div>
          <label class="label">所属账号</label>
          <select v-model="filters.cookie_id" class="input" @change="reload">
            <option value="">全部账号</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="label">关键词搜索</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
            <input
              v-model="filters.keyword"
              class="input pl-9"
              placeholder="订单号 / 买家 ID"
              @keyup.enter="reload"
            />
          </div>
        </div>
      </div>
      <!-- Advanced filters (collapsible) -->
      <div class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button class="text-xs text-brand-600 hover:underline flex items-center gap-1" @click="showAdvanced = !showAdvanced">
          <Icon name="chevronDown" :class="showAdvanced ? 'rotate-180' : ''" class="transition-transform" />
          {{ showAdvanced ? '收起高级筛选' : '展开高级筛选' }}
        </button>
        <div v-if="showAdvanced" class="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
          <div>
            <label class="label">开始日期</label>
            <input v-model="filters.dateFrom" type="date" class="input" @change="reload" />
          </div>
          <div>
            <label class="label">结束日期</label>
            <input v-model="filters.dateTo" type="date" class="input" @change="reload" />
          </div>
          <div>
            <label class="label">最小金额 (¥)</label>
            <input v-model="filters.amountMin" type="number" min="0" step="0.01" class="input" placeholder="0" @keyup.enter="reload" />
          </div>
          <div>
            <label class="label">最大金额 (¥)</label>
            <input v-model="filters.amountMax" type="number" min="0" step="0.01" class="input" placeholder="不限" @keyup.enter="reload" />
          </div>
        </div>
        <div v-if="showAdvanced" class="flex items-center gap-2 mt-3">
          <button class="btn-secondary !text-xs !py-1" @click="resetFilters">
            <Icon name="close" /> 重置筛选
          </button>
          <span v-if="hasActiveFilters" class="text-xs text-slate-400">有 {{ activeFilterCount }} 个高级筛选生效中</span>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <!-- Batch toolbar -->
        <div v-if="selectedIds.length" class="flex items-center gap-2 px-4 py-2.5 bg-brand-50 dark:bg-brand-900/20 border-b border-brand-200 dark:border-brand-800 rounded-t-lg">
          <span class="text-sm text-brand-700 dark:text-brand-300 font-medium">已选 {{ selectedIds.length }} 项</span>
          <div class="flex-1" />
          <button class="btn-secondary !py-1 !px-2.5 !text-xs" :disabled="batching" @click="batchAction('ship')">
            <Icon v-if="batching === 'ship'" name="refresh" class="animate-spin" />
            <Icon v-else name="truck" /> 批量发货
          </button>
          <button class="btn-secondary !py-1 !px-2.5 !text-xs" :disabled="!!batching" @click="batchAction('export')">
            <Icon name="download" /> 导出选中
          </button>
          <button class="btn-danger !py-1 !px-2.5 !text-xs" :disabled="batching === 'delete'" @click="batchAction('delete')">
            <Icon v-if="batching === 'delete'" name="refresh" class="animate-spin" />
            <Icon v-else name="trash" /> 批量删除
          </button>
          <button class="btn-ghost !py-1 !px-2.5 !text-xs" @click="selectedIds = []">取消</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="w-10">
                  <input type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" :checked="allSelected" :indeterminate.prop="someSelected" @change="toggleAll" />
                </th>
                <th>订单号</th>
                <th>商品</th>
                <th>买家</th>
                <th>金额</th>
                <th>状态</th>
                <th class="hidden lg:table-cell">所属账号</th>
                <th>收货人</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in orders" :key="o.order_id" class="cursor-pointer" :class="selectedIds.includes(o.order_id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''" @click="openDetail(o)">
                <td @click.stop><input type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" :value="o.order_id" v-model="selectedIds" /></td>
                <td class="font-mono text-xs">{{ o.order_id }}</td>
                <td class="max-w-[200px]">
                  <p class="truncate text-slate-800 dark:text-slate-100">{{ o.item_title || o.item_id || '—' }}</p>
                  <p v-if="o.spec_value" class="text-xs text-slate-400">{{ o.spec_name }}: {{ o.spec_value }}</p>
                </td>
                <td class="max-w-[140px]">
                  <p class="truncate">{{ o.buyer_nick || o.buyer_id || '—' }}</p>
                  <p v-if="o.buyer_nick && o.buyer_id" class="text-xs text-slate-400 font-mono truncate">{{ o.buyer_id }}</p>
                </td>
                <td><span class="font-medium text-slate-700 dark:text-slate-200">¥{{ o.amount || '0' }}</span></td>
                <td><OrderStatusBadge :status="o.order_status" /></td>
                <td class="hidden lg:table-cell text-slate-500 dark:text-slate-400 max-w-[140px]">
                  <p class="truncate">{{ o.cookie_remark || o.cookie_id || '—' }}</p>
                </td>
                <td>
                  <template v-if="o.receiver_name">
                    <p class="text-slate-700 dark:text-slate-200">{{ o.receiver_name }}</p>
                    <p class="text-xs text-slate-400">{{ o.receiver_phone }}</p>
                  </template>
                  <span v-else class="text-slate-400">—</span>
                </td>
                <td class="text-slate-500 dark:text-slate-400">
                  <p>{{ formatTime(o.created_at) }}</p>
                  <p v-if="o.paid_at" class="text-xs text-slate-400">付款 {{ formatTime(o.paid_at) }}</p>
                  <p v-if="o.shipped_at" class="text-xs text-slate-400">发货 {{ formatTime(o.shipped_at) }}</p>
                  <p v-if="o.finished_at" class="text-xs text-slate-400">完成 {{ formatTime(o.finished_at) }}</p>
                  <p v-if="o.cancelled_at" class="text-xs text-slate-400">取消 {{ formatTime(o.cancelled_at) }}</p>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-1" @click.stop>
                    <button class="btn-ghost !px-2 !py-1" title="查看详情" @click="openDetail(o)">
                      <Icon name="eye" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="详情精修 (从闲鱼实查回写)" @click="refreshOne(o)">
                      <Icon name="refresh" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="手动发货" @click="manualShip(o)">
                      <Icon name="truck" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="deleteOne(o)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!orders.length" message="暂无订单数据" icon="orders" />
      </template>

      <!-- Pagination -->
      <div v-if="total > pageSize" class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
        <p class="text-xs text-slate-500">共 {{ total }} 条，第 {{ page }} / {{ totalPages }} 页</p>
        <div class="flex items-center gap-1 flex-wrap">
          <button class="btn-secondary !px-2.5 !py-1.5" :disabled="page <= 1" @click="goPage(page - 1)">
            <Icon name="chevronRight" class="rotate-180" />
          </button>
          <template v-for="(p, i) in pageItems" :key="`${p}-${i}`">
            <span v-if="typeof p === 'string'" class="px-1.5 text-slate-400 select-none">{{ p }}</span>
            <button
              v-else
              class="btn-secondary !px-2.5 !py-1.5 min-w-8"
              :class="p === page ? '!bg-brand-600 !text-white !border-brand-600 hover:!bg-brand-700' : ''"
              :disabled="p === page"
              @click="goPage(p)"
            >
              {{ p }}
            </button>
          </template>
          <button class="btn-secondary !px-2.5 !py-1.5" :disabled="page >= totalPages" @click="goPage(page + 1)">
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
    </div>

    <!-- 我的订单 tab 结束 -->
    </template>

    <!-- ==================== 闲鱼趋势 tab (v2.2.5) ==================== -->
    <template v-else>
      <!-- 全平台热门商品趋势 (v2.3.0): 闲鱼站内搜索快照聚合 — 热门榜/同款竞争度/价格带 -->
      <div class="card p-5 mb-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 class="font-semibold text-slate-900 dark:text-white">全平台热门商品趋势</h3>
            <p class="text-xs text-slate-400 mt-0.5">按关键词搜索闲鱼站内全平台在售商品, 聚合想要人数/同款卖家数/价格带做热门榜 (搜索为全平台口径, 与账号无关)</p>
          </div>
          <div class="flex items-center gap-2">
            <!-- 商品类型筛选 (v2.3.0): 默认虚拟商品, 与卖虚拟服务的运营口径一致 -->
            <div class="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800" role="group" aria-label="商品类型筛选">
              <button
                v-for="t in HOT_TYPE_OPTIONS"
                :key="t.value || 'all'"
                type="button"
                class="px-2.5 py-1.5 text-xs transition-colors"
                :class="hotItemType === t.value ? 'bg-brand-500 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'"
                :aria-pressed="hotItemType === t.value"
                @click="hotItemType = t.value; loadHotTrends()"
              >{{ t.label }}</button>
            </div>
            <input
              v-model="hotKeyword"
              class="input !py-1.5 !text-sm w-44"
              placeholder="搜索关键词, 如: TG API"
              aria-label="热门商品搜索关键词"
              @keyup.enter="runHotSync"
            />
            <button class="btn-primary !py-1.5 !px-3 whitespace-nowrap" :disabled="hotSyncing || !hotKeyword.trim()" @click="runHotSync">
              <Icon name="refresh" :class="hotSyncing ? 'animate-spin' : ''" /> {{ hotSyncing ? '搜索中...' : '搜索全平台' }}
            </button>
          </div>
        </div>
        <!-- 聚合统计 chips -->
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">在售商品 {{ hotStats.total }}</span>
          <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">不同卖家 {{ hotStats.sellers }}</span>
          <span v-if="hotStats.min_price != null" class="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">价格带 ¥{{ hotStats.min_price }} ~ ¥{{ hotStats.max_price }}</span>
          <button
            v-for="k in hotKeywords.slice(0, 5)"
            :key="k.keyword"
            class="badge bg-brand-50 text-brand-600 hover:bg-brand-100 dark:bg-brand-900/20 dark:text-brand-400 cursor-pointer"
            @click="hotKeyword = k.keyword; loadHotTrends()"
          >{{ k.keyword || '(未记词)' }} · {{ k.c }}</button>
        </div>
        <div v-if="hotLoading" class="p-8 flex items-center justify-center text-slate-400">
          <Icon name="refresh" class="animate-spin mr-2" /> 加载热门榜...
        </div>
        <template v-else>
          <div v-if="hotItems.length" class="max-h-96 overflow-y-auto table-wrap" style="scrollbar-width: thin">
            <table class="table">
              <thead class="sticky top-0 bg-white dark:bg-slate-800 z-10">
                <tr>
                  <th>#</th>
                  <th>商品标题</th>
                  <th>价格</th>
                  <th>想要人数</th>
                  <th class="hidden md:table-cell">卖家</th>
                  <th class="hidden lg:table-cell">地区</th>
                  <th class="hidden md:table-cell">命中次数</th>
                  <th>最近发现</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(h, i) in hotItems" :key="h.item_id">
                  <td class="text-slate-400 tabular-nums">{{ i + 1 }}</td>
                  <td class="max-w-[280px]">
                    <p class="truncate text-slate-800 dark:text-slate-100" :title="h.title">{{ h.title || '—' }}</p>
                    <p class="text-xs text-slate-400 truncate">ID {{ h.item_id }}</p>
                  </td>
                  <td><span class="font-medium text-slate-700 dark:text-slate-200 tabular-nums">{{ h.price ? `¥${h.price}` : '—' }}</span></td>
                  <td class="tabular-nums">{{ h.want_count || '—' }}</td>
                  <td class="hidden md:table-cell max-w-[120px]"><p class="truncate">{{ h.seller_nick || h.seller_id || '—' }}</p></td>
                  <td class="hidden lg:table-cell text-slate-500 dark:text-slate-400">{{ h.area || '—' }}</td>
                  <td class="hidden md:table-cell tabular-nums text-slate-500">{{ h.seen_count }}</td>
                  <td class="text-slate-500 dark:text-slate-400">{{ formatTime(h.last_seen_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <EmptyState v-else message="暂无热门商品数据 — 输入关键词点击「搜索全平台」抓取闲鱼站在售商品" icon="activity" />
        </template>
      </div>

      <!-- 7天全账号订单趋势 (chart.js 柱线混合图, 点击查看核心指标) -->
      <div class="card p-5">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="font-semibold text-slate-900 dark:text-white">闲鱼趋势 · 近 7 天全部账号订单</h3>
            <p class="text-xs text-slate-400 mt-0.5">含已添加与非已添加账号的全部订单 (真实交易时间口径) · 点击图表查看核心指标</p>
          </div>
          <div class="flex items-center gap-4 text-right">
            <div>
              <p class="text-xs text-slate-400">7天订单</p>
              <p class="text-lg font-semibold text-slate-900 dark:text-white tabular-nums">{{ trendWeek.all }}</p>
            </div>
            <div>
              <p class="text-xs text-slate-400">7天收入</p>
              <p class="text-lg font-semibold text-emerald-600 tabular-nums">¥{{ trendWeek.revenue.toFixed(2) }}</p>
            </div>
            <button class="btn-primary !py-1.5 !px-3" @click="metricsOpen = true">
              <Icon name="activity" /> 核心指标
            </button>
          </div>
        </div>
        <div v-if="trendLoading" class="p-10 flex items-center justify-center text-slate-400">
          <Icon name="refresh" class="animate-spin mr-2" /> 加载趋势数据...
        </div>
        <template v-else>
          <BarLineChart
            v-if="trends.days.length"
            :labels="trends.days.map(d => d.label)"
            :bar-data="trends.days.map(d => d.count)"
            :line-data="trends.days.map(d => d.revenue)"
            bar-label="订单量(单)"
            line-label="收入(¥)"
            :height="240"
            click-hint="点击查看已付款/已收货/已退款核心指标"
            @activate="metricsOpen = true"
          />
          <EmptyState v-else message="暂无订单趋势数据" icon="activity" />
        </template>
      </div>

      <!-- 全量订单分页列表 (v2.2.7): 全量同步拉取的所有状态订单 + 非已添加账号历史订单 -->
      <div class="card overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 class="font-semibold text-slate-900 dark:text-white">全量订单</h3>
            <p class="text-xs text-slate-400 mt-0.5">同步拉取的所有状态订单 (待付款/待发货/已发货/已完成/已取消/退款) 及非已添加账号的历史订单, 共 {{ trendOtherTotal }} 条</p>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn-ghost !py-1.5 !px-3 !text-xs" :disabled="repairing" title="逐单调闲鱼订单详情对账: 回填真实下单时间/卖家身份, 清理订单号精度丢失的截断脏单" @click="runRepair">
              <Icon name="refresh" :class="repairing ? 'animate-spin' : ''" /> {{ repairing ? '核验中...' : '订单核验修复' }}
            </button>
            <button class="btn-secondary !py-1.5 !px-3" :disabled="otherSyncing" @click="syncTrendOrders">
              <Icon name="refresh" :class="otherSyncing ? 'animate-spin' : ''" /> 同步订单
            </button>
          </div>
        </div>
        <div v-if="otherLoading" class="p-10 flex items-center justify-center text-slate-400">
          <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
        </div>
        <template v-else>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>商品</th>
                  <th>买家</th>
                  <th>卖家账号</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>交易时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="o in otherOrders" :key="o.order_id" class="cursor-pointer" @click="openDetail(o)">
                  <td class="font-mono text-xs">{{ o.order_id }}</td>
                  <td class="max-w-[200px]">
                    <p class="truncate text-slate-800 dark:text-slate-100">{{ o.item_title || o.item_id || '—' }}</p>
                    <p v-if="o.spec_value" class="text-xs text-slate-400">{{ o.spec_name }}: {{ o.spec_value }}</p>
                  </td>
                  <td class="max-w-[140px]">
                    <p class="truncate">{{ o.buyer_nick || o.buyer_id || '—' }}</p>
                    <p v-if="o.buyer_nick && o.buyer_id" class="text-xs text-slate-400 font-mono truncate">{{ o.buyer_id }}</p>
                  </td>
                  <td class="text-slate-500 dark:text-slate-400 max-w-[140px]"><p class="truncate font-mono">{{ o.cookie_id || '—' }}</p></td>
                  <td>
                    <span class="font-medium text-slate-700 dark:text-slate-200">¥{{ o.amount || '0' }}</span>
                    <p v-if="o.item_price && o.item_price !== o.amount" class="text-xs text-slate-400">单价 ¥{{ o.item_price }}</p>
                  </td>
                  <td><OrderStatusBadge :status="o.order_status" /></td>
                  <td class="text-slate-500 dark:text-slate-400">
                    <p>{{ formatTime(o.created_at) }}</p>
                    <!-- 状态时间 (v2.2.7 全量解析): 付款/发货/收货/取消 (接口真实携带才展示, 绝不伪造) -->
                    <p v-if="o.paid_at" class="text-xs text-slate-400">付款 {{ formatTime(o.paid_at) }}</p>
                    <p v-if="o.shipped_at" class="text-xs text-slate-400">发货 {{ formatTime(o.shipped_at) }}</p>
                    <p v-if="o.finished_at" class="text-xs text-slate-400">收货 {{ formatTime(o.finished_at) }}</p>
                    <p v-if="o.cancelled_at" class="text-xs text-slate-400">取消 {{ formatTime(o.cancelled_at) }}</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <EmptyState v-if="!otherOrders.length" message="暂无全量订单 — 点击右上角「同步订单」拉取闲鱼真实订单列表 (所有状态)" icon="orders" />
        </template>
        <div v-if="trendOtherTotal > otherPageSize" class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
          <p class="text-xs text-slate-500">共 {{ trendOtherTotal }} 条，第 {{ otherPage }} / {{ otherTotalPages }} 页</p>
          <div class="flex items-center gap-1 flex-wrap">
            <button class="btn-secondary !px-2.5 !py-1.5" :disabled="otherPage <= 1" @click="goOtherPage(otherPage - 1)">
              <Icon name="chevronRight" class="rotate-180" />
            </button>
            <template v-for="(p, i) in otherPageItems" :key="`${p}-${i}`">
              <span v-if="typeof p === 'string'" class="px-1.5 text-slate-400 select-none">{{ p }}</span>
              <button
                v-else
                class="btn-secondary !px-2.5 !py-1.5 min-w-8"
                :class="p === otherPage ? '!bg-brand-600 !text-white !border-brand-600 hover:!bg-brand-700' : ''"
                :disabled="p === otherPage"
                @click="goOtherPage(p)"
              >
                {{ p }}
              </button>
            </template>
            <button class="btn-secondary !px-2.5 !py-1.5" :disabled="otherPage >= otherTotalPages" @click="goOtherPage(otherPage + 1)">
              <Icon name="chevronRight" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ==================== 核心指标弹窗 (chart.js) ==================== -->
    <ModalBase v-model="metricsOpen" title="闲鱼趋势 · 核心订单指标" size="lg">
      <div class="space-y-6">
        <!-- 指标数据面板 (全库累计 + 近7天) -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="订单总数" :value="metricsTotals.all" icon="orders" color="slate" :hint="`近7天 ${trendWeek.all} 单`" />
          <StatCard label="已付款" :value="metricsTotals.paid" icon="cards" color="amber" :hint="`近7天 ${trendWeek.paid} 单`" />
          <StatCard label="已收货" :value="metricsTotals.received" icon="delivery" color="emerald" :hint="`近7天 ${trendWeek.received} 单`" />
          <StatCard label="已退款" :value="metricsTotals.refunded" icon="alert" color="rose" :hint="`近7天 ${trendWeek.refunded} 单`" />
        </div>

        <!-- 7天各指标趋势图表 (chart.js) -->
        <div v-if="metricsTrendLoading" class="p-10 flex items-center justify-center text-slate-400">
          <Icon name="refresh" class="animate-spin mr-2" /> 加载指标趋势...
        </div>
        <div v-else-if="trends.days.length" class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p class="text-xs text-slate-400 mb-1 flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-500" /> 已付款 (单/天)</p>
            <LineChart :data="trends.days.map(d => d.paid)" :labels="trends.days.map(d => d.label)" color="#f59e0b" unit="单" :height="160" />
          </div>
          <div>
            <p class="text-xs text-slate-400 mb-1 flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500" /> 已收货 (单/天)</p>
            <LineChart :data="trends.days.map(d => d.received)" :labels="trends.days.map(d => d.label)" color="#10b981" unit="单" :height="160" />
          </div>
          <div>
            <p class="text-xs text-slate-400 mb-1 flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-rose-500" /> 已退款 (单/天)</p>
            <LineChart :data="trends.days.map(d => d.refunded)" :labels="trends.days.map(d => d.label)" color="#f43f5e" unit="单" :height="160" />
          </div>
        </div>
        <EmptyState v-else message="暂无趋势数据" icon="activity" />
        <p class="text-xs text-slate-400">口径: 已付款 = 待发货/已发货/已完成/退款中/已退款/处理中 (均已完成付款); 已收货 = 交易成功; 已退款 = 退款中/已退款。统计基于库内真实订单状态与交易时间。</p>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="metricsOpen = false">关闭</button>
      </template>
    </ModalBase>

    <!-- Detail drawer (只读信息 + 单订单精修编辑) -->
    <DetailDrawer v-model="detailOpen" :eyebrow="'订单详情'" :title="detail?.order_id || '—'">
      <div v-if="detail" class="space-y-5">
        <!-- Status -->
        <div class="flex items-center gap-3">
          <OrderStatusBadge :status="detail.order_status" />
          <select v-model="editForm.order_status" class="input !w-auto">
            <option v-for="o in statusOptions.filter(s => s.value !== 'all')" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>

        <!-- Basic info -->
        <div class="space-y-2 text-sm">
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">商品</span>
            <span class="col-span-2 text-slate-800 dark:text-slate-100">{{ detail.item_title || detail.item_id || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">买家</span>
            <span class="col-span-2">{{ detail.buyer_id || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">金额</span>
            <span class="col-span-2">
              <input v-model="editForm.amount" class="input !py-1 !h-8" placeholder="如 12.50" />
            </span>
          </div>
          <div v-if="detail.spec_value" class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">规格</span>
            <span class="col-span-2">{{ detail.spec_name }}: {{ detail.spec_value }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">所属账号</span>
            <span class="col-span-2">{{ detail.cookie_remark || detail.cookie_id || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">创建时间</span>
            <span class="col-span-2">{{ formatTime(detail.created_at) }}</span>
          </div>
          <div v-if="detail.paid_at" class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">付款时间</span>
            <span class="col-span-2">{{ formatTime(detail.paid_at) }}</span>
          </div>
          <div v-if="detail.shipped_at" class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">发货时间</span>
            <span class="col-span-2">{{ formatTime(detail.shipped_at) }}</span>
          </div>
          <div v-if="detail.finished_at" class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">完成时间</span>
            <span class="col-span-2">{{ formatTime(detail.finished_at) }}</span>
          </div>
          <div v-if="detail.cancelled_at" class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">取消时间</span>
            <span class="col-span-2">{{ formatTime(detail.cancelled_at) }}</span>
          </div>
        </div>

        <!-- Receiver editor -->
        <div class="space-y-3">
          <h4 class="font-medium text-slate-900 dark:text-white">收货信息</h4>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">收货人</label>
              <input v-model="editForm.receiver_name" class="input" />
            </div>
            <div>
              <label class="label">手机号</label>
              <input v-model="editForm.receiver_phone" class="input" />
            </div>
          </div>
          <div>
            <label class="label">城市</label>
            <input v-model="editForm.receiver_city" class="input" />
          </div>
          <div>
            <label class="label">详细地址</label>
            <textarea v-model="editForm.receiver_address" rows="2" class="input"></textarea>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="detailOpen = false">关闭</button>
        <button class="btn-secondary" @click="manualShip(detail)" :disabled="saving">
          <Icon name="truck" /> 手动发货
        </button>
        <button class="btn-primary" :disabled="saving" @click="saveDetail">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          保存
        </button>
      </template>
    </DetailDrawer>

    <!-- Import modal -->
    <ModalBase v-model="importOpen" title="导入订单" size="lg">
      <div class="space-y-3">
        <p class="text-sm text-slate-500 dark:text-slate-400">
          粘贴订单 JSON 数组。支持字段：<code class="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700">order_id, item_id, buyer_id, amount, order_status, cookie_id, receiver_*</code>
        </p>
        <textarea v-model="importText" rows="12" class="input font-mono text-xs" placeholder='[{"order_id":"O-001","item_id":"I-1","amount":"29.9","order_status":"pending_ship","cookie_id":"acc-xxx","receiver_name":"张三","receiver_phone":"13800000000","receiver_address":"..."}]'></textarea>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="importOpen = false">取消</button>
        <button class="btn-primary" :disabled="importing" @click="doImport">
          <Icon name="upload" v-if="!importing" />
          <Icon name="refresh" v-else class="animate-spin" />
          确认导入
        </button>
      </template>
    </ModalBase>

    <!-- Batch delete confirmation with countdown -->
    <ModalBase :model-value="batchDeleteOpen" title="确认批量删除" size="sm" @update:model-value="cancelBatchDelete" @close="cancelBatchDelete">
      <div class="text-center py-2">
        <div class="w-14 h-14 mx-auto rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-500 mb-3 relative">
          <Icon name="alert" class="text-2xl" />
          <span v-if="batchDeleteCountdown > 0" class="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center">
            {{ batchDeleteCountdown }}
          </span>
        </div>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          即将删除 <span class="font-bold text-rose-600">{{ selectedIds.length }}</span> 条订单
        </p>
        <p class="text-xs text-slate-400 mt-1">此操作不可撤销，请谨慎确认</p>
        <div v-if="batchDeleteCountdown > 0" class="mt-3 text-xs text-amber-600 dark:text-amber-400">
          <Icon name="clock" class="inline mr-1" /> {{ batchDeleteCountdown }} 秒后可确认
        </div>
        <div v-else class="mt-3 text-xs text-emerald-600 dark:text-emerald-400">
          <Icon name="check" class="inline mr-1" /> 可以确认删除了
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="cancelBatchDelete">取消</button>
        <button class="btn-danger flex-1" :disabled="batchDeleteCountdown > 0 || batching === 'delete'" @click="confirmBatchDelete">
          <Icon v-if="batching === 'delete'" name="refresh" class="animate-spin" />
          <Icon v-else name="trash" /> 确认删除
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getOrders, updateOrder, deleteOrder, batchOrders, refreshOrder, refreshAllOrders, syncAllOrders, manualShip as manualShipApi, importOrders, exportOrders as exportOrdersApi, getOrderTrends, repairOrders, getHotTrends, syncHotTrends, backfillReceiver } from '~/api/orders'
import type { Order, OrderTrends, HotTrendItem } from '~/api/orders'
import { getAccounts } from '~/api/accounts'
import type { AccountLite } from '~/api/accounts'
import { exportCsv } from '~/api/export'

definePageMeta({ layout: 'default' })

const toast = useToast()

const statusOptions = [
  { value: 'all', label: '全部' },
  { value: 'pending_ship', label: '待发货' },
  { value: 'shipped', label: '已发货' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
  { value: 'refunding', label: '退款中' },
  { value: 'processing', label: '处理中' },
  { value: 'unknown', label: '其他' },
]

const loading = ref(false)
const saving = ref(false)
const syncing = ref(false)
const orders = ref<Order[]>([])
const accounts = ref<AccountLite[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

/* ==================== Tab 切换与闲鱼趋势 (v2.2.5) ==================== */

/** activeTab: mine = 我的订单 (已添加账号, 筛选+列表) / trend = 闲鱼趋势 (全账号趋势+全量订单列表) */
const activeTab = ref<'mine' | 'trend'>('mine')

function switchTab(tab: 'mine' | 'trend') {
  if (activeTab.value === tab) return
  activeTab.value = tab
  // 切入趋势 tab 时拉取趋势数据 + 全量订单分页列表 (每次切入都刷新, 保证徽标/列表/图表是最新的)
  if (tab === 'trend') {
    trendsLoaded = true
    loadTrends()
    loadOtherOrders()
    loadHotTrends()
  }
}

const trends = ref<OrderTrends>({ days: [], metrics: { totals: { all: 0, paid: 0, received: 0, refunded: 0 }, week: { all: 0, paid: 0, received: 0, refunded: 0, revenue: 0 } }, other_total: 0 })
const trendLoading = ref(false)
const trendOtherTotal = ref(0)
let trendsLoaded = false

const metricsOpen = ref(false)
const metricsTrendLoading = ref(false)

const trendWeek = computed(() => trends.value.metrics?.week || { all: 0, paid: 0, received: 0, refunded: 0, revenue: 0 })
const metricsTotals = computed(() => trends.value.metrics?.totals || { all: 0, paid: 0, received: 0, refunded: 0 })

/** 闲鱼趋势: 近7天全账号订单趋势 + 核心指标 (真实库内数据) */
async function loadTrends() {
  trendLoading.value = true
  metricsTrendLoading.value = true
  try {
    const r = await getOrderTrends()
    trends.value = r
    trendOtherTotal.value = Number(r.other_total) || 0
  } catch (e: any) {
    toast.error(e.message || '趋势数据加载失败')
  } finally {
    trendLoading.value = false
    metricsTrendLoading.value = false
  }
}

/* ---- 全量订单分页列表 (v2.2.7, scope=full): 全量同步拉取的所有状态订单 ∪ 非已添加账号历史订单 ---- */
const otherOrders = ref<Order[]>([])
const otherLoading = ref(false)
const otherPage = ref(1)
const otherPageSize = ref(20)
const otherTotalPages = computed(() => Math.max(1, Math.ceil(trendOtherTotal.value / otherPageSize.value)))

/** 页码列表 (与我的订单分页同款省略号折叠) */
const otherPageItems = computed<(number | string)[]>(() => {
  const tp = otherTotalPages.value
  const cur = otherPage.value
  if (tp <= 7) return Array.from({ length: tp }, (_, i) => i + 1)
  const picks = new Set<number>([1, tp, cur - 1, cur, cur + 1])
  const arr = [...picks].filter((p) => p >= 1 && p <= tp).sort((a, b) => a - b)
  const out: (number | string)[] = []
  let prev = 0
  for (const p of arr) {
    if (p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
})

async function loadOtherOrders() {
  otherLoading.value = true
  try {
    // (v2.2.7) scope=full: 全量订单口径 (同步拉取的所有状态订单 + 非已添加账号历史订单)
    const r = await getOrders({ scope: 'full', page: otherPage.value, pageSize: otherPageSize.value })
    otherOrders.value = r.data
    trendOtherTotal.value = r.total
  } catch (e: any) {
    toast.error(e.message || '全量订单加载失败')
  } finally {
    otherLoading.value = false
  }
}

function goOtherPage(p: number) {
  if (p < 1 || p > otherTotalPages.value) return
  otherPage.value = p
  loadOtherOrders()
}

/* ---- 全量订单同步 (v2.2.6, 闲鱼趋势 tab「同步订单」按钮) ---- */
const otherSyncing = ref(false)

/**
 * 全量订单同步 (v2.2.7): 调 /api/orders/sync-all —
 * 真实调用闲鱼卖家已售订单列表接口 (mtop.taobao.idle.trade.merchant.sold.get, queryCode=ALL,
 * 与 2.1.7 同源) 拉取所有状态订单列表入库 (纯列表同步, 无逐单详情精修; 详情精修在订单列表
 * 上单独请求), 商品名称/买家/卖家/商品单价/下单·付款·发货·收货·取消时间随单真实落库。
 * 计数与错误全部如实上报 (绝不虚报), 完成后刷新全量订单列表与趋势数据。
 */
async function syncTrendOrders() {
  otherSyncing.value = true
  try {
    const r = await syncAllOrders()
    const parts: string[] = []
    if (r.inserted) parts.push(`新拉取 ${r.inserted} 单`)
    if (r.updated) parts.push(`更新 ${r.updated} 单`)
    if (r.skipped_deleted) parts.push(`已删除屏蔽 ${r.skipped_deleted} 单`)
    const hardError = r.errors?.find((e) => !e.startsWith('已删除屏蔽'))
    if (hardError) {
      toast.error(`同步异常: ${hardError}`)
    } else if (!parts.length) {
      toast.info(r.errors?.length ? r.errors[0] : '暂无新订单')
    } else {
      toast.success(parts.join(', '))
    }
  } catch (e: any) {
    toast.error(e.message || '全量订单同步失败')
  } finally {
    otherSyncing.value = false
    loadOtherOrders()
    loadTrends()
  }
}

/* ---- 存量订单核验修复 (v2.3.0): 时间堆积回填 / 截断脏单清理 / 卖家身份回填 ---- */
const repairing = ref(false)

async function runRepair() {
  repairing.value = true
  try {
    const r = await repairOrders({ limit: 60 })
    const parts: string[] = []
    if (r.checked) parts.push(`核验 ${r.checked} 单`)
    if (r.time_fixed) parts.push(`回填下单时间 ${r.time_fixed}`)
    if (r.seller_fixed) parts.push(`回填卖家 ${r.seller_fixed}`)
    if (r.removed) parts.push(`清理截断脏单 ${r.removed}`)
    if (r.skipped_risk) parts.push(`风控跳过 ${r.skipped_risk}`)
    if (!r.checked) toast.info(r.errors?.[0] || '没有需要修复的存量订单')
    else toast.success(parts.join(', ') || '修复完成')
    if (r.errors?.length) console.log('[orders/repair] 明细:', r.errors)
  } catch (e: any) {
    toast.error(e.message || '存量订单修复失败')
  } finally {
    repairing.value = false
    loadOtherOrders()
    loadTrends()
  }
}

/* ---- 全平台热门商品趋势 (v2.3.0): 闲鱼站内搜索快照聚合 ---- */
/** 商品类型筛选选项: 默认虚拟商品 (标题特征词分类) */
const HOT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'virtual', label: '虚拟商品' },
  { value: 'physical', label: '实体商品' },
  { value: '', label: '全部' },
]
const hotItemType = ref<string>('virtual')
const hotKeyword = ref('')
const hotSyncing = ref(false)
const hotLoading = ref(false)
const hotItems = ref<HotTrendItem[]>([])
const hotStats = ref<{ total: number; sellers: number; min_price: number | null; max_price: number | null }>({
  total: 0,
  sellers: 0,
  min_price: null,
  max_price: null,
})
const hotKeywords = ref<{ keyword: string; c: number }[]>([])

async function loadHotTrends() {
  hotLoading.value = true
  try {
    const r = await getHotTrends({ keyword: hotKeyword.value.trim() || undefined, item_type: hotItemType.value || undefined, limit: 100, sort: 'want' })
    hotItems.value = r.items || []
    hotStats.value = r.stats || { total: 0, sellers: 0, min_price: null, max_price: null }
    hotKeywords.value = r.keywords || []
  } catch (e: any) {
    toast.error(e.message || '热门商品趋势加载失败')
  } finally {
    hotLoading.value = false
  }
}

async function runHotSync() {
  const kw = hotKeyword.value.trim()
  if (!kw) return
  hotSyncing.value = true
  try {
    const r = await syncHotTrends({ keyword: kw, pages: 3 })
    const parts: string[] = []
    if (r.synced) parts.push(`抓取 ${r.synced} 件在售商品`)
    if (r.new_items) parts.push(`新增 ${r.new_items}`)
    if (r.updated_items) parts.push(`更新 ${r.updated_items}`)
    const hardError = r.errors?.[0]
    if (hardError && !r.synced) toast.error(`搜索异常: ${hardError}`)
    else if (!parts.length) toast.info(r.errors?.[0] || '本次未抓到商品')
    else toast.success(parts.join(', '))
  } catch (e: any) {
    toast.error(e.message || '全平台搜索失败')
  } finally {
    hotSyncing.value = false
    loadHotTrends()
  }
}

// Batch operations
const selectedIds = ref<string[]>([])
const batching = ref<string | null>(null)
const allSelected = computed(() => orders.value.length > 0 && selectedIds.value.length === orders.value.length)
const someSelected = computed(() => selectedIds.value.length > 0 && selectedIds.value.length < orders.value.length)
function toggleAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  selectedIds.value = checked ? orders.value.map((o) => o.order_id) : []
}
// Batch delete confirmation with countdown
const batchDeleteOpen = ref(false)
const batchDeleteCountdown = ref(0)
let _countdownTimer: ReturnType<typeof setInterval> | null = null

async function batchAction(action: 'ship' | 'delete' | 'export') {
  if (!selectedIds.value.length) return
  if (action === 'delete') {
    // Open confirmation modal with 3s countdown (can't confirm until countdown ends)
    batchDeleteCountdown.value = 3
    batchDeleteOpen.value = true
    _countdownTimer = setInterval(() => {
      batchDeleteCountdown.value--
      if (batchDeleteCountdown.value <= 0) {
        if (_countdownTimer) clearInterval(_countdownTimer)
      }
    }, 1000)
    return
  }
  await doBatchAction(action)
}

async function confirmBatchDelete() {
  if (batchDeleteCountdown.value > 0) return
  batchDeleteOpen.value = false
  await doBatchAction('delete')
}

function cancelBatchDelete() {
  batchDeleteOpen.value = false
  if (_countdownTimer) clearInterval(_countdownTimer)
  batchDeleteCountdown.value = 0
}

async function doBatchAction(action: 'ship' | 'delete' | 'export') {
  if (!selectedIds.value.length) return
  batching.value = action
  try {
    const r = await batchOrders(selectedIds.value, action)
    if (action === 'export') {
      const blob = new Blob([JSON.stringify(r.orders || [], null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `orders_batch_${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${r.count} 条订单`)
    } else {
      toast.success(action === 'ship' ? `已批量发货 ${r.affected} 条` : `已批量删除 ${r.affected} 条`)
      selectedIds.value = []
      reload()
    }
  } catch (e: any) {
    toast.error(e.message || '批量操作失败')
  } finally {
    batching.value = null
  }
}

const filters = reactive({ status: 'all', cookie_id: '', keyword: '', dateFrom: '', dateTo: '', amountMin: '', amountMax: '' })
const showAdvanced = ref(false)
const hasActiveFilters = computed(() => !!(filters.dateFrom || filters.dateTo || filters.amountMin || filters.amountMax))
const activeFilterCount = computed(() => [filters.dateFrom, filters.dateTo, filters.amountMin, filters.amountMax].filter(Boolean).length)
function resetFilters() {
  filters.dateFrom = ''
  filters.dateTo = ''
  filters.amountMin = ''
  filters.amountMax = ''
  reload()
}

const detailOpen = ref(false)
const detail = ref<Order | null>(null)
const editForm = reactive<any>({})

const importOpen = ref(false)
const importText = ref('')
const importing = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

/** 页码列表 (省略号折叠: 始终含首尾页与当前页±1) */
const pageItems = computed<(number | string)[]>(() => {
  const tp = totalPages.value
  const cur = page.value
  if (tp <= 7) return Array.from({ length: tp }, (_, i) => i + 1)
  const picks = new Set<number>([1, tp, cur - 1, cur, cur + 1])
  const arr = [...picks].filter((p) => p >= 1 && p <= tp).sort((a, b) => a - b)
  const out: (number | string)[] = []
  let prev = 0
  for (const p of arr) {
    if (p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
})

async function reload() {
  loading.value = true
  try {
    const [ordersData, accountsData] = await Promise.all([
      getOrders({
        page: page.value,
        pageSize: pageSize.value,
        // v2.2.5 我的订单 tab: 只展示已添加账号的订单 (选账号则看该账号, 默认全部已添加账号)
        scope: 'mine',
        status: filters.status !== 'all' ? filters.status : undefined,
        cookie_id: filters.cookie_id || undefined,
        keyword: filters.keyword.trim() || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        amountMin: filters.amountMin || undefined,
        amountMax: filters.amountMax || undefined,
      }),
      getAccounts(),
    ])
    orders.value = ordersData.data
    total.value = ordersData.total
    accounts.value = accountsData
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function goPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  reload()
}

function openDetail(o: Order) {
  detail.value = o
  Object.assign(editForm, {
    order_status: o.order_status,
    amount: o.amount || '',
    receiver_name: o.receiver_name || '',
    receiver_phone: o.receiver_phone || '',
    receiver_address: o.receiver_address || '',
    receiver_city: o.receiver_city || '',
  })
  detailOpen.value = true
}

async function saveDetail() {
  if (!detail.value) return
  saving.value = true
  try {
    await updateOrder(detail.value.order_id, { ...editForm })
    toast.success('订单已更新')
    Object.assign(detail.value, editForm)
    detailOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

/** 单订单详情精修: 从闲鱼实查该订单并回写本地库 */
async function refreshOne(o: Order) {
  try {
    await refreshOrder(o.order_id)
    toast.success(`订单 ${o.order_id} 详情已精修回写`)
    reload()
  } catch (e: any) {
    toast.error(e.message || '详情精修失败')
  }
}

async function syncAll() {
  syncing.value = true
  try {
    // 获取最新的订单列表: 拉闲鱼卖家全部状态订单 (含待发货/已发货) 入库, 纯列表同步
    const r = await refreshAllOrders({ cookie_id: filters.cookie_id || undefined })
    const parts: string[] = []
    if (r.inserted) parts.push(`新拉取 ${r.inserted} 单`)
    if (r.updated) parts.push(`更新 ${r.updated} 单`)
    if (r.blocked) parts.push(`账号隔离拦截 ${r.blocked} 单`)
    if (r.skipped_deleted) parts.push(`已删除屏蔽 ${r.skipped_deleted} 单`)
    const hardError = r.errors?.find((e) => !e.startsWith('账号隔离') && !e.startsWith('已删除屏蔽'))
    if (hardError) {
      toast.error(`获取失败: ${hardError}`)
    } else if (!parts.length) {
      toast.info('暂无新订单')
    } else {
      toast.success(parts.join(', '))
    }
  } catch (e: any) {
    toast.error(e.message || '获取失败')
  } finally {
    syncing.value = false
    reload()
    // 趋势 tab 已加载过则同步刷新 (拉单后趋势/非已添加账号列表随之更新)
    if (trendsLoaded) {
      loadTrends()
      loadOtherOrders()
    }
  }
}

/* ---- 收货信息补全 (v2.3.5): 闲鱼列表接口 11-06 起不再返回 buyerInfoVO 收货字段 ---- */
const backfilling = ref(false)
async function runBackfillReceiver() {
  if (backfilling.value) return
  backfilling.value = true
  try {
    // 只补缺失收货人/手机号/地址的订单: 走订单详情接口 (与单条「详情精修」同源)
    // 定向补全, 每账号每轮最多 20 单, 每单最多 3 次尝试防死循环; 补不完再点一次
    const r = await backfillReceiver({ cookie_id: filters.cookie_id || undefined })
    const parts: string[] = []
    if (r.recovered) parts.push(`恢复 ${r.recovered} 单`)
    if (r.empty) parts.push(`${r.empty} 单平台未返回收货字段`)
    if (r.failed) parts.push(`${r.failed} 单查询失败`)
    if (r.remaining) parts.push(`仍缺 ${r.remaining} 单，可再点一次继续补`)
    if (!parts.length) toast.info('没有需要补全的订单 — 收货信息已齐全')
    else if (r.recovered > 0) toast.success(`补全完成: ${parts.join(', ')}`)
    else toast.info(`本轮未补到数据: ${parts.join(', ')}`)
  } catch (e: any) {
    toast.error(e.message || '补全失败')
  } finally {
    backfilling.value = false
    reload()
    if (trendsLoaded) loadOtherOrders()
  }
}

async function manualShip(o: Order | null) {
  if (!o) return
  try {
    await manualShipApi({ order_id: o.order_id, mode: 'status_only' })
    toast.success(`订单 ${o.order_id} 已标记为已发货`)
    if (detailOpen.value) detailOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '发货失败')
  }
}

async function deleteOne(o: Order) {
  if (!confirm(`确认删除订单「${o.order_id}」？`)) return
  try {
    await deleteOrder(o.order_id)
    toast.success('订单已删除')
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  }
}

function openImport() {
  importText.value = ''
  importOpen.value = true
}

async function doImport() {
  let arr: any[] = []
  try {
    arr = JSON.parse(importText.value)
    if (!Array.isArray(arr)) throw new Error('JSON 必须是数组')
  } catch (e: any) {
    toast.error('JSON 格式错误: ' + e.message)
    return
  }
  importing.value = true
  try {
    const r = await importOrders(arr)
    toast.success(`已导入 ${r.inserted} 条，更新 ${r.updated} 条`)
    importOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '导入失败')
  } finally {
    importing.value = false
  }
}

async function exportOrders() {
  try {
    const r = await exportOrdersApi()
    const blob = new Blob([JSON.stringify(r.orders, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orders-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${r.count} 个订单`)
  } catch (e: any) {
    toast.error(e.message || '导出失败')
  }
}

async function exportCSV() {
  try {
    const r = await exportOrdersApi()
    const headers = ['订单号', '商品ID', '买家', '金额', '状态', '规格', '收货人', '手机号', '地址', '城市', '创建时间']
    const rows = r.orders.map((o) => [
      o.order_id, o.item_id || '', o.buyer_id || '', o.amount || '', o.order_status || '',
      o.spec_value ? `${o.spec_name}:${o.spec_value}` : '',
      o.receiver_name || '', o.receiver_phone || '', o.receiver_address || '', o.receiver_city || '',
      o.created_at || '',
    ])
    // useApi 会自动加 basePath；csv 端点返回原始 CSV 字符串（无 success 信封），useApi 会原样透传
    const csv = await exportCsv({ filename: `orders-${Date.now()}.csv`, headers, rows })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orders-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${r.count} 条订单到 CSV`)
  } catch (e: any) {
    toast.error(e.message || 'CSV导出失败')
  }
}

// Read initial cookie_id filter from URL (e.g. linked from items page)
const route = useRoute()
onMounted(() => {
  const cid = route.query.cookie_id as string
  if (cid) filters.cookie_id = cid
  reload()
})
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
