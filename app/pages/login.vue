<template>
  <div class="w-full">
    <div class="text-center mb-6">
      <div class="w-14 h-14 mx-auto rounded-2xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30">
        <Icon name="fish" class="text-white text-2xl" />
      </div>
      <h1 class="mt-4 text-xl font-bold text-slate-900 dark:text-white">欢迎回来</h1>
      <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">登录闲鱼超级管家管理后台</p>
    </div>

    <div class="card p-6">
      <form class="space-y-4" @submit.prevent="handleLogin">
        <div>
          <label class="label">用户名</label>
          <input v-model="username" class="input" placeholder="请输入用户名" autocomplete="username" />
        </div>
        <div>
          <label class="label">密码</label>
          <div class="relative">
            <input
              v-model="password"
              :type="showPwd ? 'text' : 'password'"
              class="input pr-10"
              placeholder="请输入密码"
              autocomplete="current-password"
            />
            <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400" @click="showPwd = !showPwd">
              <Icon :name="showPwd ? 'eyeOff' : 'eye'" />
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between text-sm">
          <label class="flex items-center gap-2 text-slate-600 dark:text-slate-300 cursor-pointer">
            <input v-model="remember" type="checkbox" class="rounded border-slate-300 text-brand-500 focus:ring-brand-500" />
            记住我
          </label>
          <NuxtLink v-if="registrationEnabled" to="/register" class="text-brand-600 hover:underline">没有账号？注册</NuxtLink>
        </div>

        <button type="submit" class="btn-primary w-full" :disabled="loading">
          <Icon v-if="loading" name="refresh" class="animate-spin" />
          {{ loading ? '登录中...' : '登 录' }}
        </button>
      </form>
    </div>

    <p class="text-center text-xs text-slate-400 mt-4">闲鱼超级管家 · 基于 Nuxt 4 + Tailwind 3</p>
  </div>
</template>

<script setup lang="ts">
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'
import { getPublicSettings } from '~/api/settings'

definePageMeta({ layout: 'auth' })

const { login } = useAuth()
const toast = useToast()
const router = useRouter()

const username = ref('')
const password = ref('')
const showPwd = ref(false)
const remember = ref(true)
const loading = ref(false)

const registrationEnabled = ref(false)
onMounted(async () => {
  try {
    const data = await getPublicSettings()
    registrationEnabled.value = !!data?.settings?.registration_enabled
  } catch {}
})

async function handleLogin() {
  if (!username.value || !password.value) return toast.warning('请输入用户名和密码')
  loading.value = true
  try {
    await login(username.value, password.value)
    toast.success('登录成功')
    router.push('/dashboard')
  } catch (e: any) {
    toast.error(e.message || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>
