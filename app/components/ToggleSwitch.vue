<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    class="relative inline-flex items-center justify-start w-10 h-6 p-0.5 rounded-full transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
    :class="modelValue ? 'bg-brand-600' : 'bg-slate-200 dark:bg-slate-700'"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span
      class="w-5 h-5 rounded-full bg-white shadow transform transition-transform"
      :class="modelValue ? 'translate-x-4' : 'translate-x-0'"
    />
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: boolean
  disabled?: boolean
}>(), {
  disabled: false,
})

defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
