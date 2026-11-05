<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="自动发货" description="买家付款成功后引擎自动发送卡券：规则关键词用于匹配商品标题/详情，延时在卡券上配置">
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
                <th>触发条件</th>
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
                  <template v-if="r.trigger_type === 'payment'">
                    <button class="inline-flex items-center gap-1 font-medium hover:opacity-80" @click="openEdit(r)">
                      <span class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                        <Icon name="coins" /> 付款自动发货
                      </span>
                    </button>
                    <p class="text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[200px]">{{ r.item_title || r.item_id }}</p>
                  </template>
                  <template v-else>
                    <button class="text-slate-800 dark:text-white font-medium hover:text-brand-600" @click="openEdit(r)">
                      <span class="font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60">{{ r.keyword }}</span>
                    </button>
                  </template>
                  <p v-if="r.description" class="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{{ r.description }}</p>
                  <div class="flex items-center gap-1 mt-1 flex-wrap">
                    <span v-if="r.trigger_type !== 'payment' && !r.require_paid" class="inline-block badge bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">未校验付款</span>
                    <span v-if="r.ship_mode === 'dummy_consign'" class="inline-block badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">无需邮寄</span>
                    <span v-else-if="r.ship_mode === 'none'" class="inline-block badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400">仅发消息</span>
                  </div>
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
                <td class="text-slate-500 dark:text-slate-400">{{ formatTimeFull(r.created_at) }}</td>
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

    <!-- 自动发货仿真测试 (v2.2.4) -->
    <div class="card p-4 sm:p-6 space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="flex items-center gap-2">
          <Icon name="play" class="text-brand-600 dark:text-brand-400" />
          <h3 class="font-semibold text-slate-900 dark:text-white">自动发货仿真测试</h3>
          <span class="badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">模拟 · 不真实发货</span>
        </div>
        <span v-if="simRunning" class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" /> 模拟流程进行中
        </span>
      </div>
      <div class="flex items-end gap-3 flex-wrap">
        <div class="min-w-[220px] flex-1 sm:max-w-[320px]">
          <label class="label">发货触发条件</label>
          <select v-model.number="simRuleId" class="input">
            <option :value="0" disabled>请选择已配置的触发条件</option>
            <option v-for="r in rules" :key="r.id" :value="r.id">
              {{ simRuleLabel(r) }}
            </option>
          </select>
        </div>
        <div class="min-w-[180px] flex-1 sm:max-w-[260px]">
          <label class="label">测试账号</label>
          <select v-model="simAccount" class="input">
            <option value="" disabled>请选择账号</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
        </div>
        <button class="btn-primary" :disabled="!simRuleId || !simAccount || simRunning" @click="startSimulate">
          <Icon name="play" v-if="!simRunning" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ simRunning ? '模拟中...' : '模拟自动发货' }}
        </button>
        <button v-if="simLines.length" class="btn-ghost" @click="clearSimTerminal">清空终端</button>
      </div>
      <p class="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
        按真实自动发货链路仿真跑通到已发货状态：待发货状态闸门 → 规则 → 卡券内容提取渲染 → 无需邮寄发货状态流转 → 已发货，
        除不真实调平台发货接口/不真实发送消息/不扣卡券库存/不计规则次数外完全仿真。测试日志与
        「回复决策日志」列表带棕色[测试]徽章的是同一份日志数据。
      </p>
      <div ref="simTermRef" class="rounded-lg bg-slate-900 border border-slate-800 p-3 font-mono text-xs leading-relaxed text-emerald-400 max-h-80 overflow-y-auto">
        <div v-if="!simLines.length" class="text-slate-500">等待启动模拟 — 选择触发条件与账号后点击「模拟自动发货」…</div>
        <div v-for="(line, i) in simLines" :key="i" class="whitespace-pre-wrap break-words">{{ line }}</div>
        <div v-if="simRunning" class="text-slate-500 animate-pulse">▍</div>
      </div>
    </div>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑规则' : '新增规则'" size="md">
      <div class="space-y-4">
        <div>
          <label class="label">触发方式 <span class="text-red-500">*</span></label>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="t in TRIGGER_OPTIONS"
              :key="t.value"
              type="button"
              class="rounded-lg border px-3 py-2 text-sm transition-colors"
              :class="form.trigger_type === t.value
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'"
              @click="form.trigger_type = t.value"
            >
              <Icon :name="t.icon" class="block mx-auto mb-1" />
              {{ t.label }}
            </button>
          </div>
        </div>
        <div v-if="form.trigger_type === 'keyword'">
          <label class="label">商品匹配关键词 <span class="text-red-500">*</span></label>
          <input v-model="form.keyword" class="input" placeholder="如 开卡 / 充值 (需能匹配到商品标题或详情)" />
          <p class="text-xs text-slate-400 mt-1">引擎用此关键词与商品标题+详情双向模糊匹配来挑选规则；实际发货由买家付款后的系统消息自动触发，同一商品命中多条规则会跳过发货</p>
        </div>
        <div v-else>
          <label class="label">绑定商品 <span class="text-red-500">*</span></label>
          <select v-model="form.item_id" class="input">
            <option value="" disabled>请选择商品</option>
            <option v-for="it in items" :key="it.id" :value="it.item_id">
              {{ it.item_id }} · {{ it.item_title || '无标题' }}
            </option>
          </select>
          <p v-if="!items.length" class="text-xs text-rose-500 mt-1">尚无商品，请先到「商品管理」同步</p>
          <p v-else class="text-xs text-slate-400 mt-1">买家支付该商品成功后自动发货（引擎检测到付款事件后执行，无需买家发关键词）</p>
        </div>
        <div>
          <label class="label">关联卡券 <span class="text-red-500">*</span></label>
          <select v-model.number="form.card_id" class="input">
            <option :value="0" disabled>请选择卡券</option>
            <option v-for="c in cards" :key="c.id" :value="c.id">
              {{ c.name }} ({{ cardTypeLabel(c.type) }})
            </option>
          </select>
          <p v-if="!cards.length" class="text-xs text-rose-500 mt-1">尚无卡券，请先到「卡券管理」创建</p>
        </div>
        <div>
          <label class="label">发货数量</label>
          <input v-model.number="form.delivery_count" type="number" min="1" class="input" />
          <p class="mt-1 text-slate-400">每次触发发货的份数</p>
        </div>
        <div>
          <label class="label">发货方式</label>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="s in SHIP_MODE_OPTIONS"
              :key="s.value"
              type="button"
              class="rounded-lg border px-2 py-2 transition-colors"
              :class="form.ship_mode === s.value
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'"
              @click="form.ship_mode = s.value"
            >
              {{ s.label }}
            </button>
          </div>
          <p class="mt-1 text-slate-400">无需邮寄 = 调用闲鱼官方无需邮寄确认发货接口，订单在平台侧变为已发货；发货内容（卡密/验证码等文本）随发货接口作为「发货凭证」提交，买家在闲鱼订单的发货信息中查看，不再以聊天消息发送（避免站外引流类风控）；图片卡券内容仍以聊天消息发送。仅发消息 = 只发卡券不调平台接口；跟随账号 = 沿用「账号管理」里的自动确认开关。是否附消息由卡券的「消息回复」配置决定</p>
        </div>
        <div>
          <label class="label">描述</label>
          <input v-model="form.description" class="input" placeholder="可选" />
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.enabled" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
          <span class="text-sm text-slate-700 dark:text-slate-200">启用规则</span>
        </label>
        <label v-if="form.trigger_type === 'keyword'" class="flex items-start gap-2 cursor-pointer">
          <input v-model="form.require_paid" type="checkbox" class="w-4 h-4 mt-0.5 rounded text-brand-600 focus:ring-brand-500" />
          <span class="text-sm text-slate-700 dark:text-slate-200">
            仅已付款买家自动发货
            <span class="block text-xs text-slate-400 mt-0.5">主流引擎发货由付款系统消息触发，天然仅已付款生效；此为预留校验开关，兼容新引擎契约防卡密泄露 (推荐开启)</span>
          </span>
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
import { getDeliveryRules, createDeliveryRule, updateDeliveryRule, deleteDeliveryRule, simulateDeliveryRule } from '~/api/delivery'
import type { DeliveryRule } from '~/api/delivery'
import { getCards } from '~/api/cards'
import type { CardLite } from '~/api/cards'
import { getItems } from '~/api/items'
import type { Item } from '~/api/items'
import { getAccounts, type AccountLite } from '~/api/accounts'
import { getReplyLogs, type ReplyLog } from '~/api/reply-logs'

definePageMeta({ layout: 'default' })

const toast = useToast()

const TRIGGER_OPTIONS = [
  { value: 'keyword', label: '消息关键词触发', icon: 'message' },
  { value: 'payment', label: '付款成功自动发货', icon: 'coins' },
]

const SHIP_MODE_OPTIONS = [
  { value: 'dummy_consign', label: '无需邮寄' },
  { value: 'none', label: '仅发消息' },
  { value: '', label: '跟随账号' },
]

function cardTypeLabel(t: string): string {
  return (({ api: 'API', text: '文本', code: '卡密', data: '数据', image: '图片' }) as Record<string, string>)[t] || t
}

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const rules = ref<DeliveryRule[]>([])
const cards = ref<CardLite[]>([])
const items = ref<Item[]>([])
const modalOpen = ref(false)
const editing = ref(false)
const deleteTarget = ref<DeliveryRule | null>(null)

/* ---------------- 自动发货仿真测试 (v2.2.4) ---------------- */
const accounts = ref<AccountLite[]>([])
const simRuleId = ref(0)
const simAccount = ref('')
const simRunning = ref(false)
const simLines = ref<string[]>([])
const simLastId = ref(0)
const simEndTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const simTermRef = ref<HTMLElement | null>(null)
let simTimer: ReturnType<typeof setInterval> | null = null

function simRuleLabel(r: DeliveryRule): string {
  if (r.trigger_type === 'payment') {
    return `# ${r.id} · 付款自动发货 · ${r.item_title || r.item_id}`
  }
  return `# ${r.id} · 关键词「${r.keyword}」`
}

function simLogLine(l: ReplyLog): string {
  const t = (l.created_at || '').replace('T', ' ').slice(5, 19)
  const status = l.process_status === 'success' ? '✓' : '✗'
  const reason = l.decision_reason || l.reply_strategy || '-'
  const text = (l.error_message || l.reply_text || '').replace(/\s+/g, ' ').slice(0, 180)
  return `[${t}] ${status} ${reason} | ${l.source_message || '-'} | ${text}`
}

function stopSimPolling() {
  if (simTimer) clearInterval(simTimer)
  simTimer = null
}

function clearSimTerminal() {
  simLines.value = []
  simLastId.value = 0
}

function appendSimLine(line: string) {
  simLines.value.push(line)
  if (simLines.value.length > 300) simLines.value.splice(0, simLines.value.length - 300)
  nextTick(() => {
    const el = simTermRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

/** 终端判定流程结束: 出现发货终态决策日志 (成功/失败/已发货跳过) 后, 再拉一轮确认无增量即收尾 */
function markSimMaybeDone(reason: string) {
  if (!simRunning.value) return
  if (simEndTimer.value) clearTimeout(simEndTimer.value)
  simEndTimer.value = setTimeout(() => {
    simRunning.value = false
    appendSimLine(`[结束] 模拟流程完成 (${reason}) — 完整链路日志可在「回复决策日志」查看 (棕色[测试]徽章)`)
    if (simTimer) clearInterval(simTimer)
    simTimer = null
  }, 2500)
}

async function startSimulate() {
  if (!simRuleId.value || !simAccount.value) return
  clearSimTerminal()
  simRunning.value = true
  appendSimLine(`[启动] 规则 #${simRuleId.value} · 账号 ${simAccount.value} — 模拟买家付款, 触发「[我已付款，等待你发货]」真实链路…`)
  try {
    await simulateDeliveryRule({ rule_id: simRuleId.value, account: simAccount.value })
    stopSimPolling()
    simTimer = setInterval(async () => {
      try {
        const res = await getReplyLogs({ test: true, since_id: simLastId.value, limit: 50 })
        const fresh = res.logs.slice().reverse() // id 升序展示
        for (const l of fresh) {
          appendSimLine(simLogLine(l))
          if (l.id > simLastId.value) simLastId.value = l.id
          if (['auto_delivered', 'delivery_failed', 'already_shipped'].includes(l.decision_reason)) {
            markSimMaybeDone(l.decision_reason === 'auto_delivered' ? '已发货状态达成' : l.decision_reason === 'already_shipped' ? '已发货跳过' : '发货链路终止')
          }
        }
      } catch {
        /* 轮询失败静默, 下一轮重试 */
      }
    }, 1200)
  } catch (e: any) {
    simRunning.value = false
    appendSimLine(`[错误] ${e?.message || '启动模拟失败'}`)
    toast.error(e?.message || '启动模拟失败')
  }
}

onBeforeUnmount(() => {
  stopSimPolling()
  if (simEndTimer.value) clearTimeout(simEndTimer.value)
})

const form = ref<any>({
  id: null,
  trigger_type: 'keyword',
  keyword: '',
  item_id: '',
  card_id: 0,
  delivery_count: 1,
  description: '',
  enabled: true,
  require_paid: true,
  ship_mode: 'dummy_consign',
})

async function reload() {
  loading.value = true
  try {
    const [rulesData, cardsData, itemsData, accountsData] = await Promise.all([
      getDeliveryRules(),
      getCards(),
      getItems(),
      getAccounts().catch(() => [] as AccountLite[]),
    ])
    rules.value = rulesData
    cards.value = cardsData
    items.value = itemsData
    accounts.value = accountsData
    if (!simAccount.value && accountsData.length) simAccount.value = accountsData[0].id
    if (!simRuleId.value && rulesData.length) simRuleId.value = rulesData[0].id
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  form.value = { id: null, trigger_type: 'keyword', keyword: '', item_id: '', card_id: cards.value[0]?.id || 0, delivery_count: 1, description: '', enabled: true, require_paid: true, ship_mode: 'dummy_consign' }
  modalOpen.value = true
}

function openEdit(r: DeliveryRule) {
  editing.value = true
  form.value = {
    id: r.id,
    trigger_type: r.trigger_type === 'payment' ? 'payment' : 'keyword',
    keyword: r.keyword,
    item_id: r.item_id || '',
    card_id: r.card_id,
    delivery_count: r.delivery_count,
    description: r.description || '',
    enabled: !!r.enabled,
    require_paid: r.require_paid === undefined || r.require_paid === null ? true : !!r.require_paid,
    ship_mode: r.ship_mode === 'dummy_consign' || r.ship_mode === 'none' ? r.ship_mode : '',
  }
  modalOpen.value = true
}

async function saveRule() {
  if (!form.value.card_id) { toast.error('请选择关联卡券'); return }
  if (form.value.trigger_type === 'payment' && !form.value.item_id) { toast.error('请选择绑定商品'); return }
  if (form.value.trigger_type !== 'payment' && !form.value.keyword.trim()) { toast.error('请填写关键词'); return }
  saving.value = true
  try {
    const payload: any = {
      trigger_type: form.value.trigger_type,
      card_id: form.value.card_id,
      delivery_count: Number(form.value.delivery_count) || 1,
      description: form.value.description,
      enabled: form.value.enabled,
      ship_mode: form.value.ship_mode,
    }
    if (form.value.trigger_type === 'payment') {
      payload.item_id = form.value.item_id
      payload.require_paid = true
    } else {
      payload.keyword = form.value.keyword
      payload.require_paid = !!form.value.require_paid
    }
    if (editing.value) {
      await updateDeliveryRule(form.value.id, payload)
      toast.success('规则已更新')
    } else {
      await createDeliveryRule(payload)
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
    await updateDeliveryRule(r.id, { enabled: !r.enabled })
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
    await deleteDeliveryRule(deleteTarget.value.id)
    toast.success('规则已删除')
    deleteTarget.value = null
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
