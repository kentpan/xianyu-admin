<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="input flex items-center justify-between text-left"
      :class="triggerClass"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="flex items-center gap-2 min-w-0">
        <Icon name="sparkles" class="shrink-0 text-brand-500" />
        <span v-if="selected" class="truncate">
          {{ selected.name }}
          <span class="text-slate-400">· {{ selected.model_name }}</span>
          <span v-if="!Number(selected.enabled)" class="badge bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300 ml-1">已停用</span>
        </span>
        <span v-else class="truncate text-slate-400">{{ placeholder }}</span>
      </span>
      <Icon name="chevronRight" class="shrink-0 rotate-90 text-slate-400" />
    </button>

    <div
      v-if="open"
      class="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg max-h-72 overflow-y-auto scrollbar-thin"
      role="listbox"
    >
      <div v-if="loading" class="p-4 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <button
          v-for="c in configs"
          :key="c.id"
          type="button"
          class="w-full px-3 py-2.5 text-left border-b border-slate-100 dark:border-slate-700/60 last:border-b-0 transition-colors hover:bg-brand-50 dark:hover:bg-brand-900/20"
          :class="modelValue === c.id ? 'bg-brand-50 dark:bg-brand-900/20' : ''"
          role="option"
          :aria-selected="modelValue === c.id"
          @click="pick(c)"
        >
          <span class="flex items-center justify-between gap-2">
            <span class="font-medium text-slate-800 dark:text-slate-100 truncate">{{ c.name }}</span>
            <span
              v-if="!Number(c.enabled)"
              class="badge bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300 shrink-0"
            >已停用</span>
          </span>
          <span class="block mt-0.5 text-slate-400 truncate">
            {{ c.model_name }} · {{ c.base_url }}
          </span>
        </button>
        <div v-if="!configs.length" class="p-4 text-slate-400 text-center">
          暂无 AI 配置，请先到「AI配置」页新建
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getAiConfigs } from '~/api/ai-configs'
import type { AiConfig } from '~/api/ai-configs'

const props = withDefaults(defineProps<{
  modelValue: number
  placeholder?: string
  triggerClass?: string
}>(), {
  placeholder: '请选择 AI 配置',
  triggerClass: '',
})

const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>()

const rootRef = ref<HTMLElement | null>(null)
const open = ref(false)
const loading = ref(false)
const configs = ref<AiConfig[]>([])
let loaded = false

const selected = computed(() => configs.value.find((c) => c.id === props.modelValue) || null)

async function ensureLoaded() {
  if (loaded) return
  loading.value = true
  try {
    const page = await getAiConfigs({ page: 1, pageSize: 200 })
    configs.value = page.data
    loaded = true
  } catch {
    // 打开浮层时静默失败, 下次打开重试
  } finally {
    loading.value = false
  }
}

function toggle() {
  open.value = !open.value
  if (open.value) ensureLoaded()
}

function pick(c: AiConfig) {
  emit('update:modelValue', c.id)
  open.value = false
}

function onDocClick(e: MouseEvent) {
  if (open.value && rootRef.value && !rootRef.value.contains(e.target as Node)) open.value = false
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
})

defineExpose({
  refresh: () => {
    loaded = false
    if (open.value) ensureLoaded()
  },
})
</script>
