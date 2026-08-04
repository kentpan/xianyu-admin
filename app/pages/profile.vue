<template>
  <div class="space-y-5 animate-fade-in max-w-3xl">
    <PageHeader title="个人中心" description="管理账号信息、密码与界面偏好" />

    <div v-if="loading" class="card p-10 flex items-center justify-center text-slate-400">
      <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
    </div>

    <template v-else>
      <!-- Profile card -->
      <div class="card p-6">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-brand-500/30">
            {{ initial }}
          </div>
          <div class="min-w-0">
            <h3 class="text-lg font-semibold text-slate-900 dark:text-white">{{ profile?.user.username }}</h3>
            <p class="text-sm text-slate-500 dark:text-slate-400">{{ profile?.user.email }}</p>
            <div class="flex items-center gap-2 mt-1.5">
              <span v-if="profile?.user.is_admin" class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">管理员</span>
              <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">已激活</span>
              <span class="text-xs text-slate-400">注册于 {{ formatTime(profile?.user.created_at) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Change password -->
      <div class="card p-6">
        <h3 class="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Icon name="lock" class="text-brand-500" /> 修改密码
        </h3>
        <div class="space-y-4 max-w-md">
          <div>
            <label class="label">当前密码</label>
            <div class="relative">
              <input v-model="pwdForm.current" :type="showCur ? 'text' : 'password'" class="input pr-10" placeholder="输入当前密码" />
              <button class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400" @click="showCur = !showCur">
                <Icon :name="showCur ? 'eyeOff' : 'eye'" />
              </button>
            </div>
          </div>
          <div>
            <label class="label">新密码 <span class="text-xs text-slate-400">(至少 6 位)</span></label>
            <div class="relative">
              <input v-model="pwdForm.next" :type="showNew ? 'text' : 'password'" class="input pr-10" placeholder="输入新密码" />
              <button class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400" @click="showNew = !showNew">
                <Icon :name="showNew ? 'eyeOff' : 'eye'" />
              </button>
            </div>
          </div>
          <div>
            <label class="label">确认新密码</label>
            <input v-model="pwdForm.confirm" type="password" class="input" placeholder="再次输入新密码" />
          </div>
          <div class="flex items-center gap-2">
            <button class="btn-primary" :disabled="changingPwd" @click="changePassword">
              <Icon v-if="changingPwd" name="refresh" class="animate-spin" />
              <Icon v-else name="save" /> 修改密码
            </button>
          </div>
        </div>
      </div>

      <!-- Preferences -->
      <div class="card p-6">
        <h3 class="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Icon name="settings" class="text-brand-500" /> 界面偏好
        </h3>
        <div class="space-y-4 max-w-md">
          <div class="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
            <div>
              <p class="text-sm font-medium text-slate-700 dark:text-slate-200">主题模式</p>
              <p class="text-xs text-slate-400">选择默认的深浅色主题</p>
            </div>
            <div class="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              <button class="px-3 py-1 rounded-md text-sm transition-colors" :class="prefs.theme === 'light' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'" @click="prefs.theme = 'light'">浅色</button>
              <button class="px-3 py-1 rounded-md text-sm transition-colors" :class="prefs.theme === 'dark' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500'" @click="prefs.theme = 'dark'">深色</button>
            </div>
          </div>
          <div class="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
            <div>
              <p class="text-sm font-medium text-slate-700 dark:text-slate-200">侧边栏默认收起</p>
              <p class="text-xs text-slate-400">登录后侧边栏默认为收起状态</p>
            </div>
            <button class="relative w-11 h-6 rounded-full transition-colors" :class="prefs.sidebar_default_collapsed ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600'" @click="prefs.sidebar_default_collapsed = !prefs.sidebar_default_collapsed">
              <span class="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform" :class="prefs.sidebar_default_collapsed ? 'translate-x-5' : 'translate-x-0.5'" />
            </button>
          </div>
          <div class="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
            <div>
              <p class="text-sm font-medium text-slate-700 dark:text-slate-200">通知声音</p>
              <p class="text-xs text-slate-400">收到新通知时播放提示音</p>
            </div>
            <button class="relative w-11 h-6 rounded-full transition-colors" :class="prefs.notification_sound ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600'" @click="prefs.notification_sound = !prefs.notification_sound">
              <span class="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform" :class="prefs.notification_sound ? 'translate-x-5' : 'translate-x-0.5'" />
            </button>
          </div>
          <div class="flex items-center justify-between py-2">
            <div>
              <p class="text-sm font-medium text-slate-700 dark:text-slate-200">每页显示条数</p>
              <p class="text-xs text-slate-400">表格分页的默认每页数量</p>
            </div>
            <select v-model.number="prefs.items_per_page" class="input !w-auto">
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </div>
          <div class="pt-2">
            <button class="btn-primary" :disabled="savingPrefs" @click="savePrefs">
              <Icon v-if="savingPrefs" name="refresh" class="animate-spin" />
              <Icon v-else name="save" /> 保存偏好
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const api = useApi()
const toast = useToast()

const loading = ref(true)
const profile = ref<{ user: any; preferences: any } | null>(null)
const initial = computed(() => (profile.value?.user.username?.[0] || 'U').toUpperCase())

const pwdForm = reactive({ current: '', next: '', confirm: '' })
const showCur = ref(false)
const showNew = ref(false)
const changingPwd = ref(false)

const prefs = reactive({
  theme: 'light',
  sidebar_default_collapsed: false,
  notification_sound: true,
  items_per_page: 20,
})
const savingPrefs = ref(false)

async function loadProfile() {
  loading.value = true
  try {
    const r = await api.get<{ user: any; preferences: any }>('/api/user/profile')
    profile.value = r
    Object.assign(prefs, r.preferences)
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function changePassword() {
  if (!pwdForm.current || !pwdForm.next) return toast.warning('请填写当前密码和新密码')
  if (pwdForm.next !== pwdForm.confirm) return toast.warning('两次新密码不一致')
  if (pwdForm.next.length < 6) return toast.warning('新密码至少 6 位')
  changingPwd.value = true
  try {
    await api.post('/api/auth/change-password', { currentPassword: pwdForm.current, newPassword: pwdForm.next })
    toast.success('密码修改成功')
    pwdForm.current = ''
    pwdForm.next = ''
    pwdForm.confirm = ''
  } catch (e: any) {
    toast.error(e.message || '修改失败')
  } finally {
    changingPwd.value = false
  }
}

async function savePrefs() {
  savingPrefs.value = true
  try {
    await api.put('/api/user/profile', { preferences: prefs })
    toast.success('偏好设置已保存')
    // Apply theme immediately
    if (import.meta.client) {
      document.documentElement.classList.toggle('dark', prefs.theme === 'dark')
      localStorage.setItem('color_mode', prefs.theme)
    }
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    savingPrefs.value = false
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(String(t).replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleDateString('zh-CN')
}

onMounted(loadProfile)
</script>
