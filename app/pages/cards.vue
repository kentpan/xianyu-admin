<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="卡券管理" description="维护 API / 文本 / 卡密 / 图片 卡券；卡密型发货时按配置生成随机码并留档">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 新增卡券
        </button>
      </template>
    </PageHeader>

    <!-- Search -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[240px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input v-model="keyword" class="input pl-9" placeholder="搜索卡券名称 / 描述" />
        </div>
        <div class="flex items-center gap-2">
          <button
            v-for="t in TYPE_OPTIONS"
            :key="t.value"
            class="badge cursor-pointer transition-colors"
            :class="filterType === t.value ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
            @click="filterType = filterType === t.value ? '' : t.value"
          >
            {{ t.label }}
          </button>
        </div>
        <p class="text-xs text-slate-400">共 {{ filtered.length }} 张</p>
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
                <th>名称</th>
                <th>类型</th>
                <th>多规格</th>
                <th>对接</th>
                <th>延时</th>
                <th>状态</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in filtered" :key="c.id">
                <td>
                  <button class="text-slate-800 dark:text-white font-medium hover:text-brand-600" @click="openEdit(c)">
                    {{ c.name }}
                  </button>
                  <p v-if="c.description" class="text-xs text-slate-400 mt-0.5 truncate max-w-[240px]">{{ c.description }}</p>
                </td>
                <td>
                  <span class="badge" :class="typeMeta(c.type).cls">
                    <Icon :name="typeMeta(c.type).icon" /> {{ typeMeta(c.type).label }}
                  </span>
                </td>
                <td>
                  <template v-if="c.is_multi_spec">
                    <span class="text-xs text-slate-500 dark:text-slate-400">
                      {{ c.spec_name || '规格' }}: {{ c.spec_value || '—' }}
                    </span>
                  </template>
                  <span v-else class="text-slate-400">—</span>
                </td>
                <td>
                  <template v-if="c.is_dockable">
                    <span class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                      <Icon name="link" /> 可对接
                    </span>
                    <p class="text-xs text-slate-400 mt-0.5 tabular-nums">¥{{ c.price || '0.00' }}</p>
                  </template>
                  <span v-else class="text-xs text-slate-400">未开放</span>
                </td>
                <td>{{ c.delay_seconds || 0 }}s</td>
                <td>
                  <button
                    class="badge transition-colors"
                    :class="c.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
                    @click="toggleEnabled(c)"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :class="c.enabled ? 'bg-emerald-500' : 'bg-slate-400'" />
                    {{ c.enabled ? '启用' : '停用' }}
                  </button>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(c.created_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(c)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="confirmDelete(c)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!filtered.length" message="还没有卡券，点击右上角「新增卡券」开始" icon="cards" />
      </template>
    </div>

    <!-- 卡密生成记录 -->
    <div class="card overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
        <h3 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Icon name="key" class="text-brand-500" /> 卡密生成记录
          <span class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300">共 {{ codeLogTotal }} 条</span>
        </h3>
        <div class="flex items-center gap-2 flex-wrap">
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
            <input v-model="codeLogKeyword" class="input pl-9 !w-64" placeholder="卡密 / 订单号 / 买家 / 商品 / 卡券" @keyup.enter="resetCodeLogsAndReload" />
          </div>
          <button class="btn-secondary !px-2.5 !py-1.5" :disabled="codeLogsLoading" @click="reloadCodeLogs">
            <Icon name="refresh" :class="codeLogsLoading ? 'animate-spin' : ''" />
          </button>
        </div>
      </div>
      <div v-if="codeLogsLoading" class="p-8 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <div class="table-wrap max-h-96 overflow-y-auto">
          <table class="table">
            <thead>
              <tr>
                <th>生成时间</th>
                <th>卡密</th>
                <th>状态</th>
                <th>卡券</th>
                <th>账号</th>
                <th>商品</th>
                <th>订单号</th>
                <th>买家</th>
                <th>核销时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in codeLogs" :key="l.id">
                <td class="text-slate-500 whitespace-nowrap">{{ formatTime(l.created_at) }}</td>
                <td>
                  <span class="font-mono font-semibold tracking-wider text-slate-800 dark:text-white">{{ l.code }}</span>
                </td>
                <td>
                  <span class="badge" :class="l.status === 'used' ? 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'">
                    {{ l.status === 'used' ? '已核销' : '未核销' }}
                  </span>
                </td>
                <td class="text-slate-500">{{ l.card_name || '—' }}</td>
                <td class="font-mono text-slate-500 max-w-[140px]"><p class="truncate" :title="l.cookie_id">{{ l.cookie_id || '—' }}</p></td>
                <td class="font-mono text-slate-500 max-w-[140px]"><p class="truncate" :title="l.item_id">{{ l.item_id || '—' }}</p></td>
                <td class="font-mono text-slate-500 max-w-[160px]"><p class="truncate" :title="l.order_id">{{ l.order_id || '—' }}</p></td>
                <td class="font-mono text-slate-500">{{ l.buyer_id || '—' }}</td>
                <td class="text-slate-500 whitespace-nowrap">{{ formatTime(l.used_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="复制卡密" @click="copyCodeLog(l.code)">
                      <Icon name="copy" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!codeLogs.length" message="暂无卡密生成记录；卡密型卡券发货时自动生成并留档" icon="key" />
        <div v-if="codeLogTotal > codeLogPageSize" class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
          <p class="text-slate-500">共 {{ codeLogTotal }} 条，第 {{ codeLogPage }} / {{ codeLogTotalPages }} 页</p>
          <div class="flex items-center gap-1">
            <button class="btn-secondary !px-2.5 !py-1.5" :disabled="codeLogPage <= 1" @click="goCodeLogPage(codeLogPage - 1)">
              <Icon name="chevronRight" class="rotate-180" />
            </button>
            <button class="btn-secondary !px-2.5 !py-1.5" :disabled="codeLogPage >= codeLogTotalPages" @click="goCodeLogPage(codeLogPage + 1)">
              <Icon name="chevronRight" />
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑卡券' : '新增卡券'" size="lg">
      <div class="space-y-4">
        <div>
          <label class="label">名称 <span class="text-red-500">*</span></label>
          <input v-model="form.name" class="input" placeholder="如 30元话费卡" />
        </div>
        <div>
          <label class="label">类型 <span class="text-red-500">*</span></label>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="t in TYPE_OPTIONS"
              :key="t.value"
              type="button"
              class="rounded-lg border px-3 py-2 text-sm transition-colors"
              :class="form.type === t.value
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'"
              @click="form.type = t.value"
            >
              <Icon :name="t.icon" class="block mx-auto mb-1" />
              {{ t.label }}
            </button>
          </div>
        </div>

        <!-- Type-specific content -->
        <div v-if="form.type === 'api'">
          <label class="label">API 配置 (JSON)</label>
          <textarea v-model="form.api_config" rows="6" class="input font-mono text-xs" placeholder='{"url":"https://...","method":"POST","headers":{}}'></textarea>
          <p class="text-slate-400 mt-1">发货时请求外部接口，data_path 指定从响应 JSON 提取发货文本的字段路径（如 data.url 取加密提取页链接）</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button" class="btn-secondary !py-1.5 !px-3" @click="fillCardsHubTemplate">填入 cards-hub 加密 URL 发货模板</button>
            <button type="button" class="btn-ghost !py-1.5 !px-3" @click="testApiConfig">测试请求</button>
            <span v-if="apiTestResult" class="self-center text-slate-500 break-all">{{ apiTestResult }}</span>
          </div>
          <div class="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <p class="text-slate-600 dark:text-slate-300 font-medium">对接 cloudflare-cards-hub（资源交付系统）</p>
            <p class="text-slate-500 mt-1">填入模板后改 3 处：① url 换成你的 cards-hub 域名 ② Authorization 换成「APIKEY 管理」里的 ak- 开头密钥 ③ body.script_id 换成资源管理里的资源 ID。发货时自动调 /api/issue 生成一单一密的加密提取页链接发给买家，买家打开即自动核销下载（全程看不到真实文件路径）。</p>
          </div>
        </div>
        <div v-else-if="form.type === 'text'">
          <label class="label">文本内容</label>
          <textarea v-model="form.text_content" rows="4" class="input" placeholder="直接回复的文本内容" />
        </div>
        <div v-else-if="form.type === 'code'" class="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="label">卡密长度</label>
              <input v-model.number="form.code_length" type="number" min="4" max="32" class="input" />
              <p class="text-xs text-slate-400 mt-1">生成的卡密字符数，默认 6 (4-32)</p>
            </div>
            <div>
              <label class="label">字符构成</label>
              <div class="flex items-center gap-4 h-[38px]">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="form.code_letters" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
                  <span class="text-slate-700 dark:text-slate-200">英文</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="form.code_digits" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
                  <span class="text-slate-700 dark:text-slate-200">数字</span>
                </label>
              </div>
              <p class="text-xs text-slate-400 mt-1">默认英文+数字都勾选，至少保留一项</p>
            </div>
          </div>
          <div v-if="form.code_letters">
            <label class="label">英文字母大小写</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="c in CODE_CASE_OPTIONS"
                :key="c.value"
                type="button"
                class="rounded-lg border px-2 py-2 transition-colors"
                :class="form.code_case === c.value
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'"
                @click="form.code_case = c.value"
              >
                {{ c.label }}
              </button>
            </div>
          </div>
          <div>
            <label class="label">卡密文案</label>
            <input v-model="form.code_template" class="input" placeholder="你的验证码为: {code}, 请复制后加群验证!" />
            <p class="text-xs text-slate-400 mt-1">发货时发送给买家的消息，{code} 会替换为本次生成的随机卡密；留空使用默认文案</p>
          </div>
        </div>
        <div v-else-if="form.type === 'image'">
          <label class="label">图片 URL</label>
          <input v-model="form.image_url" class="input" placeholder="https://.../card.png" />
        </div>

        <div>
          <label class="label">消息回复</label>
          <textarea v-model="form.description" rows="2" class="input" placeholder="可选，如 感谢购买，请加群 xxx 获取售后" />
          <p class="text-xs text-slate-400 mt-1">发货时随卡券内容一起发送给买家；留空则发货时不同时发送消息</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">延时发货 (秒)</label>
            <input v-model.number="form.delay_seconds" type="number" min="0" class="input" />
          </div>
          <div class="flex items-end pb-1">
            <label class="flex items-center gap-3 cursor-pointer select-none">
              <ToggleSwitch v-model="form.enabled" />
              <span class="text-slate-700 dark:text-slate-200">{{ form.enabled ? '启用中' : '已停用' }}</span>
            </label>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.is_multi_spec" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
            <span class="text-sm text-slate-700 dark:text-slate-200">多规格卡券</span>
          </label>
          <div v-if="form.is_multi_spec" class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">规格名称</label>
              <input v-model="form.spec_name" class="input" placeholder="如 面值" />
            </div>
            <div>
              <label class="label">规格值</label>
              <input v-model="form.spec_value" class="input" placeholder="如 30元" />
            </div>
          </div>
        </div>

        <!-- 分销对接设置 -->
        <div class="pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Icon name="link" class="text-brand-500" />
              <h4 class="text-sm font-semibold text-slate-900 dark:text-white">分销对接设置</h4>
            </div>
            <label class="flex items-center gap-2 cursor-pointer text-xs text-slate-500 dark:text-slate-400">
              <input v-model="form.is_dockable" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
              允许其他分销商对接
            </label>
          </div>
          <div v-if="form.is_dockable" class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">对接价 (元)</label>
              <input v-model="form.price" type="number" min="0" step="0.01" class="input" placeholder="0.00" />
            </div>
            <div>
              <label class="label">最低售价 (元)</label>
              <input v-model="form.min_price" type="number" min="0" step="0.01" class="input" placeholder="可选" />
            </div>
            <div>
              <label class="label">手续费承担方</label>
              <select v-model="form.fee_payer" class="input">
                <option value="distributor">货主承担</option>
                <option value="dealer">分销商承担</option>
              </select>
            </div>
            <div>
              <label class="label">对接可见性</label>
              <select v-model="form.dock_visibility" class="input">
                <option value="public">公开（所有分销商可见）</option>
                <option value="dealer_only">仅指定分销商</option>
              </select>
            </div>
          </div>
          <p v-else class="text-xs text-slate-400">开启后，该卡券会出现在货源广场供其他分销商对接。</p>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="modalOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="saveCard">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>

    <!-- Delete confirm modal -->
    <ModalBase :model-value="!!deleteTarget" title="删除卡券" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-sm text-slate-500 mt-2">
          确认删除卡券 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.name }}</span>？
          关联的自动发货规则将保留但不再生效。
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
import { getCards, createCard, updateCard, deleteCard } from '~/api/cards'
import type { Card } from '~/api/cards'
import { getCardCodeLogs } from '~/api/card-codes'
import type { CardCodeLogRow } from '~/api/card-codes'

definePageMeta({ layout: 'default' })

const toast = useToast()

const TYPE_OPTIONS = [
  { value: 'api',  label: 'API',  icon: 'server',   cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  { value: 'text',  label: '文本',  icon: 'message',  cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { value: 'code',  label: '卡密',  icon: 'key',      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'image', label: '图片',  icon: 'package',  cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
] as const

const CODE_CASE_OPTIONS = [
  { value: 'mixed', label: '大小写' },
  { value: 'lower', label: '小写' },
  { value: 'upper', label: '大写' },
]

const DEFAULT_CODE_TEMPLATE = '你的验证码为: {code}, 请复制后加群验证!'

function typeMeta(t: string) {
  return TYPE_OPTIONS.find((o) => o.value === t) || TYPE_OPTIONS[1]
}

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const cards = ref<Card[]>([])
const keyword = ref('')
const filterType = ref('')
const modalOpen = ref(false)
const editing = ref(false)
const deleteTarget = ref<Card | null>(null)

const form = ref<any>({
  id: null,
  name: '',
  type: 'text',
  api_config: '',
  text_content: '',
  image_url: '',
  code_length: 6,
  code_letters: true,
  code_digits: true,
  code_case: 'mixed',
  code_template: DEFAULT_CODE_TEMPLATE,
  description: '',
  enabled: true,
  delay_seconds: 0,
  is_multi_spec: false,
  spec_name: '',
  spec_value: '',
  // 分销对接设置
  price: '0.00',
  is_dockable: false,
  fee_payer: 'distributor',
  min_price: '',
  dock_visibility: 'public',
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return cards.value.filter((c) => {
    if (filterType.value && c.type !== filterType.value) return false
    if (!k) return true
    return c.name.toLowerCase().includes(k) || (c.description || '').toLowerCase().includes(k)
  })
})

const apiTesting = ref(false)
const apiTestResult = ref('')

/** 一键填入 cards-hub (资源交付系统) 加密 URL 发货模板, 用户只需改域名/密钥/资源 ID 三处 */
function fillCardsHubTemplate() {
  form.value.type = 'api'
  form.value.api_config = JSON.stringify(
    {
      url: 'https://你的-cards-hub-域名/api/issue',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer ak-你的APIKEY',
      },
      body: {
        title: form.value.name || '商品名称',
        price: 9.9,
        script_id: 1,
      },
      data_path: 'data.url',
    },
    null,
    2,
  )
}

/** 服务端代发一次请求并按 data_path 提取 (浏览器直连外部接口有 CORS 限制) */
async function testApiConfig() {
  if (apiTesting.value) return
  let conf: any
  try {
    conf = JSON.parse(form.value.api_config || '{}')
  } catch {
    apiTestResult.value = 'API 配置不是合法 JSON'
    toast.error('API 配置不是合法 JSON')
    return
  }
  apiTesting.value = true
  apiTestResult.value = ''
  try {
    const r: any = await $fetch('/api/cards/test-api', {
      method: 'POST',
      body: { api_config: JSON.stringify(conf) },
    })
    const d = r?.data || {}
    apiTestResult.value = d.ok
      ? `✓ HTTP ${d.status} 提取成功: ${String(d.text || '').slice(0, 120)}`
      : `✗ ${d.message || r?.message || '测试未成功'}${d.status ? ` (HTTP ${d.status})` : ''}`
    if (d.ok) toast.success('API 配置测试通过')
    else toast.error(d.message || r?.message || '测试未成功')
  } catch (e: any) {
    apiTestResult.value = `✗ ${e?.message || '请求失败'}`
    toast.error(e?.message || '测试请求失败')
  } finally {
    apiTesting.value = false
  }
}

async function reload() {
  loading.value = true
  try {
    cards.value = await getCards()
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  form.value = {
    id: null, name: '', type: 'text',
    api_config: '', text_content: '', image_url: '',
    code_length: 6, code_letters: true, code_digits: true, code_case: 'mixed', code_template: DEFAULT_CODE_TEMPLATE,
    description: '', enabled: true, delay_seconds: 0,
    is_multi_spec: false, spec_name: '', spec_value: '',
    price: '0.00', is_dockable: false, fee_payer: 'distributor',
    min_price: '', dock_visibility: 'public',
  }
  modalOpen.value = true
}

function openEdit(c: Card) {
  editing.value = true
  form.value = {
    id: c.id, name: c.name, type: c.type,
    api_config: c.api_config || '',
    text_content: c.text_content || '',
    image_url: c.image_url || '',
    code_length: c.code_length || 6,
    code_letters: Number(c.code_letters ?? 1) === 1,
    code_digits: Number(c.code_digits ?? 1) === 1,
    code_case: c.code_case || 'mixed',
    code_template: c.code_template || DEFAULT_CODE_TEMPLATE,
    description: c.description || '',
    enabled: !!c.enabled,
    delay_seconds: c.delay_seconds || 0,
    is_multi_spec: !!c.is_multi_spec,
    spec_name: c.spec_name || '',
    spec_value: c.spec_value || '',
    price: c.price || '0.00',
    is_dockable: !!c.is_dockable,
    fee_payer: c.fee_payer || 'distributor',
    min_price: c.min_price || '',
    dock_visibility: c.dock_visibility || 'public',
  }
  modalOpen.value = true
}

async function saveCard() {
  if (!form.value.name.trim()) {
    toast.error('请填写卡券名称')
    return
  }
  saving.value = true
  try {
    const payload: any = {
      name: form.value.name,
      type: form.value.type,
      description: form.value.description,
      enabled: form.value.enabled,
      delay_seconds: Number(form.value.delay_seconds) || 0,
      is_multi_spec: form.value.is_multi_spec,
      spec_name: form.value.spec_name,
      spec_value: form.value.spec_value,
      // 分销对接设置
      price: form.value.price || '0.00',
      is_dockable: form.value.is_dockable,
      fee_payer: form.value.fee_payer,
      min_price: form.value.min_price || null,
      dock_visibility: form.value.dock_visibility,
    }
    if (form.value.type === 'api') payload.api_config = form.value.api_config
    if (form.value.type === 'text') payload.text_content = form.value.text_content
    if (form.value.type === 'image') payload.image_url = form.value.image_url
    if (form.value.type === 'code') {
      if (!form.value.code_letters && !form.value.code_digits) {
        toast.error('卡密字符构成至少勾选 英文/数字 一项')
        return
      }
      payload.code_length = Math.min(32, Math.max(4, Number(form.value.code_length) || 6))
      payload.code_letters = form.value.code_letters
      payload.code_digits = form.value.code_digits
      payload.code_case = form.value.code_case
      payload.code_template = (form.value.code_template || '').trim()
    }

    if (editing.value) {
      await updateCard(form.value.id, payload)
      toast.success('卡券已更新')
    } else {
      await createCard(payload)
      toast.success('卡券已创建')
    }
    modalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(c: Card) {
  try {
    await updateCard(c.id, { enabled: !c.enabled })
    c.enabled = c.enabled ? 0 : 1
    toast.success(c.enabled ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

function confirmDelete(c: Card) {
  deleteTarget.value = c
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteCard(deleteTarget.value.id)
    toast.success('卡券已删除')
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

const codeLogs = ref<CardCodeLogRow[]>([])
const codeLogTotal = ref(0)
const codeLogPage = ref(1)
const codeLogPageSize = ref(20)
const codeLogKeyword = ref('')
const codeLogsLoading = ref(false)
const codeLogTotalPages = computed(() => Math.max(1, Math.ceil(codeLogTotal.value / codeLogPageSize.value)))

async function reloadCodeLogs() {
  codeLogsLoading.value = true
  try {
    const res = await getCardCodeLogs({
      page: codeLogPage.value,
      pageSize: codeLogPageSize.value,
      keyword: codeLogKeyword.value.trim() || undefined,
    })
    codeLogs.value = res.data
    codeLogTotal.value = res.total
  } catch (e: any) {
    toast.error(e.message || '卡密记录加载失败')
  } finally {
    codeLogsLoading.value = false
  }
}

function resetCodeLogsAndReload() {
  codeLogPage.value = 1
  reloadCodeLogs()
}

function goCodeLogPage(p: number) {
  if (p < 1 || p > codeLogTotalPages.value) return
  codeLogPage.value = p
  reloadCodeLogs()
}

async function copyCodeLog(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    toast.success(`卡密 ${code} 已复制`)
  } catch {
    toast.error('复制失败, 请手动复制')
  }
}

onMounted(reload)
onMounted(reloadCodeLogs)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
