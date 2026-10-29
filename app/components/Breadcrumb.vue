<template>
  <nav v-if="items.length" class="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 mb-4 flex-wrap" aria-label="Breadcrumb">
    <template v-for="(item, i) in items" :key="i">
      <!-- Link -->
      <NuxtLink
        v-if="item.to && i < items.length - 1"
        :to="item.to"
        class="hover:text-brand-600 dark:hover:text-brand-400 transition-colors flex items-center gap-1.5"
      >
        <Icon v-if="item.icon" :name="item.icon" class="text-[0.85em]" />
        <span>{{ item.label }}</span>
      </NuxtLink>
      <!-- Current page (not clickable) -->
      <span v-else class="text-slate-700 dark:text-slate-200 font-medium flex items-center gap-1.5">
        <Icon v-if="item.icon" :name="item.icon" class="text-[0.85em]" />
        <span>{{ item.label }}</span>
      </span>
      <Icon v-if="i < items.length - 1" name="chevronRight" class="text-slate-300 dark:text-slate-600 text-xs" />
    </template>
  </nav>
</template>

<script setup lang="ts">
export interface BreadcrumbItem {
  label: string
  to?: string
  icon?: string
}
defineProps<{ items: BreadcrumbItem[] }>()
</script>
