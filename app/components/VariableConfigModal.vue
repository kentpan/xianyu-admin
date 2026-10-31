<template>
  <ModalBase v-model="open" title="发货变量配置" size="xl" :close-on-backdrop="false">
    <div class="space-y-4">
      <p class="text-slate-500 dark:text-slate-400">
        配置发货文案 / 消息回复 / 卡密文案可用的
        <code class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">{{ '{变量}' }}</code>
        替换项：勾选启用的变量才会出现在各输入框下方「可用变量」列表中，发货时按来源实时取值；内置变量不可删除，可停用隐藏。
      </p>

      <!-- 分类 tabs -->
      <div class="flex items-center gap-1.5 flex-wrap">
        <button
          v-for="c in CATEGORY_TABS"
          :key="c.value"
          type="button"
          class="badge cursor-pointer transition-colors"
          :class="activeTab === c.value
            ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
            : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
          @click="activeTab = c.value"
        >
          {{ c.label }}
          <span class="ml-1 opacity-70">{{ vars.filter((v) => v.category === c.value).length }}</span>
        </button>
      </div>
      <p class="text-slate-400">{{ VAR_CATEGORY_META[activeTab]?.desc }}</p>

      <!-- 变量列表 -->
      <div class="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 max-h-80 overflow-y-auto scrollbar-thin">
        <div v-if="!tabVars.length" class="p-6 text-center text-slate-400">该分组暂无变量，点击下方「新增变量」创建</div>
        <div v-for="v in tabVars" :key="v.id" class="p-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
          <label class="flex items-center h-6 cursor-pointer shrink-0" title="启用后出现在可用变量列表">
            <input
              type="checkbox"
              class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500"
              :checked="Number(v.enabled) === 1"
              @change="toggleEnabled(v)"
            />
          </label>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <code class="badge bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 font-mono">{{ '{' + v.var_key + '}' }}</code>
              <span class="text-slate-800 dark:text-white font-medium">{{ v.label }}</span>
              <span v-if="Number(v.builtin) === 1" class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400">内置</span>
              <span v-if="Number(v.enabled) === 1" class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">已启用</span>
            </div>
            <p v-if="v.description" class="text-slate-400 mt-0.5">{{ v.description }}</p>
            <p v-if="v.category === 'custom' && v.sample_value" class="text-slate-400 mt-0.5 truncate">固定值: <span class="font-mono">{{ v.sample_value }}</span></p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button class="btn-ghost !px-2 !py-1" title="编辑" @click="startEdit(v)">
              <Icon name="edit" />
            </button>
            <button
              v-if="Number(v.builtin) !== 1"
              class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
              title="删除"
              @click="removeVar(v)"
            >
              <Icon name="trash" />
            </button>
          </div>
        </div>
      </div>

      <!-- 新增/编辑表单 -->
      <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <h4 class="font-medium text-slate-900 dark:text-white flex items-center gap-2">
          <Icon name="plus" class="text-brand-500" />
          {{ editingVar ? '编辑变量 {' + editingVar.var_key + '}' : '新增自定义变量' }}
        </h4>
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label class="label">变量名</label>
            <input v-model="form.var_key" class="input font-mono" placeholder="my_var" :disabled="!!editingVar" />
          </div>
          <div>
            <label class="label">显示名</label>
            <input v-model="form.label" class="input" placeholder="如 售后群号" />
          </div>
          <div>
            <label class="label">所属分组</label>
            <select v-model="form.category" class="input" :disabled="!!editingVar && Number(editingVar.builtin) === 1">
              <option v-for="(m, key) in VAR_CATEGORY_META" :key="key" :value="key">{{ m.label }}</option>
            </select>
          </div>
          <div v-if="form.category === 'custom' || (editingVar && Number(editingVar.builtin) !== 1)">
            <label class="label">固定值 (custom 用)</label>
            <input v-model="form.sample_value" class="input" placeholder="发货时替换为该值" />
          </div>
        </div>
        <div>
          <label class="label">变量说明</label>
          <input v-model="form.description" class="input" placeholder="展示在变量列表 tooltip 中的说明文字" />
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-primary !py-1.5 !px-3" :disabled="formSaving" @click="saveForm">
            <Icon name="save" v-if="!formSaving" />
            <Icon name="refresh" v-else class="animate-spin" />
            {{ editingVar ? '保存修改' : '新增变量' }}
          </button>
          <button v-if="editingVar" class="btn-ghost !py-1.5 !px-3" @click="resetForm">取消编辑</button>
          <span v-if="formMsg" class="text-slate-500">{{ formMsg }}</span>
        </div>
      </div>

      <!-- 真实数据预览 (预先配置好的商品/账号/卡密数据) -->
      <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h4 class="font-medium text-slate-900 dark:text-white flex items-center gap-2">
            <Icon name="package" class="text-brand-500" /> 系统数据预览
          </h4>
          <button class="btn-secondary !py-1 !px-2.5" :disabled="previewLoading" @click="loadPreview">
            <Icon name="refresh" :class="previewLoading ? 'animate-spin' : ''" /> 刷新
          </button>
        </div>
        <div class="max-h-64 overflow-y-auto scrollbar-thin space-y-3">
          <div>
            <p class="text-slate-500 dark:text-slate-400 mb-1">商品数据 (带商品ID, 最多展示 30 条)</p>
            <div v-if="preview.items.length" class="space-y-1">
              <div v-for="it in preview.items" :key="it.item_id" class="text-slate-600 dark:text-slate-300 flex items-center gap-2 flex-wrap">
                <code class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300 font-mono">{{ it.item_id }}</code>
                <span class="truncate max-w-[280px]">{{ it.item_title || '—' }}</span>
                <span class="text-slate-400 tabular-nums">¥{{ it.item_price || '0.00' }}</span>
              </div>
            </div>
            <p v-else class="text-slate-400">暂无商品数据 (账号同步商品后此处展示)</p>
          </div>
          <div>
            <p class="text-slate-500 dark:text-slate-400 mb-1">闲鱼账号数据</p>
            <div v-if="preview.accounts.length" class="flex items-center gap-1.5 flex-wrap">
              <span v-for="a in preview.accounts" :key="a.id" class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">
                {{ a.username || a.remark || a.id }}
              </span>
            </div>
            <p v-else class="text-slate-400">暂无账号</p>
          </div>
          <div>
            <p class="text-slate-500 dark:text-slate-400 mb-1">最近卡密样例 (卡密型卡券发货时生成)</p>
            <div v-if="preview.codes.length" class="flex items-center gap-1.5 flex-wrap">
              <code v-for="c in preview.codes" :key="c.code" class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300 font-mono">{{ c.code }}</code>
            </div>
            <p v-else class="text-slate-400">暂无卡密生成记录</p>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <span class="mr-auto text-slate-400">变更实时保存, 保存后启用的变量立即出现在可用变量列表</span>
      <button class="btn-secondary" @click="open = false">完成</button>
    </template>
  </ModalBase>
</template>

<script setup lang="ts">
import type { CardVariable, } from '~/composables/useCardVariables'

const open = defineModel<boolean>({ default: false })
const toast = useToast()
const { vars, reload, ensureLoaded } = useCardVariables()

const CATEGORY_TABS = [
  { value: 'item', label: '商品数据' },
  { value: 'account', label: '闲鱼账号数据' },
  { value: 'code', label: '卡密数据' },
  { value: 'api', label: 'API 数据' },
  { value: 'custom', label: '自定义数据' },
]

const activeTab = ref('item')
const tabVars = computed(() => vars.value.filter((v) => v.category === activeTab.value))

watch(open, (v) => {
  if (v) {
    ensureLoaded()
    loadPreview()
  }
})

const form = ref({ var_key: '', label: '', category: 'custom', description: '', sample_value: '' })
const editingVar = ref<CardVariable | null>(null)
const formSaving = ref(false)
const formMsg = ref('')

function resetForm() {
  editingVar.value = null
  form.value = { var_key: '', label: '', category: activeTab.value === 'custom' ? 'custom' : activeTab.value, description: '', sample_value: '' }
  formMsg.value = ''
}

function startEdit(v: CardVariable) {
  editingVar.value = v
  form.value = {
    var_key: v.var_key,
    label: v.label,
    category: v.category,
    description: v.description || '',
    sample_value: v.sample_value || '',
  }
  formMsg.value = ''
}

async function toggleEnabled(v: CardVariable) {
  const next = Number(v.enabled) === 1 ? 0 : 1
  try {
    await useApi().put(`/api/card-variables/${v.id}`, { enabled: next === 1 })
    v.enabled = next
    toast.success(next === 1 ? `变量 {${v.var_key}} 已启用` : `变量 {${v.var_key}} 已停用`)
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function saveForm() {
  if (formSaving.value) return
  if (!editingVar.value && !/^\w{1,64}$/.test(form.value.var_key.trim())) {
    toast.error('变量名只能包含字母/数字/下划线 (1-64 位)')
    return
  }
  if (!form.value.label.trim()) {
    toast.error('请填写变量显示名')
    return
  }
  formSaving.value = true
  try {
    if (editingVar.value) {
      await useApi().put(`/api/card-variables/${editingVar.value.id}`, {
        label: form.value.label.trim(),
        description: form.value.description,
        sample_value: form.value.sample_value,
      })
      toast.success(`变量 {${editingVar.value.var_key}} 已更新`)
    } else {
      await useApi().post('/api/card-variables', {
        var_key: form.value.var_key.trim(),
        label: form.value.label.trim(),
        category: form.value.category,
        description: form.value.description,
        sample_value: form.value.sample_value,
        enabled: true,
      })
      toast.success(`变量 {${form.value.var_key.trim()}} 已新增`)
    }
    await reload()
    resetForm()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    formSaving.value = false
  }
}

async function removeVar(v: CardVariable) {
  if (!confirm(`确认删除变量 {${v.var_key}}？`)) return
  try {
    await useApi().del(`/api/card-variables/${v.id}`)
    toast.success('变量已删除')
    await reload()
    if (editingVar.value?.id === v.id) resetForm()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  }
}

const preview = ref<{ items: any[]; accounts: any[]; codes: any[] }>({ items: [], accounts: [], codes: [] })
const previewLoading = ref(false)

async function loadPreview() {
  previewLoading.value = true
  try {
    const data = await useApi().get<{ items: any[]; accounts: any[]; codes: any[] }>('/api/card-variables/preview')
    preview.value = { items: data?.items || [], accounts: data?.accounts || [], codes: data?.codes || [] }
  } catch {
    /* 预览失败静默 (弹窗主体功能不受影响) */
  } finally {
    previewLoading.value = false
  }
}

onMounted(ensureLoaded)
</script>
