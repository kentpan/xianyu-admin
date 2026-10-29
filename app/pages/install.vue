<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-slate-50 to-slate-100 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-4">
    <div class="w-full max-w-2xl">
      <!-- Brand header -->
      <div class="text-center mb-6">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30">
          <Icon name="fish" class="text-white text-2xl" />
        </div>
        <h1 class="mt-4 text-2xl font-bold text-slate-900 dark:text-white">闲鱼超级管家 · 系统安装</h1>
        <p class="mt-1.5 text-sm text-slate-500 dark:text-slate-400">首次使用请完成初始化配置，仅此一次</p>
      </div>

      <!-- Runtime badge -->
      <div class="flex items-center justify-center gap-2 mb-4">
        <span class="badge" :class="runtime === 'cloudflare' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'">
          <Icon :name="runtime === 'cloudflare' ? 'cloud' : 'server'" />
          {{ runtime === 'cloudflare' ? 'Cloudflare Pages 环境' : 'Node.js 环境' }}
        </span>
        <span v-if="runtime === 'cloudflare'" class="text-xs text-slate-400">环境变量将通过 Cloudflare API 设置</span>
        <span v-else class="text-xs text-slate-400">配置将写入 .env 文件</span>
      </div>

      <!-- Stepper -->
      <div class="flex items-center justify-center gap-2 mb-6">
        <template v-for="(s, i) in steps" :key="s.key">
          <div class="flex items-center gap-2">
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors"
              :class="stepIndex >= i ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700'"
            >
              <Icon v-if="stepIndex > i" name="check" />
              <span v-else>{{ i + 1 }}</span>
            </div>
            <span class="text-sm hidden sm:inline" :class="stepIndex >= i ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-400'">{{ s.label }}</span>
            <Icon v-if="i < steps.length - 1" name="chevronRight" class="text-slate-300 mx-1" />
          </div>
        </template>
      </div>

      <div class="card p-6 md:p-8">
        <!-- Step 0: Environment & Database -->
        <div v-show="stepIndex === 0">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-1">选择运行环境与数据库</h2>
          <p class="text-sm text-slate-500 mb-5">支持多数据库无缝切换，可在不同环境间迁移</p>

          <div class="space-y-4">
            <div>
              <label class="label">数据库类型</label>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                <button
                  v-for="opt in dbOptions"
                  :key="opt.value"
                  type="button"
                  class="p-3 rounded-lg border-2 text-left transition-all"
                  :class="form.dbDriver === opt.value ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'"
                  @click="form.dbDriver = opt.value"
                >
                  <Icon :name="opt.icon" class="text-lg" :class="form.dbDriver === opt.value ? 'text-brand-600' : 'text-slate-400'" />
                  <p class="text-sm font-medium mt-1.5 text-slate-800 dark:text-slate-100">{{ opt.label }}</p>
                  <p class="text-xs text-slate-400 mt-0.5">{{ opt.desc }}</p>
                </button>
              </div>
            </div>

            <!-- SQLite config -->
            <div v-if="form.dbDriver === 'sqlite'" class="space-y-3">
              <div>
                <label class="label">数据库文件路径</label>
                <input v-model="form.dbUrl" class="input" placeholder="prisma/xianyu_admin.db" />
                <p class="text-xs text-slate-400 mt-1">留空使用默认路径 prisma/xianyu_admin.db</p>
              </div>
            </div>

            <!-- MySQL config -->
            <div v-if="form.dbDriver === 'mysql'" class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="label">主机地址</label>
                <input v-model="form.dbHost" class="input" placeholder="127.0.0.1" />
              </div>
              <div>
                <label class="label">端口</label>
                <input v-model="form.dbPort" class="input" placeholder="3306" />
              </div>
              <div>
                <label class="label">用户名</label>
                <input v-model="form.dbUser" class="input" placeholder="root" />
              </div>
              <div>
                <label class="label">密码</label>
                <input v-model="form.dbPassword" type="password" class="input" placeholder="••••••" />
              </div>
              <div class="md:col-span-2">
                <label class="label">数据库名</label>
                <input v-model="form.dbName" class="input" placeholder="xianyu_admin" />
              </div>
            </div>

            <!-- Cloudflare D1 config -->
            <div v-if="form.dbDriver === 'd1'" class="space-y-3">
              <div class="rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 p-3 text-sm text-sky-700 dark:text-sky-300">
                <Icon name="info" class="inline mr-1" /> Cloudflare D1 模式：部署到 Cloudflare 时通过 D1 绑定（env.DB）使用。需要在 wrangler.toml 中配置 D1 数据库绑定。
              </div>
              <div v-if="runtime === 'cloudflare'">
                <p class="text-xs text-slate-400 mb-2">检测到 Cloudflare 环境，D1 绑定将通过 wrangler.toml 配置，无需在此填写连接信息。</p>
              </div>
              <div v-else>
                <p class="text-xs text-amber-600 dark:text-amber-400">当前为 Node.js 环境，D1 不可用。请切换到 SQLite 或部署到 Cloudflare 后使用 D1。</p>
              </div>
            </div>

            <div v-if="form.dbDriver === 'memory'" class="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-300">
              <Icon name="alert" class="inline mr-1" /> 内存模式：数据不持久化，仅用于体验演示，重启后丢失。
            </div>

            <!-- Cloudflare API config (only on Cloudflare runtime) -->
            <div v-if="runtime === 'cloudflare'" class="rounded-lg border-2 border-orange-200 dark:border-orange-800 p-4 space-y-3">
              <div class="flex items-center gap-2">
                <Icon name="cloud" class="text-orange-500" />
                <p class="text-sm font-medium text-slate-800 dark:text-slate-100">Cloudflare API 配置</p>
              </div>
              <p class="text-xs text-slate-400">在 Cloudflare Pages 上 .env 不可写，需要通过 API 设置环境变量。请在 Cloudflare 控制台获取以下信息。</p>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="label">Account ID <span class="text-xs text-slate-400">(账户ID)</span></label>
                  <input v-model="form.cfAccountId" class="input" placeholder="在 Cloudflare 仪表盘右侧可以看到" />
                </div>
                <div>
                  <label class="label">Pages 项目名</label>
                  <input v-model="form.cfProjectName" class="input" placeholder="如 xianyu-admin" />
                </div>
                <div class="md:col-span-2">
                  <label class="label">API Token <span class="text-xs text-slate-400">(需要 Cloudflare Pages Edit 权限)</span></label>
                  <input v-model="form.cfApiToken" type="password" class="input" placeholder="在 Cloudflare API Tokens 页面创建" />
                  <p class="text-xs text-slate-400 mt-1">Token 仅用于本次安装设置环境变量，不会保存。权限选择 "Cloudflare Pages - Edit"。</p>
                </div>
              </div>
              <div class="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2.5 text-xs text-slate-500">
                <Icon name="info" class="inline mr-1" /> 安装完成后需要重新部署 Pages 项目，新的环境变量才会生效。
              </div>
            </div>
          </div>
        </div>

        <!-- Step 1: Secrets -->
        <div v-show="stepIndex === 1">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-1">配置安全密钥</h2>
          <p class="text-sm text-slate-500 mb-5">用于管理后台访问校验与 JWT 签发</p>
          <div class="space-y-4">
            <div>
              <div class="flex items-center justify-between">
                <label class="label">ADMIN_SECRET 管理密钥</label>
                <button type="button" class="text-xs text-brand-600 hover:underline" @click="form.adminSecret = genSecret(24)">随机生成</button>
              </div>
              <div class="relative">
                <input v-model="form.adminSecret" :type="showSecret ? 'text' : 'password'" class="input pr-10" placeholder="至少 6 位" />
                <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400" @click="showSecret = !showSecret">
                  <Icon :name="showSecret ? 'eyeOff' : 'eye'" />
                </button>
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between">
                <label class="label">JWT_SECRET 令牌密钥</label>
                <button type="button" class="text-xs text-brand-600 hover:underline" @click="form.jwtSecret = genSecret(32)">随机生成</button>
              </div>
              <input v-model="form.jwtSecret" class="input" placeholder="至少 16 位" />
            </div>
            <div class="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-500">
              <Icon name="shield" class="inline mr-1 text-brand-500" />
              <template v-if="runtime === 'cloudflare'">密钥将通过 Cloudflare API 设置为 Pages 环境变量，安全存储于 Cloudflare。</template>
              <template v-else>密钥将写入 .env 文件并永久保存，可在 .env 中修改。请妥善保管。</template>
            </div>
          </div>
        </div>

        <!-- Step 2: Admin account -->
        <div v-show="stepIndex === 2">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-1">创建管理员账号</h2>
          <p class="text-sm text-slate-500 mb-5">首个账号将自动获得管理员权限</p>
          <div class="space-y-4">
            <div>
              <label class="label">管理员用户名</label>
              <input v-model="form.adminUsername" class="input" placeholder="admin" />
            </div>
            <div>
              <label class="label">邮箱</label>
              <input v-model="form.adminEmail" type="email" class="input" placeholder="admin@example.com" />
            </div>
            <div>
              <label class="label">密码</label>
              <input v-model="form.adminPassword" type="password" class="input" placeholder="至少 6 位" />
            </div>
          </div>
        </div>

        <!-- Step 3: Confirm -->
        <div v-show="stepIndex === 3">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-1">确认配置</h2>
          <p class="text-sm text-slate-500 mb-5">请核对以下信息，确认后将{{ runtime === 'cloudflare' ? '通过 Cloudflare API 设置环境变量' : '写入 .env' }}并初始化数据库</p>
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            <div v-for="row in summary" :key="row.label" class="flex items-center justify-between px-4 py-2.5 text-sm">
              <span class="text-slate-500">{{ row.label }}</span>
              <span class="font-medium text-slate-800 dark:text-slate-100 max-w-[60%] truncate">{{ row.value }}</span>
            </div>
          </div>
          <div v-if="runtime === 'cloudflare'" class="mt-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 p-3 text-xs text-orange-700 dark:text-orange-300">
            <Icon name="alert" class="inline mr-1" /> 安装完成后需要重新部署 Cloudflare Pages 项目，环境变量才会生效。
          </div>
        </div>

        <!-- Footer nav -->
        <div class="flex items-center justify-between mt-6 pt-5 border-t border-slate-100 dark:border-slate-700">
          <button v-if="stepIndex > 0" class="btn-secondary" @click="stepIndex--">上一步</button>
          <div v-else />
          <button v-if="stepIndex < steps.length - 1" class="btn-primary" @click="next">下一步</button>
          <button v-else class="btn-primary" :disabled="installing" @click="doInstall">
            <Icon v-if="installing" name="refresh" class="animate-spin" />
            {{ installing ? '正在安装...' : '完成安装' }}
          </button>
        </div>
      </div>

      <p class="text-center text-xs text-slate-400 mt-4">闲鱼超级管家 · 基于 Nuxt 4 + Tailwind 3 构建</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { installSystem } from '~/api/install'
import { getSystemStatus } from '~/api/system'
import { useToast } from '~/composables/useToast'

definePageMeta({ layout: false })

const toast = useToast()
const router = useRouter()

const steps = [
  { key: 'env', label: '环境与数据库' },
  { key: 'secrets', label: '安全密钥' },
  { key: 'admin', label: '管理员账号' },
  { key: 'confirm', label: '确认' },
]
const stepIndex = ref(0)
const showSecret = ref(false)
const installing = ref(false)
const runtime = ref<'node' | 'cloudflare'>('node')

// Detect runtime on mount
onMounted(async () => {
  try {
    const data = await getSystemStatus()
    runtime.value = data.runtime || 'node'
  } catch {
    // default node
  }
})

const dbOptions = [
  { value: 'sqlite', label: 'SQLite', desc: '本地文件，零配置', icon: 'database' },
  { value: 'mysql', label: 'MySQL', desc: '自建/云数据库', icon: 'server' },
  { value: 'd1', label: 'Cloudflare D1', desc: 'Serverless', icon: 'database' },
  { value: 'memory', label: '内存模式', desc: '演示体验', icon: 'activity' },
]

const form = reactive({
  dbDriver: 'sqlite',
  dbUrl: 'prisma/xianyu_admin.db',
  dbHost: '127.0.0.1',
  dbPort: '3306',
  dbUser: 'root',
  dbPassword: '',
  dbName: 'xianyu_admin',
  adminSecret: '',
  jwtSecret: '',
  adminUsername: 'admin',
  adminEmail: '',
  adminPassword: '',
  // Cloudflare
  cfAccountId: '',
  cfApiToken: '',
  cfProjectName: '',
})

const summary = computed(() => {
  const rows = [
    { label: '运行环境', value: runtime.value === 'cloudflare' ? 'Cloudflare Pages' : 'Node.js' },
    { label: '数据库类型', value: dbOptions.find((d) => d.value === form.dbDriver)?.label },
  ]
  if (form.dbDriver === 'mysql') {
    rows.push({ label: '主机', value: `${form.dbHost}:${form.dbPort}/${form.dbName}` })
  } else if (form.dbDriver === 'sqlite') {
    rows.push({ label: '路径', value: form.dbUrl })
  }
  rows.push(
    { label: 'ADMIN_SECRET', value: '••••••••' + form.adminSecret.slice(-4) },
    { label: 'JWT_SECRET', value: '••••••••' + form.jwtSecret.slice(-4) },
    { label: '管理员', value: form.adminUsername },
    { label: '邮箱', value: form.adminEmail },
  )
  if (runtime.value === 'cloudflare' && form.cfAccountId) {
    rows.push({ label: 'CF Account', value: form.cfAccountId })
    rows.push({ label: 'CF 项目', value: form.cfProjectName })
  }
  return rows
})

function genSecret(len: number) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length]
  return s
}

function next() {
  if (stepIndex.value === 0) {
    if (form.dbDriver === 'mysql' && (!form.dbHost || !form.dbUser || !form.dbName)) {
      toast.error('请填写完整的 MySQL 连接信息')
      return
    }
    if (form.dbDriver === 'd1' && runtime.value !== 'cloudflare') {
      toast.error('D1 仅在 Cloudflare 环境下可用')
      return
    }
    if (runtime.value === 'cloudflare' && (!form.cfAccountId || !form.cfApiToken || !form.cfProjectName)) {
      toast.error('请填写完整的 Cloudflare API 配置')
      return
    }
  }
  if (stepIndex.value === 1) {
    if (!form.adminSecret || form.adminSecret.length < 6) return toast.error('ADMIN_SECRET 至少 6 位')
    if (!form.jwtSecret || form.jwtSecret.length < 16) return toast.error('JWT_SECRET 至少 16 位')
  }
  if (stepIndex.value === 2) {
    if (!form.adminUsername || !form.adminEmail || !form.adminPassword) return toast.error('请填写完整的管理员信息')
    if (form.adminPassword.length < 6) return toast.error('管理员密码至少 6 位')
  }
  stepIndex.value++
}

async function doInstall() {
  installing.value = true
  try {
    const r = await installSystem(form)
    toast.success(r.message || '安装完成，正在跳转登录...')
    const installed = useState<boolean | null>('sys_installed', () => null)
    installed.value = true
    setTimeout(() => router.push('/login'), 1200)
  } catch (e: any) {
    toast.error(e.message || '安装失败')
  } finally {
    installing.value = false
  }
}
</script>
