<template>
  <div />
</template>

<script setup lang="ts">
definePageMeta({ layout: false })
// 根路径重定向到 /dashboard；认证与安装检查由 auth.global.ts 统一处理
await navigateTo('/dashboard', { replace: true })
</script>
