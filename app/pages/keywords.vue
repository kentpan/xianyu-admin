<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="自动回复" description="关键词自动回复规则：买家消息命中关键词时触发；优先级高于 AI 回复与默认回复">
      <template #actions>
        <button class="btn-secondary" @click="reload" :disabled="!currentCookieId">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-secondary" :disabled="!currentCookieId" @click="openImport">
          <Icon name="upload" /> 导入
        </button>
        <button class="btn-secondary" :disabled="!currentCookieId" @click="exportKeywords">
          <Icon name="download" /> 导出
        </button>
        <button class="btn-secondary" :disabled="!currentCookieId" @click="openAiSettings">
          <Icon name="sparkles" /> AI 配置
        </button>
        <button class="btn-primary" :disabled="!currentCookieId" @click="openCreate">
          <Icon name="plus" /> 新增关键词
        </button>
      </template>
    </PageHeader>

    <!-- Cookie selector -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-sm text-slate-500 dark:text-slate-400">选择账号</label>
        <select v-model="currentCookieId" class="input !w-auto min-w-[240px]" @change="onCookieChange">
          <option value="" disabled>请选择账号...</option>
          <option v-for="a in accounts" :key="a.id" :value="a.id">
            {{ a.remark || a.id }}
          </option>
        </select>
        <NuxtLink v-if="!accounts.length" to="/accounts" class="text-xs text-brand-600 hover:underline">先去添加账号 →</NuxtLink>
        <p v-if="currentCookieId" class="text-xs text-slate-400 ml-auto">共 {{ keywords.length }} 条</p>
      </div>
    </div>

    <!-- Keyword match tester -->
    <div v-if="currentCookieId" class="card p-5">
      <div class="flex items-center gap-2 mb-3">
        <Icon name="search" class="text-brand-500" />
        <h3 class="font-semibold text-slate-900 dark:text-white text-sm">关键词匹配测试器</h3>
      </div>
      <p class="text-xs text-slate-400 mb-3">输入模拟消息，测试会匹配到哪些关键词回复。支持精确/包含/前缀(*)/后缀(*)匹配。</p>
      <div class="flex items-center gap-2 flex-wrap">
        <input
          v-model="testMessage"
          class="input flex-1 min-w-[200px]"
          placeholder="输入测试消息，如：这个多少钱"
          @keydown.enter="runTest"
        />
        <button class="btn-primary !text-xs" :disabled="testing" @click="runTest">
          <Icon v-if="testing" name="refresh" class="animate-spin" />
          <Icon v-else name="search" /> 测试匹配
        </button>
        <button class="btn-ghost !text-xs" @click="testMessage = ''; testResult = null">清空</button>
      </div>
      <!-- Test results -->
      <div v-if="testResult" class="mt-4 space-y-2">
        <div v-if="testResult.matched.length" class="space-y-2">
          <p class="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <Icon name="check" /> 匹配到 {{ testResult.matched.length }} 条回复
          </p>
          <div v-for="m in testResult.matched" :key="m.id" class="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 shrink-0">{{ m.matchType }}</span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-slate-800 dark:text-slate-100">关键词: {{ m.keyword }}</p>
              <p class="text-sm text-slate-600 dark:text-slate-300 mt-0.5">回复: {{ m.reply }}</p>
              <p v-if="m.item_id" class="text-xs text-slate-400 mt-0.5">绑定商品: {{ m.item_id }}</p>
            </div>
          </div>
        </div>
        <div v-else class="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <p class="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Icon name="info" /> 未匹配到任何关键词
            <span v-if="testResult.hasDefaultReply" class="text-amber-600 dark:text-amber-400 ml-2">→ 将使用默认回复: {{ testResult.defaultReply?.slice(0, 40) }}…</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else-if="currentCookieId">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>关键词</th>
                <th>类型</th>
                <th>关联商品</th>
                <th>回复内容</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="k in keywords" :key="k.id">
                <td>
                  <span class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">{{ k.keyword }}</span>
                </td>
                <td>
                  <span v-if="k.type === 'image'" class="badge bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                    <Icon name="package" /> 图片
                  </span>
                  <span v-else class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">
                    <Icon name="message" /> 文本
                  </span>
                </td>
                <td>
                  <span v-if="k.item_id" class="font-mono text-xs text-slate-500">{{ k.item_id }}</span>
                  <span v-else class="text-slate-400">通用</span>
                </td>
                <td class="max-w-[320px]">
                  <template v-if="k.type === 'image'">
                    <a v-if="k.image_url" :href="k.image_url" target="_blank" class="text-sky-600 hover:underline text-xs truncate inline-block max-w-full align-bottom">
                      <Icon name="external" /> {{ k.image_url }}
                    </a>
                    <span v-else class="text-slate-400">—</span>
                  </template>
                  <template v-else>
                    <p class="truncate text-slate-700 dark:text-slate-200">{{ k.reply }}</p>
                  </template>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(k.created_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(k)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="deleteOne(k)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!keywords.length" message="还没有关键词，点击右上角「新增关键词」" icon="keywords" />
      </template>
      <EmptyState v-else message="请先选择一个账号" icon="accounts" />
    </div>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑关键词' : '新增关键词'" size="md">
      <div class="space-y-4">
        <div>
          <label class="label">关键词 <span class="text-red-500">*</span></label>
          <input v-model="form.keyword" class="input" placeholder="买家消息中包含此关键词即触发" />
        </div>
        <div>
          <label class="label">回复类型</label>
          <div class="flex items-center gap-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="form.type" type="radio" value="text" class="text-brand-600 focus:ring-brand-500" />
              <span class="text-sm text-slate-700 dark:text-slate-200">文本</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="form.type" type="radio" value="image" class="text-brand-600 focus:ring-brand-500" />
              <span class="text-sm text-slate-700 dark:text-slate-200">图片</span>
            </label>
          </div>
        </div>
        <div v-if="form.type === 'text'">
          <label class="label">回复内容 <span class="text-red-500">*</span></label>
          <textarea v-model="form.reply" rows="4" class="input" placeholder="自动回复的文本内容"></textarea>
          <p class="text-xs text-slate-400 mt-1">可用变量: {send_user_name} 买家昵称、{send_user_id} 买家ID、{send_message} 消息内容</p>
        </div>
        <div v-else>
          <label class="label">图片 URL <span class="text-red-500">*</span></label>
          <input v-model="form.image_url" class="input" placeholder="https://..." />
          <p class="text-xs text-slate-400 mt-1">可同时填写回复文本作为图片说明</p>
          <label class="label mt-3">回复内容 (可选)</label>
          <textarea v-model="form.reply" rows="2" class="input" placeholder="图片说明文字"></textarea>
        </div>
        <div>
          <label class="label">关联商品 (可选)</label>
          <select v-model="form.item_id" class="input">
            <option value="">通用 (对所有商品生效)</option>
            <option v-for="i in itemsForAccount" :key="i.item_id" :value="i.item_id">
              {{ i.item_id }} · {{ i.item_title || '无标题' }}
            </option>
          </select>
          <p class="text-xs text-slate-400 mt-1">从商品管理列表选择; 留空表示对所有商品生效</p>
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

    <!-- AI settings modal -->
    <ModalBase v-model="aiModalOpen" title="AI 智能回复配置" size="md">
      <div v-if="aiForm" class="space-y-4">
        <div class="rounded-lg bg-brand-50 dark:bg-brand-900/20 p-3 text-xs text-brand-700 dark:text-brand-300">
          为当前账号接入大模型, 买家咨询时由 AI 自动回复与智能议价 (需消息监听引擎同步该配置后生效)。引擎实际优先级: API 回复 > 关键词回复 > AI 回复 > 指定商品回复 > 默认回复 —— 仅当关键词未命中时 AI 才接管。
        </div>
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="aiForm.ai_enabled" type="checkbox" class="w-4 h-4 mt-0.5 rounded text-brand-600 focus:ring-brand-500" />
          <span class="text-sm text-slate-700 dark:text-slate-200">
            启用 AI 智能回复
            <span class="block text-xs text-slate-400 mt-0.5">关闭后该账号仅使用关键词/默认回复</span>
          </span>
        </label>
        <div>
          <label class="label">AI 接入配置</label>
          <AiConfigSelect v-model="aiForm.ai_config_id" placeholder="请选择 AI 配置 (在「AI配置」页管理)" />
          <p class="mt-1 text-slate-400">模型 / API Key / 地址统一在管理员「AI配置」页维护, 此处直接引用; 配置一处修改全局生效</p>
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
        <div>
          <label class="label">自定义提示词 (可选)</label>
          <textarea v-model="aiForm.custom_prompts" rows="4" class="input" placeholder="补充给 AI 的商品说明 / 回复风格 / 禁语等"></textarea>
        </div>
        <div class="pt-2 border-t border-slate-100 dark:border-slate-700">
          <label class="label">连通性测试</label>
          <div class="flex gap-2">
            <input v-model="aiTestMessage" class="input" placeholder="模拟买家消息, 例如: 能便宜点吗" />
            <button class="btn-secondary shrink-0" :disabled="aiTesting" @click="runAiTest">
              <Icon name="sparkles" /> {{ aiTesting ? '测试中...' : '发送测试' }}
            </button>
          </div>
          <p v-if="aiTestReply" class="mt-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap">AI 回复: {{ aiTestReply }}</p>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="aiModalOpen = false">取消</button>
        <button class="btn-primary" :disabled="aiSaving" @click="saveAiSettings">
          <Icon name="save" v-if="!aiSaving" />
          <Icon name="refresh" v-else class="animate-spin" />
          保存
        </button>
      </template>
    </ModalBase>

    <!-- Import wizard modal -->
    <ModalBase v-model="importOpen" title="批量导入关键词" size="lg">
      <!-- Stepper -->
      <div class="flex items-center justify-center gap-2 mb-5">
        <template v-for="(s, i) in importSteps" :key="s.key">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors" :class="importStep >= i ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700'">
              <Icon v-if="importStep > i" name="check" />
              <span v-else>{{ i + 1 }}</span>
            </div>
            <span class="text-xs hidden sm:inline" :class="importStep >= i ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-400'">{{ s.label }}</span>
            <Icon v-if="i < importSteps.length - 1" name="chevronRight" class="text-slate-300 mx-0.5" />
          </div>
        </template>
      </div>

      <!-- Step 0: Choose format -->
      <div v-if="importStep === 0" class="space-y-3">
        <p class="text-sm text-slate-500 dark:text-slate-400">选择导入格式</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button class="p-4 rounded-lg border-2 text-left transition-all" :class="importFormat === 'json' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'" @click="importFormat = 'json'">
            <Icon name="package" class="text-lg mb-1" :class="importFormat === 'json' ? 'text-brand-600' : 'text-slate-400'" />
            <p class="text-sm font-medium text-slate-800 dark:text-slate-100">JSON 格式</p>
            <p class="text-xs text-slate-400 mt-0.5">标准 JSON 数组，支持全字段</p>
          </button>
          <button class="p-4 rounded-lg border-2 text-left transition-all" :class="importFormat === 'csv' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'" @click="importFormat = 'csv'">
            <Icon name="edit" class="text-lg mb-1" :class="importFormat === 'csv' ? 'text-brand-600' : 'text-slate-400'" />
            <p class="text-sm font-medium text-slate-800 dark:text-slate-100">CSV 格式</p>
            <p class="text-xs text-slate-400 mt-0.5">逗号分隔，keyword,reply,type</p>
          </button>
        </div>
        <div class="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-3">
          <div class="flex items-center justify-between mb-1">
            <p class="text-xs font-medium text-slate-600 dark:text-slate-300">下载模板</p>
            <button class="text-xs text-brand-600 hover:underline flex items-center gap-1" @click="downloadTemplate">
              <Icon name="download" /> {{ importFormat === 'json' ? 'template.json' : 'template.csv' }}
            </button>
          </div>
          <p class="text-xs text-slate-400">参考模板格式填写后再粘贴到下一步</p>
        </div>
      </div>

      <!-- Step 1: Paste / Upload -->
      <div v-if="importStep === 1" class="space-y-3">
        <p class="text-sm text-slate-500 dark:text-slate-400">粘贴 {{ importFormat.toUpperCase() }} 内容或上传文件</p>
        <input ref="importFileInput" type="file" :accept="importFormat === 'json' ? '.json' : '.csv'" class="input" @change="onImportFile" />
        <textarea v-model="importText" rows="10" class="input font-mono text-xs" :placeholder="importPlaceholder" />
        <div v-if="importParseError" class="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-600 dark:text-rose-400">
          <Icon name="alert" class="inline mr-1" /> {{ importParseError }}
        </div>
      </div>

      <!-- Step 2: Preview & Confirm -->
      <div v-if="importStep === 2" class="space-y-3">
        <p class="text-sm text-slate-500 dark:text-slate-400">预览解析结果（显示前 10 条）</p>
        <div class="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          <Icon name="check" class="inline mr-1" /> 成功解析 {{ importPreview.length }} 条关键词
        </div>
        <div class="table-wrap max-h-[250px] overflow-auto scrollbar-thin rounded-lg border border-slate-200 dark:border-slate-700">
          <table class="table">
            <thead><tr><th>关键词</th><th>回复</th><th>类型</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in importPreview.slice(0, 10)" :key="i">
                <td class="font-mono text-xs">{{ item.keyword }}</td>
                <td class="text-xs max-w-[250px] truncate">{{ item.reply }}</td>
                <td><span class="badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">{{ item.type || 'text' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="importPreview.length > 10" class="text-xs text-slate-400 text-center">还有 {{ importPreview.length - 10 }} 条未显示</p>
      </div>

      <template #footer>
        <button v-if="importStep > 0" class="btn-secondary" @click="importStep--">上一步</button>
        <div class="flex-1" />
        <button class="btn-secondary" @click="closeImport">取消</button>
        <button v-if="importStep < 2" class="btn-primary" :disabled="importStep === 1 && !importText.trim()" @click="nextImportStep">
          下一步 <Icon name="arrowRight" />
        </button>
        <button v-if="importStep === 2" class="btn-primary" :disabled="importing" @click="doImport">
          <Icon v-if="importing" name="refresh" class="animate-spin" />
          <Icon v-else name="upload" /> 确认导入 ({{ importPreview.length }})
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getKeywords, createKeyword, updateKeyword, deleteKeyword, testKeywordMatch, importKeywords, exportKeywords as exportKeywordsApi } from '~/api/keywords'
import type { Keyword } from '~/api/keywords'
import { getAccounts } from '~/api/accounts'
import type { AccountLite } from '~/api/accounts'
import { getItems } from '~/api/items'
import type { Item } from '~/api/items'
import { getAiSettings, saveAiSettings as saveAiSettingsApi, testAiSettings } from '~/api/ai-settings'
import type { AiReplySettings } from '~/api/ai-settings'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const importing = ref(false)
const keywords = ref<Keyword[]>([])
const accounts = ref<AccountLite[]>([])
const items = ref<Item[]>([])
const currentCookieId = ref('')

/** 弹窗内关联商品下拉数据源 (当前账号下的商品, 显示商品 ID + 标题) */
const itemsForAccount = computed(() =>
  items.value.filter((i) => i.cookie_id === currentCookieId.value),
)

async function loadItems() {
  try {
    items.value = await getItems()
  } catch {
    items.value = []
  }
}

// ===== AI 智能回复配置 =====
const aiModalOpen = ref(false)
const aiSaving = ref(false)
const aiForm = ref<AiReplySettings | null>(null)

function openAiSettings() {
  if (!currentCookieId.value) return
  aiForm.value = {
    cookie_id: currentCookieId.value,
    ai_enabled: 0,
    ai_config_id: 0,
    model_name: 'qwen-plus',
    api_key: '',
    api_key_masked: false,
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    max_discount_percent: 10,
    max_discount_amount: 100,
    max_bargain_rounds: 3,
    custom_prompts: '',
  }
  aiModalOpen.value = true
  getAiSettings(currentCookieId.value)
    .then((r) => {
      if (aiModalOpen.value) aiForm.value = { ...r, ai_enabled: Number(r.ai_enabled) ? 1 : 0, ai_config_id: Number(r.ai_config_id) || 0 }
    })
    .catch((e: any) => toast.error(e.message || 'AI 配置加载失败'))
}

async function saveAiSettings() {
  if (!currentCookieId.value || !aiForm.value) return
  const f = aiForm.value
  if (f.ai_enabled && !Number(f.ai_config_id)) {
    toast.error('开启 AI 回复前请选择 AI 配置 (可先到管理员「AI配置」页新建)')
    return
  }
  aiSaving.value = true
  try {
    await saveAiSettingsApi(currentCookieId.value, {
      ai_enabled: !!Number(f.ai_enabled),
      ai_config_id: Number(f.ai_config_id) || 0,
      model_name: f.model_name || 'qwen-plus',
      api_key: f.api_key || '',
      base_url: f.base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      max_discount_percent: Number(f.max_discount_percent) || 0,
      max_discount_amount: Number(f.max_discount_amount) || 0,
      max_bargain_rounds: Number(f.max_bargain_rounds) || 0,
      custom_prompts: f.custom_prompts || '',
    })
    toast.success('AI 配置已保存')
    aiModalOpen.value = false
  } catch (e: any) {
    toast.error(e.message || 'AI 配置保存失败')
  } finally {
    aiSaving.value = false
  }
}

// ===== AI 连通性测试 (先落当前表单再测试, 保证测试反映用户所见配置) =====
const aiTestMessage = ref('')
const aiTesting = ref(false)
const aiTestReply = ref('')

async function runAiTest() {
  if (!currentCookieId.value || !aiForm.value) return
  if (!aiTestMessage.value.trim()) {
    toast.error('请输入模拟买家消息')
    return
  }
  aiTesting.value = true
  aiTestReply.value = ''
  try {
    const f = aiForm.value
    // 先保存当前表单 (不关弹窗), 测试端点读取的是已保存配置
    await saveAiSettingsApi(currentCookieId.value, {
      ai_enabled: !!Number(f.ai_enabled),
      ai_config_id: Number(f.ai_config_id) || 0,
      model_name: f.model_name || 'qwen-plus',
      api_key: f.api_key || '',
      base_url: f.base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      max_discount_percent: Number(f.max_discount_percent) || 0,
      max_discount_amount: Number(f.max_discount_amount) || 0,
      max_bargain_rounds: Number(f.max_bargain_rounds) || 0,
      custom_prompts: f.custom_prompts || '',
    })
    const r = await testAiSettings({
      cookie_id: currentCookieId.value,
      message: aiTestMessage.value.trim(),
    })
    aiTestReply.value = r.reply || '(空回复)'
    toast.success('AI 测试成功')
  } catch (e: any) {
    aiTestReply.value = ''
    toast.error(e.message || 'AI 测试失败')
  } finally {
    aiTesting.value = false
  }
}

// Keyword match tester
const testMessage = ref('')
const testing = ref(false)
const testResult = ref<{ matched: any[]; total: number; hasDefaultReply: boolean; defaultReply: string } | null>(null)
async function runTest() {
  if (!currentCookieId.value || !testMessage.value.trim()) return
  testing.value = true
  try {
    const r = await testKeywordMatch({ cookie_id: currentCookieId.value, message: testMessage.value })
    testResult.value = r
  } catch (e: any) {
    toast.error(e.message || '测试失败')
  } finally {
    testing.value = false
  }
}

const modalOpen = ref(false)
const editing = ref(false)
const importOpen = ref(false)
const importText = ref('')
const importStep = ref(0)
const importFormat = ref<'json' | 'csv'>('json')
const importParseError = ref('')
const importPreview = ref<any[]>([])
const importSteps = [
  { key: 'format', label: '选择格式' },
  { key: 'input', label: '输入内容' },
  { key: 'preview', label: '预览确认' },
]
const importFileInput = ref<HTMLInputElement | null>(null)
const importPlaceholder = computed(() =>
  importFormat.value === 'json'
    ? '[{"keyword":"你好","reply":"你好，有什么可以帮你？","type":"text"}]'
    : 'keyword,reply,type\n你好,你好，有什么可以帮你？,text\n在吗,在的，请问有什么需要？,text',
)

function downloadTemplate() {
  let content = ''
  let filename = ''
  if (importFormat.value === 'json') {
    content = JSON.stringify([
      { keyword: '你好', reply: '你好，有什么可以帮你？', type: 'text', item_id: '' },
      { keyword: '在吗', reply: '在的，请问有什么需要？', type: 'text', item_id: '' },
      { keyword: '多少钱', reply: '这个宝贝29.9元哦~', type: 'text', item_id: '' },
    ], null, 2)
    filename = 'keywords_template.json'
  } else {
    content = 'keyword,reply,type,item_id\n你好,你好，有什么可以帮你？,text,\n在吗,在的，请问有什么需要？,text,\n多少钱,这个宝贝29.9元哦~,text,'
    filename = 'keywords_template.csv'
  }
  const blob = new Blob(['\ufeff' + content], { type: importFormat.value === 'json' ? 'application/json' : 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { importText.value = String(reader.result || '') }
  reader.readAsText(file)
}

function nextImportStep() {
  if (importStep.value === 1) {
    // Parse the input
    importParseError.value = ''
    importPreview.value = []
    try {
      if (importFormat.value === 'json') {
        const arr = JSON.parse(importText.value)
        if (!Array.isArray(arr)) throw new Error('JSON 必须是数组')
        importPreview.value = arr.map((item: any) => ({
          keyword: String(item.keyword || ''),
          reply: String(item.reply || ''),
          type: String(item.type || 'text'),
          item_id: String(item.item_id || ''),
          image_url: String(item.image_url || ''),
        })).filter((i: any) => i.keyword)
      } else {
        // CSV parse (simple — supports quoted fields)
        const lines = importText.value.trim().split('\n')
        if (lines.length < 2) throw new Error('CSV 至少需要表头 + 1 行数据')
        const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
        const kwIdx = headers.indexOf('keyword')
        const replyIdx = headers.indexOf('reply')
        if (kwIdx === -1 || replyIdx === -1) throw new Error('CSV 必须包含 keyword 和 reply 列')
        const typeIdx = headers.indexOf('type')
        const itemIdIdx = headers.indexOf('item_id')
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue
          const cells = parseCsvLine(lines[i])
          importPreview.value.push({
            keyword: cells[kwIdx] || '',
            reply: cells[replyIdx] || '',
            type: typeIdx >= 0 ? cells[typeIdx] || 'text' : 'text',
            item_id: itemIdIdx >= 0 ? cells[itemIdIdx] || '' : '',
            image_url: '',
          })
        }
      }
      if (!importPreview.value.length) throw new Error('未解析到有效关键词')
    } catch (e: any) {
      importParseError.value = e.message || '解析失败'
      return
    }
  }
  importStep.value++
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuote = !inQuote
    } else if (c === ',' && !inQuote) {
      result.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  result.push(cur)
  return result
}

function closeImport() {
  importOpen.value = false
  importStep.value = 0
  importText.value = ''
  importParseError.value = ''
  importPreview.value = []
  if (importFileInput.value) importFileInput.value.value = ''
}

const form = ref<any>({
  id: null,
  keyword: '',
  reply: '',
  item_id: '',
  type: 'text',
  image_url: '',
})

async function loadAccounts() {
  try {
    accounts.value = await getAccounts()
  } catch (e: any) {
    toast.error(e.message || '加载账号失败')
  }
}

async function reload() {
  if (!currentCookieId.value) return
  loading.value = true
  try {
    keywords.value = await getKeywords(currentCookieId.value)
  } catch (e: any) {
    toast.error(e.message || '加载关键词失败')
  } finally {
    loading.value = false
  }
}

function onCookieChange() {
  keywords.value = []
  if (currentCookieId.value) reload()
}

function openCreate() {
  editing.value = false
  form.value = { id: null, keyword: '', reply: '', item_id: '', type: 'text', image_url: '' }
  modalOpen.value = true
}

function openEdit(k: Keyword) {
  editing.value = true
  form.value = { id: k.id, keyword: k.keyword, reply: k.reply, item_id: k.item_id, type: k.type, image_url: k.image_url || '' }
  modalOpen.value = true
}

async function save() {
  if (!form.value.keyword.trim()) {
    toast.error('关键词不能为空')
    return
  }
  if (form.value.type === 'text' && !form.value.reply.trim()) {
    toast.error('回复内容不能为空')
    return
  }
  if (form.value.type === 'image' && !form.value.image_url.trim()) {
    toast.error('图片 URL 不能为空')
    return
  }
  saving.value = true
  try {
    const payload = {
      keyword: form.value.keyword,
      reply: form.value.reply,
      item_id: form.value.item_id,
      type: form.value.type,
      image_url: form.value.image_url,
    }
    if (editing.value) {
      await updateKeyword(currentCookieId.value, form.value.id, payload)
      toast.success('关键词已更新')
    } else {
      await createKeyword(currentCookieId.value, payload)
      toast.success('关键词已添加')
    }
    modalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function deleteOne(k: Keyword) {
  if (!confirm(`确认删除关键词「${k.keyword}」？`)) return
  try {
    await deleteKeyword(currentCookieId.value, k.id)
    toast.success('关键词已删除')
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  }
}

function openImport() {
  importStep.value = 0
  importText.value = ''
  importParseError.value = ''
  importPreview.value = []
  importFormat.value = 'json'
  importOpen.value = true
}

async function doImport() {
  importing.value = true
  try {
    const r = await importKeywords(currentCookieId.value, importPreview.value)
    toast.success(`已导入 ${r.inserted} 条关键词`)
    closeImport()
    reload()
  } catch (e: any) {
    toast.error(e.message || '导入失败')
  } finally {
    importing.value = false
  }
}

async function exportKeywords() {
  try {
    const r = await exportKeywordsApi(currentCookieId.value)
    const blob = new Blob([JSON.stringify(r.keywords, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `keywords-${currentCookieId.value}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${r.count} 条关键词`)
  } catch (e: any) {
    toast.error(e.message || '导出失败')
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(t.replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const route = useRoute()
onMounted(async () => {
  await loadAccounts()
  loadItems()
  const cid = (route.query.cookie_id as string) || ''
  if (cid && accounts.value.some((a) => a.id === cid)) {
    currentCookieId.value = cid
    reload()
  }
})
function onAppRefresh() { if (currentCookieId.value) reload() }
if (import.meta.client) window.addEventListener('app:refresh', onAppRefresh)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', onAppRefresh))
</script>
