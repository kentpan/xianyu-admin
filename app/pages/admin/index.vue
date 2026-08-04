<template>
  <div />
</template>

<script setup lang="ts">
definePageMeta({ layout: false })
// /admin 默认重定向到用户管理；认证由 auth.global.ts 统一处理
await navigateTo('/admin/users', { replace: true })
</script>
