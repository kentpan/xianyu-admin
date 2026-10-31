<template>
  <div class="flex items-center gap-1.5 mt-1 flex-wrap">
    <span class="text-slate-400">可用变量(点击插入):</span>
    <button
      v-for="v in enabledList"
      :key="v.token"
      type="button"
      class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300 hover:bg-brand-100 hover:text-brand-700 dark:hover:bg-brand-900/30 dark:hover:text-brand-300 cursor-pointer transition-colors"
      :title="v.label"
      @click.prevent="$emit('insert', v.token)"
    >
      {{ v.token }}
    </button>
    <span v-if="!enabledList.length" class="text-slate-400">暂无启用变量, 可在卡券管理页右上角「变量配置」中开启</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{ inline?: boolean }>()
defineEmits<{ (e: 'insert', token: string): void }>()

const { enabledList, ensureLoaded } = useCardVariables()
onMounted(ensureLoaded)
</script>
