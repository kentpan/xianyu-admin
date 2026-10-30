<template>
  <div class="flex items-center gap-1.5 mt-1 flex-wrap">
    <span class="text-slate-400">可用变量(点击插入):</span>
    <button
      v-for="v in varList"
      :key="v.token"
      type="button"
      class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300 hover:bg-brand-100 hover:text-brand-700 dark:hover:bg-brand-900/30 dark:hover:text-brand-300 cursor-pointer transition-colors"
      :title="v.label"
      @click.prevent="$emit('insert', v.token)"
    >
      {{ v.token }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ inline?: boolean }>()
defineEmits<{ (e: 'insert', token: string): void }>()

const varList = [
  { token: '{title}', label: '商品名称' },
  { token: '{price}', label: '价格' },
  { token: '{username}', label: '买家闲鱼昵称' },
  { token: '{userid}', label: '买家用户ID' },
  { token: '{apikey}', label: '鉴权密钥 (API 卡券)' },
  { token: '{shareURL}', label: '接口返回的资源交付分享URL (API 卡券)' },
]
</script>
