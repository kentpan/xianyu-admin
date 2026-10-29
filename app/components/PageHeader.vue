<template>
  <div class="mb-5 flex items-start justify-between gap-3 flex-wrap">
    <div>
      <h2 class="text-lg font-semibold text-slate-900 dark:text-white">{{ title }}</h2>
      <p v-if="description" class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{{ description }}</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>
