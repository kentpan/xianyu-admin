<template>
  <NuxtLink
    :to="item.path"
    :title="!showLabel ? item.label : undefined"
    class="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150"
    :class="[
      !showLabel && 'justify-center px-2',
      active
        ? 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm'
        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10',
    ]"
    @click="$emit('navigate')"
  >
    <Icon :name="item.icon" class="w-4 h-4 shrink-0" />
    <span v-if="showLabel" class="truncate">{{ item.label }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
import type { NavItem } from '~/composables/useNav'
defineProps<{ item: NavItem; showLabel: boolean; active: boolean }>()
defineEmits<{ navigate: [] }>()
</script>
