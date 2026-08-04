<template>
  <div class="card p-6 md:p-8 text-center">
    <div class="w-14 h-14 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
      <Icon :name="icon" class="text-2xl" />
    </div>
    <p class="mt-4 text-sm text-slate-500 dark:text-slate-400">{{ message }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ message?: string; icon?: string }>(), {
  message: '暂无数据',
  icon: 'package',
})
</script>
