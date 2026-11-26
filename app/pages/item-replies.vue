<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="指定商品回复" description="买家咨询该商品且未命中关键词/AI 时的专属话术，优先级高于默认回复（无需命中关键词）">
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
                <th>AI</th>
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
                <td>
                  <span
                    v-if="r.ai_enabled"
                    class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                    :title="r.ai_config_name ? `引用配置: ${r.ai_config_name}` : ''"
                  >
                    <Icon name="sparkles" /> {{ r.ai_config_name || '已启用' }}
                  </span>
                  <span v-else class="text-slate-400">跟随账号</span>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(r.updated_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" :class="r.ai_enabled ? 'text-brand-600' : ''" title="AI 配置" @click="openAiConfig(r)">
                      <Icon name="sparkles" />
                    </button>
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

    <!-- AI config modal (商品级) -->
    <ModalBase v-model="aiModalOpen" title="商品级 AI 配置" size="md">
      <div v-if="aiForm" class="space-y-4">
        <div class="rounded-lg bg-brand-50 dark:bg-brand-900/20 p-3 text-brand-700 dark:text-brand-300">
          为商品「{{ aiTarget?.item_title || aiTarget?.item_id }}」单独配置 AI：买家咨询该商品时优先用本配置 (提示词/模型/议价均可与账号级不同)。优先级：关键词回复 > 商品级 AI > 账号级 AI > 指定商品回复 > 默认回复。
        </div>
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="aiForm.ai_enabled" type="checkbox" class="w-4 h-4 mt-0.5 rounded text-brand-600 focus:ring-brand-500" />
          <span>
            启用该商品专属 AI 回复
            <span class="block mt-0.5 text-slate-400">关闭后该商品回退账号级 AI 配置</span>
          </span>
        </label>
        <div>
          <label class="label">AI 接入配置</label>
          <div class="flex items-center gap-2">
            <div class="flex-1">
              <AiConfigSelect v-model="aiForm.ai_config_id" placeholder="留空跟随账号级 AI 配置" />
            </div>
            <button
              v-if="Number(aiForm.ai_config_id) > 0"
              class="btn-ghost !px-2 !py-1 shrink-0 text-slate-400"
              title="清除选择, 恢复跟随账号级配置"
              @click="aiForm.ai_config_id = 0"
            >
              <Icon name="x" />
            </button>
          </div>
          <p class="mt-1 text-slate-400">
            模型 / API Key / 地址统一在管理员「AI配置」页维护, 此处直接引用; 配置一处修改全局生效。
            {{ accountConfigId ? `留空时默认使用账号级配置 (当前账号级引用 #${accountConfigId})` : '当前账号级未引用配置, 留空则该商品 AI 不生效' }}
          </p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="label">最大折扣 (%)</label>
            <input v-model.number="aiForm.max_discount_percent" type="number" min="0" max="100" class="input" />
          </div>
          <div>
            <label class="label">最大优惠 (元)</label>
            <input v-model.number="aiForm.max_discount_amount" type="number" min="0" class="input" />
          </div>
          <div>
            <label class="label">最大议价轮次</label>
            <input v-model.number="aiForm.max_bargain_rounds" type="number" min="0" class="input" />
          </div>
        </div>
        <!-- v2.4.0: 知识库按商品分组 — 直接使用该商品所属分组, 同一商品允许加入多个分组 -->
        <div class="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div class="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <p class="text-sm font-medium text-slate-700 dark:text-slate-200">知识库分组 (按商品)</p>
          </div>
          <div class="p-3 space-y-2">
            <p class="text-xs text-slate-400">勾选该商品所属分组 (可多选): AI 回复时自动读取所属分组内全部商品 (跨账号) 的买家「客户」/卖家「卖家」真实消息作上下文, 自动排除自动发货回复与系统消息。分组在「AI 知识库」页管理。</p>
            <div v-if="kbGroups.length" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label
                v-for="g in kbGroups"
                :key="g.id"
                class="flex items-center gap-2 cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <input
                  v-model="aiGroupIds"
                  type="checkbox"
                  :value="g.id"
                  class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500"
                />
                <span class="text-sm text-slate-700 dark:text-slate-200 truncate">{{ g.name }}</span>
              </label>
            </div>
            <p v-else class="text-sm text-slate-400">暂无分组, 请先到「AI 知识库」页创建商品分组</p>
          </div>
        </div>
        <div>
          <label class="label">商品专属提示词</label>
          <textarea v-model="aiForm.custom_prompts" rows="5" class="input" placeholder="该商品的回复风格 / 商品说明 / 禁语等 (留空则用默认提示词)"></textarea>
          <p class="mt-1 text-slate-400">仅对本商品生效；支持 JSON 按意图配置：{"price":"议价提示词","tech":"技术提示词","default":"通用提示词"}</p>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="aiModalOpen = false">取消</button>
        <button class="btn-primary" :disabled="aiSaving" @click="saveAiConfig">
          <Icon name="save" v-if="!aiSaving" />
          <Icon name="refresh" v-else class="animate-spin" />
          保存
        </button>
      </template>
    </ModalBase>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑回复' : '新增回复'" size="md">
      <div class="space-y-4">
        <div>
          <label class="label">所属账号 <span class="text-red-500">*</span></label>
          <select v-model="form.cookie_id" class="input" :disabled="editing" @change="onFormAccountChange">
            <option value="" disabled>请选择账号</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
        </div>
        <div>
          <label class="label">商品 <span class="text-red-500">*</span></label>
          <select v-model="form.item_id" class="input" :disabled="editing" :class="editing ? 'opacity-60' : ''">
            <option value="" disabled>
              {{ form.cookie_id ? (itemsForAccount.length ? '请选择商品' : '该账号暂无商品, 请先同步商品') : '请先选择账号' }}
            </option>
            <option v-for="i in itemsForAccount" :key="i.item_id" :value="i.item_id">
              {{ i.item_id }} · {{ i.item_title || '无标题' }}
            </option>
          </select>
          <p v-if="!editing && form.cookie_id && itemsForAccount.length" class="text-xs text-slate-400 mt-1">
            从商品管理列表选择, 共 {{ itemsForAccount.length }} 个可选
          </p>
        </div>
        <div>
          <label class="label">回复内容 <span class="text-red-500">*</span></label>
          <textarea v-model="form.reply_content" rows="5" class="input" placeholder="该商品的专属自动回复内容"></textarea>
          <p class="text-xs text-slate-400 mt-1">支持多行文本；可用变量: {send_user_name} 买家昵称、{send_user_id} 买家ID、{send_message} 消息内容、{item_id} 商品ID</p>
        </div>
        <div>
          <label class="label">延迟回复 (秒)</label>
          <input v-model.number="form.delay_seconds" type="number" min="0" max="300" class="input" placeholder="10" />
          <p class="text-xs text-slate-400 mt-1">命中后延迟指定秒数再发送 (0 = 立即发送)，默认 10 秒；延迟期间您手动回复则立即取消本次自动回复</p>
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
import { getItemReplies, upsertItemReply, deleteItemReply } from '~/api/item-replies'
import type { ItemReply } from '~/api/item-replies'
import { getAccounts } from '~/api/accounts'
import type { AccountLite } from '~/api/accounts'
import { getItems } from '~/api/items'
import type { Item } from '~/api/items'
import { getItemAiSettings, saveItemAiSettings } from '~/api/item-ai-settings'
import { getAiSettings } from '~/api/ai-settings'
import { getKbData, getItemKbGroups, toggleKbGroupItem } from '~/api/kb'
import type { KbGroup } from '~/api/kb'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const replies = ref<ItemReply[]>([])
const accounts = ref<AccountLite[]>([])
const items = ref<Item[]>([])
const filterCookieId = ref('')
const keyword = ref('')

const modalOpen = ref(false)
const editing = ref(false)
const form = ref<any>({ cookie_id: '', item_id: '', reply_content: '', delay_seconds: 10 })

const aiModalOpen = ref(false)
const aiSaving = ref(false)
const aiTarget = ref<ItemReply | null>(null)
const aiForm = ref<any>(null)
/** 账号级 AI 配置引用 (商品级留空时的默认值) */
const accountConfigId = ref(0)
/** 知识库分组 (按商品): 全量分组 + 该商品当前勾选的分组 ID */
const kbGroups = ref<KbGroup[]>([])
const aiGroupIds = ref<number[]>([])
/** 打开弹窗时的分组勾选快照, 保存时算差集增量同步 */
const aiGroupIdsSnapshot = ref<number[]>([])

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

/** 当前所选账号下的可选商品 (弹窗内下拉数据源, 显示商品 ID + 标题) */
const itemsForAccount = computed(() =>
  items.value.filter((i) => i.cookie_id === form.value.cookie_id),
)

/** 弹窗内切换账号时, 已选商品不属于新账号则清空 */
function onFormAccountChange() {
  if (form.value.item_id && !itemsForAccount.value.some((i) => i.item_id === form.value.item_id)) {
    form.value.item_id = ''
  }
}

async function reload() {
  loading.value = true
  try {
    const [repliesData, accountsData, itemsData] = await Promise.all([
      getItemReplies(),
      getAccounts(),
      getItems().catch(() => [] as Item[]),
    ])
    replies.value = repliesData
    accounts.value = accountsData
    items.value = itemsData
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  form.value = { cookie_id: filterCookieId.value || '', item_id: '', reply_content: '', delay_seconds: 10 }
  modalOpen.value = true
}

function openEdit(r: ItemReply) {
  editing.value = true
  form.value = { cookie_id: r.cookie_id, item_id: r.item_id, reply_content: r.reply_content, delay_seconds: r.delay_seconds ?? 10 }
  modalOpen.value = true
}

async function openAiConfig(r: ItemReply) {
  aiTarget.value = r
  aiForm.value = null
  aiGroupIds.value = []
  aiGroupIdsSnapshot.value = []
  aiModalOpen.value = true
  try {
    const [conf, accountConf, kbData, itemGroups] = await Promise.all([
      getItemAiSettings(r.cookie_id, r.item_id),
      getAiSettings(r.cookie_id).catch(() => null),
      getKbData().catch(() => ({ groups: [] as KbGroup[], members: [] })),
      getItemKbGroups(r.cookie_id, r.item_id).catch(() => ({ groups: [] as { id: number; name: string }[] })),
    ])
    accountConfigId.value = Number(accountConf?.ai_config_id) || 0
    kbGroups.value = kbData.groups
    aiGroupIds.value = itemGroups.groups.map((g) => g.id)
    aiGroupIdsSnapshot.value = [...aiGroupIds.value]
    aiForm.value = {
      ai_enabled: !!Number(conf.ai_enabled),
      // v2.4.0 默认值: 商品级未引用时预填账号级引用配置 (留空=跟随账号级, 运行时回退)
      ai_config_id: Number(conf.ai_config_id) || accountConfigId.value || 0,
      max_discount_percent: conf.max_discount_percent ?? 10,
      max_discount_amount: conf.max_discount_amount ?? 100,
      max_bargain_rounds: conf.max_bargain_rounds ?? 3,
      custom_prompts: conf.custom_prompts || '',
    }
  } catch (e: any) {
    toast.error(e.message || 'AI 配置加载失败')
    aiModalOpen.value = false
  }
}

/** 分组勾选差集增量同步 (v2.4.0): 新勾选的加入分组, 取消勾选的移出分组 */
async function syncItemGroups() {
  const t = aiTarget.value
  if (!t) return
  const before = new Set(aiGroupIdsSnapshot.value)
  const after = new Set(aiGroupIds.value)
  const toAdd = [...after].filter((id) => !before.has(id))
  const toRemove = [...before].filter((id) => !after.has(id))
  for (const groupId of toAdd) {
    await toggleKbGroupItem(groupId, t.cookie_id, t.item_id, 'add')
  }
  for (const groupId of toRemove) {
    await toggleKbGroupItem(groupId, t.cookie_id, t.item_id, 'remove')
  }
}

async function saveAiConfig() {
  const t = aiTarget.value
  if (!t || !aiForm.value) return
  aiSaving.value = true
  try {
    await saveItemAiSettings({
      cookie_id: t.cookie_id,
      item_id: t.item_id,
      ai_enabled: aiForm.value.ai_enabled,
      ai_config_id: Number(aiForm.value.ai_config_id) || 0,
      max_discount_percent: Number(aiForm.value.max_discount_percent) || 0,
      max_discount_amount: Number(aiForm.value.max_discount_amount) || 0,
      max_bargain_rounds: Number(aiForm.value.max_bargain_rounds) || 0,
      custom_prompts: aiForm.value.custom_prompts || '',
    })
    await syncItemGroups()
    toast.success('商品 AI 配置已保存')
    aiModalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    aiSaving.value = false
  }
}

async function save() {
  if (!form.value.cookie_id) {
    toast.error('请选择账号')
    return
  }
  if (!form.value.item_id) {
    toast.error('请选择商品')
    return
  }
  if (!form.value.reply_content.trim()) {
    toast.error('回复内容不能为空')
    return
  }
  saving.value = true
  try {
    await upsertItemReply(
      form.value.cookie_id,
      form.value.item_id,
      { reply_content: form.value.reply_content, delay_seconds: Math.max(Number(form.value.delay_seconds) || 0, 0) },
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
    await deleteItemReply(r.cookie_id, r.item_id)
    toast.success('回复已删除')
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  }
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
