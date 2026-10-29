<template>
  <div class="space-y-3">
    <div v-for="i in rows" :key="i" class="skeleton h-4" :style="{ width: widthFor(i) }" />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 3 })

function widthFor(i: number) {
  const widths = ['100%', '85%', '92%', '70%', '95%', '80%']
  return widths[(i - 1) % widths.length]
}
</script>
