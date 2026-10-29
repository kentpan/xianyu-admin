<template>
  <ModalBase
    :model-value="state.open"
    :title="`风控人工验证${state.label ? ' · ' + state.label : ''}`"
    size="xl"
    @close="onClose"
  >
    <div class="space-y-3">
      <!-- 状态条 -->
      <div class="flex items-center flex-wrap gap-2 text-slate-600 dark:text-slate-300">
        <span class="badge bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
          <Icon name="shield" /> IM token 连败 {{ verifyInfo.streak }} 次
        </span>
        <span v-if="verifyInfo.state" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {{ stateLabel(verifyInfo.state) }}
        </span>
        <span class="text-slate-400">账号 {{ state.cookieId }}</span>
      </div>

      <p class="text-slate-600 dark:text-slate-300 leading-relaxed">
        下方是<strong>闲鱼官方验证页</strong>（真实 h5api.m.goofish.com 页面原样加载，无代理无截图无后端浏览器）。
        直接<strong>按住并拖动滑块</strong>到最右；通过后官方页面会把 x5sec 凭证自动回传本弹窗，
        合并进账号 Cookie 并自动重试 Token 恢复监听。
      </p>

      <!-- 准备中 (读本地状态, 零闲鱼请求) -->
      <div v-if="phase === 'preparing'" class="p-8 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 正在加载验证页...
      </div>

      <!-- 官方验证页 (iframe 直连) -->
      <template v-else-if="phase === 'live'">
        <div
          v-if="challengeSrc"
          class="relative rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900"
        >
          <iframe
            :key="iframeKey"
            :src="challengeSrc"
            class="block w-full border-0"
            style="height: 480px"
            title="闲鱼官方滑块验证页"
          ></iframe>
        </div>
        <!-- 官方契约依赖父窗口存在子框架 (window.frames.length 比对), 隐藏占位保证分支必进 -->
        <iframe src="about:blank" class="hidden" aria-hidden="true" tabindex="-1"></iframe>
        <p class="text-slate-400 leading-relaxed">
          在上方页面中按住滑块拖到最右即可，通过后会自动继续，无需其他操作。若页面提示过期/报错，
          点「获取 Token」换新挑战再拖一次；拖动后长时间无响应可点「验证完成，重试 Token」。
        </p>
      </template>

      <!-- 无挑战链接 (引擎失败瞬间未返回 punish 链接) -->
      <div v-else-if="phase === 'nochallenge'" class="p-8 text-center">
        <div class="w-12 h-12 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
          <Icon name="info" class="text-slate-400 text-xl" />
        </div>
        <p class="text-slate-600 dark:text-slate-300">当前没有可用的风控挑战链接</p>
        <p class="text-slate-400 mt-1">点「获取 Token」实调一次：未被拦截则直接恢复监听，被拦截则拿到新挑战继续验证</p>
      </div>

      <!-- 重试 Token 中 -->
      <div v-else-if="phase === 'verifying'" class="p-8 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 正在合并凭证并重试 IM Token...
      </div>

      <!-- 成功 -->
      <div v-else-if="phase === 'success'" class="p-8 text-center">
        <div class="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-3">
          <Icon name="check" class="text-emerald-600 dark:text-emerald-400 text-xl" />
        </div>
        <p class="font-medium text-emerald-600 dark:text-emerald-400">Token 获取成功，监听链路恢复中</p>
        <p class="text-slate-400 mt-1">弹窗即将自动关闭</p>
      </div>

      <!-- 需重新扫码 -->
      <div v-else-if="phase === 'auth'" class="p-8 text-center">
        <div class="w-12 h-12 mx-auto rounded-full bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center mb-3">
          <Icon name="alert" class="text-rose-600 dark:text-rose-400 text-xl" />
        </div>
        <p class="font-medium text-rose-600 dark:text-rose-400">登录态已失效</p>
        <p class="text-slate-500 dark:text-slate-400 mt-1">请到「账号管理」对该账号重新扫码登录，无需滑块验证</p>
      </div>

      <!-- 其他错误 -->
      <div v-else-if="phase === 'failed'" class="p-8 text-center">
        <div class="w-12 h-12 mx-auto rounded-full bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center mb-3">
          <Icon name="alert" class="text-rose-600 dark:text-rose-400 text-xl" />
        </div>
        <p class="font-medium text-rose-600 dark:text-rose-400">{{ failMessage }}</p>
        <p class="text-slate-400 mt-1">可点击下方「重试」再试一次</p>
      </div>
    </div>

    <template #footer>
      <button class="btn-secondary" @click="onClose">稍后再说</button>
      <template v-if="phase === 'live'">
        <button class="btn-secondary" :disabled="busy" @click="reloadChallenge">
          <Icon name="refresh" /> 重载验证页
        </button>
        <button class="btn-primary" :disabled="busy" @click="retryToken">
          <Icon name="check" /> 验证完成，重试 Token
        </button>
      </template>
      <button v-else-if="phase === 'nochallenge' || phase === 'failed'" class="btn-primary" :disabled="busy" @click="retryToken">
        <Icon name="external" /> 获取 Token
      </button>
    </template>
  </ModalBase>
</template>

<script setup lang="ts">
import { manualFetchToken, postVerifyX5sec, getVerifyState, postVerifyHold, type VerifyStateInfo } from '~/api/listener'
import { useToast } from '~/composables/useToast'

const toast = useToast()
const config = useRuntimeConfig()
const { state, closeVerify, refreshFrame, dismiss } = useVerifyGuard()

type Phase = 'preparing' | 'live' | 'nochallenge' | 'verifying' | 'success' | 'auth' | 'failed'
const phase = ref<Phase>('preparing')
const busy = ref(false)
const failMessage = ref('')
const verifyInfo = reactive<{ streak: number; state: string }>({ streak: 0, state: '' })
const iframeKey = ref(0)

function stateLabel(s: string): string {
  const map: Record<string, string> = {
    listening: '监听中',
    connecting: '连接中',
    reconnecting: '重连中',
    risk_cooldown: '风控冷却',
    error: '连接异常',
    need_relogin: '需重新扫码',
    engine_offline: '引擎离线',
    disabled: '已停用',
  }
  return map[s] || s
}

/* ---------------- 官方验证页 iframe ---------------- */

/**
 * 官方契约 (punishpage.min.js): 挑战页 URL 携带 addCookieToHeader 且处于 iframe 中时,
 * 滑块通过后页面从 bx-x5sec 响应头取凭证 postMessage 给父窗口 (target=*)。
 */
const challengeSrc = computed(() => {
  const raw = state.value.punishUrl
  if (!raw) return ''
  return raw + (raw.includes('?') ? '&' : '?') + 'addCookieToHeader=1'
})

function reloadChallenge() {
  iframeKey.value++
}

/** 官方验证页来源白名单 (消息只信 goofish/taobao 域)。 */
function trustedOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname
    return h === 'goofish.com' || h.endsWith('.goofish.com') || h === 'taobao.com' || h.endsWith('.taobao.com')
  } catch {
    return false
  }
}

/**
 * 官方回传载荷: {type:'child', content:'{"smToken":...,"x5sec":"{\"value\":..,\"expire\":..,\"host\":..}"}'}
 * 只取 x5sec 凭证, 其余 (resizeIframe/sm3Token 等) 忽略。
 */
async function onMessage(ev: MessageEvent) {
  if (!state.value.open || !state.value.cookieId || busy.value) return
  if (phase.value !== 'live' && phase.value !== 'verifying') return
  if (!trustedOrigin(String(ev.origin || ''))) return
  let outer: any
  try { outer = JSON.parse(ev.data) } catch { return }
  if (outer?.type !== 'child' || typeof outer.content !== 'string') return
  let content: any
  try { content = JSON.parse(outer.content) } catch { return }
  if (!content?.x5sec) return
  let value = ''
  try { value = String(JSON.parse(content.x5sec).value || '') } catch { return }
  if (!value) {
    // 官方未下发凭证 (bx-x5sec 缺失) — 引导用户换新挑战
    toast.warning('官方页面未返回验证凭证, 请点「获取 Token」换新挑战重试')
    return
  }
  busy.value = true
  phase.value = 'verifying'
  try {
    const r = await postVerifyX5sec(state.value.cookieId, value)
    if (r.ok) {
      phase.value = 'success'
      verifyInfo.streak = 0
      releaseHold()
      toast.success(r.message || '滑块验证通过, Token 获取成功, 监听恢复中')
      setTimeout(() => closeVerify(), 1800)
      return
    }
    if (r.verdict === 'risk' && r.punish_url) {
      // 凭证未被网关接受 (过期/单次有效) → 换新挑战继续人工验证
      verifyInfo.streak += 1
      refreshFrame(r.punish_url)
      toast.warning(r.message || '验证已通过但 Token 仍受限, 已换新挑战, 请重新拖动')
      busy.value = false
      phase.value = 'live'
      reloadChallenge()
      return
    }
    if (r.verdict === 'auth') {
      phase.value = 'auth'
      return
    }
    failMessage.value = r.message || 'Token 获取未成功'
    phase.value = 'failed'
  } catch (e: any) {
    failMessage.value = e?.message || '请求失败'
    phase.value = 'failed'
  } finally {
    busy.value = false
  }
}

/* ---------------- 弹窗生命周期 ---------------- */

/** 弹窗打开 / 换新挑战: 读本地状态 (零闲鱼请求) → 有挑战链接则直接加载官方验证页 */
async function prepare() {
  if (!state.value.cookieId) return
  phase.value = 'preparing'
  try {
    const r: VerifyStateInfo = await getVerifyState(state.value.cookieId)
    verifyInfo.streak = r.streak
    verifyInfo.state = r.state
    if (r.punish_url) refreshFrame(r.punish_url)
  } catch {}
  if (state.value.punishUrl) {
    reloadChallenge()
    phase.value = 'live'
  } else {
    phase.value = 'nochallenge'
  }
}

/** 用户主动触发 (获取 Token / 重试): 换新挑战或直接恢复监听。 */
async function retryToken() {
  if (!state.value.cookieId) return
  busy.value = true
  phase.value = 'verifying'
  try {
    const r = await manualFetchToken(state.value.cookieId)
    if (r.ok) {
      phase.value = 'success'
      verifyInfo.streak = 0
      releaseHold()
      toast.success(r.message || 'Token 获取成功, 监听恢复中')
      setTimeout(() => closeVerify(), 1800)
      return
    }
    if (r.verdict === 'risk' && r.punish_url) {
      verifyInfo.streak += 1
      refreshFrame(r.punish_url)
      toast.warning(r.message || '仍被风控拦截, 已换新挑战, 请拖动滑块')
      busy.value = false
      phase.value = 'live'
      reloadChallenge()
      return
    }
    if (r.verdict === 'auth') {
      phase.value = 'auth'
      return
    }
    failMessage.value = r.message || 'Token 获取未成功'
    phase.value = 'failed'
  } catch (e: any) {
    failMessage.value = e?.message || '请求失败'
    phase.value = 'failed'
  } finally {
    busy.value = false
  }
}

function releaseHold() {
  if (state.value.cookieId) {
    postVerifyHold(state.value.cookieId, false).catch(() => {})
  }
}

function onClose() {
  releaseHold()
  if (state.value.cookieId) {
    dismiss(state.value.cookieId)
  } else {
    closeVerify()
  }
}

watch(
  () => state.value.open,
  (open) => {
    if (open && state.value.cookieId) {
      verifyInfo.streak = 0
      verifyInfo.state = ''
      // 持有期: 引擎对该账号静默, 保证人工验证期间挑战不被引擎作废
      postVerifyHold(state.value.cookieId, true).catch(() => {})
      void prepare()
    }
  },
)

/** 官方凭证回传监听 + 全局自动触发 (SSE 连败 ≥2 推送), 弹窗存活期间生效 */
let alertEs: EventSource | null = null
onMounted(() => {
  window.addEventListener('message', onMessage)
  if (!import.meta.client) return
  const { openVerify, recentlyDismissed } = useVerifyGuard()
  try {
    const base = (config.public.basePath as string) || ''
    alertEs = new EventSource(`${base}/api/listener/verify-stream`)
    alertEs.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}')
        if (!d?.cookie_id) return
        if (state.value.open) return
        if (recentlyDismissed(d.cookie_id)) return
        openVerify(d.cookie_id, d.label || d.cookie_id, d.punish_url || '')
      } catch {}
    }
  } catch {
    /* SSE 不可用时仅手动入口可用 */
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  try { alertEs?.close() } catch {}
  alertEs = null
})
</script>
