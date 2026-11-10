/**
 * xianyu/ws-client — 单账号闲鱼消息长连接客户端 (TS 复刻自 xianyu-super-butler XianyuAutoAsync)。
 *
 * 生命周期: 取 token → WS 连接 → /reg 注册 → ackDiff → 心跳(15s±抖动) → 消息同步/确认 → 业务回调
 * 凭证保活 (v2.3.11 统一执行器): token 滚动 3min / 登录态触摸 10min / 长登录续期 1h,
 * 三任务单队列串行执行 (同账号同一时刻最多一个出站保活请求), 无任何消息活动冷却。
 * 风控硬约束 (每一条都对应平台风控信号):
 *   1. 设备指纹持久化 — device_id 由调用方传入并落库, 重连不换指纹
 *   2. 心跳/重连/刷新全部带随机抖动, 不产生机器节拍
 *   3. 指数退避重连 (5s→300s 上限, ±20% 抖动)
 *   4. 风控挑战 (FAIL_SYS_USER_VALIDATE/RGV587) → 冷却阶梯 5/10/20/30 分钟, 冷却期零请求
 *   5. 发送人化队列 — 随机间隔 0.8~2.5s, 滑动窗口限速 12 条/分钟, 每条消息必 ack
 */
import { parseLosslessJson } from './lossless-json'
import { resolveChromeUA } from './chrome-ua'
import {
  WEBSOCKET_URL,
  TOKEN_API,
  transCookies,
  generateDeviceId,
  md5Sign,
  mtopHeaders,
  wsHeaders,
  buildRegisterMsg,
  buildSyncStateMsg,
  buildAckDiffMsg,
  buildConversationListMsg,
  buildHeartbeatMsg,
  buildAckMsg,
  buildSendTextMsg,
  buildSendImageMsg,
  isSyncPackage,
  parseSyncItem,
  classifyTokenError,
  type ParsedChatMessage,
  type ParsedSystemMessage,
} from './protocol'
import {
  peekStreak,
  recordTokenFailure,
  recordTokenSuccess,
  isManualVerifyHold,
} from './verify-state'

export type AccountState =
  | 'connecting'
  | 'listening'
  | 'reconnecting'
  | 'risk_cooldown'
  | 'need_relogin'
  | 'error'
  | 'disabled'

/** 手动获取 IM token 的真实结果 (用户在界面主动触发)。 */
export interface ManualTokenOutcome {
  ok: boolean
  verdict: 'ok' | 'risk' | 'auth' | 'token_roll' | 'unknown'
  ret: string
  message: string
  /** 风控挑战页链接 (verdict=risk 时存在, 供前端构建代理 iframe) */
  punishUrl: string
}

export interface ClientEvents {
  onState(cookieId: string, state: AccountState, detail: string): void
  onChat(cookieId: string, msg: ParsedChatMessage): void
  onSystem(cookieId: string, msg: ParsedSystemMessage): void
  onRisk(cookieId: string, description: string): void
  onCookieRotated(cookieId: string, mergedCookieStr: string): void
  /** 登录态失效 (Session 过期, 重扫码才能恢复) — 需要通知用户, 否则监听静默死亡。 */
  onCookieInvalid(cookieId: string, reason: string): void
  /** 同步包原始 data (base64) 已解出但未分类, 供 IM 落库层自行分流 */
  onSyncRaw?(cookieId: string, items: string[]): void
}

interface ClientOptions {
  cookieId: string
  cookieStr: string
  deviceId?: string
  events: ClientEvents
  heartbeatSeconds?: number
}

/** 风控冷却阶梯 (秒): 5min → 10min → 20min → 30min (30min 内连续触发递增)。 */
const RISK_LADDER_SECONDS = [300, 600, 1200, 1800]
const RISK_LADDER_WINDOW_MS = 30 * 60 * 1000

/** token TTL 上界 (仅用于重连时判断是否需要刷新, 常规滚动由 3min 任务完成)。 */
const TOKEN_REFRESH_MS = 3600 * 1000

/**
 * ── 凭证保活三层模型 (v2.3.6 联网查证定性, v2.3.11 统一执行器落地) ──
 * 闲鱼登录态由三层独立凭证构成, 缺一层就在该层寿命到期时死:
 *   ① _m_h5_tk 签名令牌 (小时级) — token API 调用即滚动, Set-Cookie 回写;
 *   ② cookie2/skt 短登录会话 (~24h 滑动过期) — 只有被 web 侧接口触摸才续期
 *      (loginuser.get, 参考项目 login_renew_task 600s);
 *   ③ havana_lgc2_77 长登录 (30 天) — passport 三接口链续期, 是短会话死亡后
 *      无感拉活的通道 (参考项目 cookie_renew_api_service 1h 周期)。
 *
 * ── v2.3.11 根治「修了十次仍每天掉线」的执行层根因 ──
 * 旧实现多条续期链各自挂 setInterval + 各自守卫, 其中「收到消息后 5 分钟冷却」
 * 守卫在忙账号 (自动回复店铺, 消息间隔 < 5min) 上把
 * token 滚动与登录态触摸永久短路 — 越活跃越不保活; 独立代理同源实现把守卫
 * 写在 lastDownstreamAt (含 15s 心跳回包的任意下行帧) 上 → 连接健康期间
 * 续期链全部短路 → 短会话 ~24h 必死。本版:
 *   - 消息活动冷却彻底删除 (消息走 WS 帧, cookie 轮换走 HTTPS, 两条独立
 *     通道互不干扰; 忙账号恰恰最需要保活);
 *   - 30min 主站 GET 删除 — v2.3.6 已实证其续不了
 *     登录态本身, 纯冗余请求量;
 *   - 三任务统一串行执行器 (submitKeepAlive), 守卫只在执行器一处
 *     (停止/人工验证持有期/风控冷却期), 任务体零守卫零互斥。
 * 请求量: 每账号每日 480(token)+144(触摸)+72(passport) ≈ 696 次, 远低于
 * 真人浏览器正常流量 (v2.3.6 同口径核算)。
 */
/** ① token 滚动周期 3 分钟 ±10% (参考项目 cookie_refresh_interval=180s)。 */
const TOKEN_ROLL_MS = 180 * 1000
/** ② 登录态触摸周期 10 分钟 ±10% (loginuser.get, 短会话滑动续期)。 */
const SESSION_TOUCH_MS = 600 * 1000
/** loginuser.get (登录态触摸接口)。 */
const LOGINUSER_API = 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.loginuser.get/1.0/'
/** ③ 长登录续期周期 1 小时 ±15% (passport 三接口链, 30 天长登录)。 */
const LONG_LOGIN_RENEW_MS = 3600 * 1000
/** 统一保活任务名 (对应三层凭证)。 */
type KeepAliveTask = 'token' | 'touch' | 'passport'
const PASSPORT_HAS_LOGIN_URL = 'https://passport.goofish.com/newlogin/hasLogin.do'
const PASSPORT_SILENT_HAS_LOGIN_URL = 'https://passport.goofish.com/newlogin/silentHasLogin.do'
const PASSPORT_SET_LOGIN_SETTINGS_URL = 'https://passport.goofish.com/ac/account/setLoginSettings.do'
const PASSPORT_TIMEOUT_MS = 20_000

function jitter(ms: number, ratio = 0.15): number {
  return Math.round(ms * (1 - ratio + Math.random() * ratio * 2))
}

function backoffDelay(failures: number): number {
  const base = Math.min(300_000, 5_000 * Math.pow(2, Math.min(failures, 6)))
  return jitter(base, 0.2)
}

/**
 * Set-Cookie 合并 (过期删除感知): Max-Age=0 或 Expires 已过的删除指令 → 从会话中
 * 移除该 cookie, 否则覆盖。此前实现无视删除语义把待删项存成空值永久保留, cookie
 * 串只增不减 (跟踪 cookie 每次响应都在轮换), 陈旧项累积会干扰会话判定。
 */
export function applySetCookies(record: Record<string, string>, setCookieList: string[]): void {
  for (const sc of setCookieList || []) {
    const segments = String(sc || '').split(';')
    const pair = segments[0] || ''
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (!name) continue
    let expired = false
    for (const attr of segments.slice(1)) {
      const a = attr.trim()
      const al = a.toLowerCase()
      if (al.startsWith('max-age=')) {
        const n = Number(a.slice(8))
        if (Number.isFinite(n) && n <= 0) expired = true
      } else if (al.startsWith('expires=')) {
        const ts = Date.parse(a.slice(8))
        if (Number.isFinite(ts) && ts <= Date.now()) expired = true
      }
    }
    if (expired) delete record[name]
    else {
      // 空值/占位值不覆盖 (毒化防护, v2.3.8): 服务端对失效/异常会话常下发空值清理
      // 指令 (如 cookie2=、havana_lgc2_77=、xxx=deleted), 若照单全收, 仍在生效的
      // 登录态核心 cookie 会被写成空值并经轮换链持久化入库 → 账号永久
      // SESSION_EXPIRED、重启也无法恢复监听; 瞬时误判时更会误伤有效会话。
      // 一律保留旧值, 真正的删除语义只由 expired 分支 (Max-Age=0/Expires 已过) 负责。
      const lv = value.toLowerCase()
      if (!value || lv === 'deleted' || lv === 'null' || lv === 'undefined') continue
      record[name] = value
    }
  }
}

/**
 * mtop token 刷新 (与浏览器请求完全同参, 风控关键: sign/头/cookie 一致)。
 * 独立导出: 手动获取 Token 端点在账号无在线客户端时也可直接实调。
 */
export async function fetchTokenDetailed(
  cookieStr: string,
  deviceId: string,
): Promise<{ token: string; mergedCookies: Record<string, string>; ret: string[]; punishUrl: string }> {
  const dataVal = JSON.stringify({ appKey: '444e9908a51d1cb236a27862abc769c9', deviceId })

  /**
   * 单次调用 (可带覆盖 cookie, 供令牌滚动重试)。
   * t/sign 必须每次现算: 重试时 _m_h5_tk 已滚动, 旧签名必然 FAIL_SYS_SIGN_ERROR。
   */
  const callOnce = async (useCookie: string) => {
    const cookies = transCookies(useCookie)
    const h5tk = cookies['_m_h5_tk'] || ''
    const signToken = h5tk ? h5tk.split('_')[0] : ''
    const t = String(Date.now())
    const params = new URLSearchParams({
      jsv: '2.7.2',
      appKey: '34839810',
      t,
      sign: md5Sign(t, signToken, dataVal),
      v: '1.0',
      type: 'originaljson',
      accountSite: 'xianyu',
      dataType: 'json',
      timeout: '20000',
      api: 'mtop.taobao.idlemessage.pc.login.token',
      sessionOption: 'AutoLoginOnly',
      dangerouslySetWindvaneParams: '%5Bobject%20Object%5D',
      smToken: 'token',
      queryToken: 'sm',
      sm: 'sm',
      spm_cnt: 'a21ybx.im.0.0',
      spm_pre: 'a21ybx.home.sidebar.1.4c053da6vYwnmf',
      log_id: '4c053da6vYwnmf',
    })
    const res = await fetch(`${TOKEN_API}?${params.toString()}`, {
      method: 'POST',
      headers: mtopHeaders(useCookie),
      body: new URLSearchParams({ data: dataVal }).toString(),
      signal: AbortSignal.timeout(30_000),
    })
    const json: any = await res.json().catch(() => ({}))
    const ret: string[] = Array.isArray(json?.ret) ? json.ret : []
    // 合并服务端下发的 set-cookie (token 接口会滚动 _m_h5_tk / x5secdata 等, 过期删除指令同步生效) — 保持会话状态新鲜
    const merged: Record<string, string> = { ...cookies }
    try {
      applySetCookies(merged, (res.headers as any).getSetCookie?.() || [])
    } catch {}
    const token = json?.data?.accessToken || ''
    const punishUrl = typeof json?.data?.url === 'string' ? json.data.url : ''
    return { token, mergedCookies: merged, ret, punishUrl }
  }

  const first = await callOnce(cookieStr)
  const firstVerdict = classifyTokenError(first.ret)
  // 令牌滚动 (FAIL_SYS_TOKEN_EMPTY/EXOIRED): set-cookie 已带新 _m_h5_tk, 用合并后的 cookie 立即重试一次 — 浏览器同款行为
  if (firstVerdict === 'token_roll') {
    const rolled = Object.entries(first.mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
    const second = await callOnce(rolled)
    // 合并两次 set-cookie (第二次响应头优先)
    const finalCookies: Record<string, string> = { ...first.mergedCookies, ...second.mergedCookies }
    return { ...second, mergedCookies: finalCookies }
  }
  return first
}

/**
 * passport 续期链专用: 过滤 Max-Age=0 / Expires 1970 的删除型 Set-Cookie
 * (参考项目 cookie_renew_api_service 同款 — 删除指令直接跳过保留旧值, 绝不把
 * 仍在生效的旧 cookie 清掉; 与 token 链 applySetCookies 的「应用删除」语义不同)。
 */
function filterDeletionSetCookies(setCookieList: string[]): string[] {
  return (setCookieList || []).filter((sc) => {
    const s = String(sc || '')
    if (/max-age=0/i.test(s) || /expires=.*1970/i.test(s)) return false
    // 空值/占位值同步过滤 (与 applySetCookies 毒化防护同语义, v2.3.8): passport 链
    // 的 Set-Cookie 常含 cookie2= 空值清理指令, 放行会毒化仍在生效的登录态。
    const pair = s.split(';')[0] || ''
    const eq = pair.indexOf('=')
    if (eq <= 0) return false
    const v = pair.slice(eq + 1).trim().toLowerCase()
    return Boolean(v) && v !== 'deleted' && v !== 'null' && v !== 'undefined'
  })
}

/**
 * 登录态触摸: 调 mtop.taobao.idlemessage.pc.loginuser.get (参数级照抄参考项目
 * login_renew_task — cookie2/skt 短登录会话的滑动续期接口)。响应 Set-Cookie 合并
 * 返回, 调用方按 verdict 决定是否回写。
 */
async function fetchLoginUserDetailed(
  cookieStr: string,
): Promise<{ ret: string[]; mergedCookies: Record<string, string> }> {
  const callOnce = async (useCookie: string) => {
    const cookies = transCookies(useCookie)
    const dataVal = '{}'
    const h5tk = cookies['_m_h5_tk'] || ''
    const signToken = h5tk ? h5tk.split('_')[0] : ''
    const t = String(Date.now())
    const params = new URLSearchParams({
      jsv: '2.7.2',
      appKey: '34839810',
      t,
      sign: md5Sign(t, signToken, dataVal),
      v: '1.0',
      type: 'originaljson',
      accountSite: 'xianyu',
      dataType: 'json',
      timeout: '20000',
      api: 'mtop.taobao.idlemessage.pc.loginuser.get',
      sessionOption: 'AutoLoginOnly',
      spm_cnt: 'a21ybx.im.0.0',
      spm_pre: 'a21ybx.item.want.1.12523da6waCtUp',
      log_id: '12523da6waCtUp',
    })
    const res = await fetch(`${LOGINUSER_API}?${params.toString()}`, {
      method: 'POST',
      headers: mtopHeaders(useCookie),
      body: new URLSearchParams({ data: dataVal }).toString(),
      signal: AbortSignal.timeout(30_000),
    })
    const json: any = await res.json().catch(() => ({}))
    const ret: string[] = Array.isArray(json?.ret) ? json.ret : []
    const merged: Record<string, string> = { ...cookies }
    try {
      applySetCookies(merged, (res.headers as any).getSetCookie?.() || [])
    } catch {}
    return { ret, mergedCookies: merged }
  }

  const first = await callOnce(cookieStr)
  // 令牌滚动 (FAIL_SYS_TOKEN_EMPTY/EXOIRED): set-cookie 已带新 _m_h5_tk, 合并后重试一次 (与 token 链同款)
  if (classifyTokenError(first.ret) === 'token_roll') {
    const rolled = Object.entries(first.mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
    const second = await callOnce(rolled)
    return { ret: second.ret, mergedCookies: { ...first.mergedCookies, ...second.mergedCookies } }
  }
  return first
}

/**
 * 长登录续期链 (参数级照抄参考项目 cookie_renew_api_service):
 *   ① hasLogin.do (web) — 确认续期登录态 (sgcookie/tracknick/csg/unb 等)
 *   ② silentHasLogin.do (sdkSilent) — 静默续短登录 (参数全常量, 无 body)
 *   ③ setLoginSettings.do (status=0) — 开启/续期 30 天长登录 (下发新 havana_lgc2_77)
 * 各接口 Set-Cookie 逐一合并进工作串 (删除指令过滤), 后续接口使用合并后的 Cookie —
 * 与参考项目合并顺序语义完全一致。
 */
async function renewLongLoginChain(cookieStr: string): Promise<{ cookieStr: string; notes: string[] }> {
  const notes: string[] = []
  const ua = resolveChromeUA()
  let working = cookieStr
  const jar = transCookies(working)

  // hasLogin.do 必需参数缺失 (参考项目同款: 缺 unb 直接跳过整条链)
  if (!jar['unb']) {
    return { cookieStr: working, notes: ['Cookie 缺少 unb, 跳过续期链'] }
  }

  // 闭包读当前 working: 每个接口都用上一步合并后的最新 Cookie 发请求
  const passportHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    'user-agent': ua.ua,
    'sec-ch-ua': ua.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': ua.secChUaPlatform,
    cookie: working,
    ...extra,
  })

  const applyResult = (res: Response, label: string): void => {
    const list = filterDeletionSetCookies((res.headers as any).getSetCookie?.() || [])
    if (list.length) {
      const merged = transCookies(working)
      applySetCookies(merged, list)
      working = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ')
      notes.push(`${label}:+${list.length}cookie`)
    } else {
      notes.push(`${label}:无SetCookie`)
    }
  }

  // ① hasLogin.do — web 入口登录态确认续期
  try {
    const pageTraceId = `21504${Date.now()}${Math.floor(100000 + Math.random() * 900000)}`
    const body = new URLSearchParams({
      hid: jar['unb'] || '',
      ltl: 'true',
      appName: 'xianyu',
      appEntrance: 'web',
      _csrf_token: jar['_tb_token_'] || '',
      umidToken: jar['_uab_collina'] || jar['cna'] || '',
      hsiz: jar['cookie2'] || '',
      bizParams: 'taobaoBizLoginFrom=web&renderRefer=https://www.goofish.com/',
      mainPage: 'false',
      isMobile: 'false',
      lang: 'zh_CN',
      returnUrl: '',
      fromSite: '77',
      isIframe: 'true',
      documentReferer: 'https://www.goofish.com/',
      defaultView: 'hasLogin',
      umidTag: 'SERVER',
      deviceId: '',
      pageTraceId,
    }).toString()
    const rnd = String(Math.random())
    const res = await fetch(`${PASSPORT_HAS_LOGIN_URL}?appName=xianyu&fromSite=77`, {
      method: 'POST',
      redirect: 'manual',
      headers: passportHeaders({
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN',
        'content-type': 'application/x-www-form-urlencoded',
        'bx-v': '2.5.31',
        referer: `https://passport.goofish.com/mini_login.htm?lang=zh_cn&appName=xianyu&appEntrance=web&styleType=vertical&bizParams=&notLoadSsoView=false&notKeepLogin=false&isMobile=false&qrCodeFirst=false&stie=77&rnd=${rnd}`,
        ...(jar['XSRF-TOKEN'] ? { 'x-xsrf-token': jar['XSRF-TOKEN'] } : {}),
      }),
      body,
      signal: AbortSignal.timeout(PASSPORT_TIMEOUT_MS),
    })
    applyResult(res, 'hasLogin')
  } catch (e: any) {
    notes.push(`hasLogin:${String(e?.message || e).slice(0, 80)}`)
  }

  // ② silentHasLogin.do — 静默续短登录
  try {
    const params = new URLSearchParams({
      documentReferer: 'https://www.goofish.com/',
      appName: 'xianyu',
      appEntrance: 'xianyu_sdkSilent',
      fromSite: '0',
      ltl: 'true',
    }).toString()
    const res = await fetch(`${PASSPORT_SILENT_HAS_LOGIN_URL}?${params}`, {
      method: 'POST',
      redirect: 'manual',
      headers: passportHeaders({
        accept: '*/*',
        'accept-language': 'en,zh-CN;q=0.9,zh;q=0.8',
        Referer: 'https://www.goofish.com/',
      }),
      signal: AbortSignal.timeout(PASSPORT_TIMEOUT_MS),
    })
    applyResult(res, 'silentHasLogin')
  } catch (e: any) {
    notes.push(`silentHasLogin:${String(e?.message || e).slice(0, 80)}`)
  }

  // ③ setLoginSettings.do (status=0) — 下发新 havana_lgc2_77 (30 天长登录)
  try {
    const res = await fetch(`${PASSPORT_SET_LOGIN_SETTINGS_URL}?fromSite=77&appName=xianyu&bizEntrance=web`, {
      method: 'POST',
      redirect: 'manual',
      headers: passportHeaders({
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'content-type': 'application/x-www-form-urlencoded',
        referer: 'https://www.goofish.com/',
      }),
      body: 'status=0',
      signal: AbortSignal.timeout(PASSPORT_TIMEOUT_MS),
    })
    applyResult(res, 'setLoginSettings')
  } catch (e: any) {
    notes.push(`setLoginSettings:${String(e?.message || e).slice(0, 80)}`)
  }

  return { cookieStr: working, notes }
}

export class XianyuAccountClient {
  readonly cookieId: string
  private cookieStr: string
  private deviceId: string
  readonly myId: string
  private readonly events: ClientEvents
  private readonly heartbeatMs: number

  private ws: any = null
  private state: AccountState = 'connecting'
  private stopped = false

  private token = ''
  private lastTokenRefresh = 0
  private tokenTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private sessionTouchTimer: NodeJS.Timeout | null = null
  private longLoginTimer: NodeJS.Timeout | null = null
  /** 统一保活执行器: 串行队列 (同名去重, 含执行中任务) + 单 drain (v2.3.11) */
  private keepAliveQueue: Array<{ task: KeepAliveTask; resolve: () => void }> = []
  private keepAliveDraining = false
  private keepAliveActive: { task: KeepAliveTask; done: Promise<void> } | null = null
  private riskCooldownUntil = 0
  private riskLadderIndex = 0
  private lastRiskTripAt = 0
  private connectionFailures = 0
  private generation = 0 // 连接代次: 心跳/接收循环只服务当前代
  private holdNoted = false // 人工验证持有期只报一次状态, 避免每 5s 重复写心跳
  private lastDownstreamAt = Date.now() // 最近一次收到任意下行帧 (含心跳回包): 静默断线检测依据

  // 发送人化队列: 串行 + 随机间隔 + 滑动窗口限速
  private sendChain: Promise<void> = Promise.resolve()
  private sendTimestamps: number[] = []
  private static SEND_WINDOW_MS = 60_000
  private static SEND_MAX_PER_WINDOW = 12

  /** 请求-响应配对表: mid → resolver (getState/会话列表等 WS 协议请求) */
  private pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }>()

  constructor(opts: ClientOptions) {
    this.cookieId = opts.cookieId
    this.cookieStr = opts.cookieStr
    this.events = opts.events
    this.heartbeatMs = (opts.heartbeatSeconds ?? 15) * 1000
    const cookies = transCookies(opts.cookieStr)
    this.myId = cookies['unb'] || ''
    if (!this.myId) throw new Error(`账号 ${opts.cookieId} Cookie 缺少 unb 字段, 无法监听`)
    this.deviceId = opts.deviceId || generateDeviceId(this.myId)
  }

  getDeviceId(): string {
    return this.deviceId
  }
  getState(): AccountState {
    return this.state
  }
  /** 管理层检测到 Cookie 已在后台更新时热替换 (下轮重连生效)。 */
  setCookieStr(value: string): void {
    this.cookieStr = value
  }

  private setState(state: AccountState, detail = ''): void {
    if (this.state !== state || detail) {
      this.state = state
      this.events.onState(this.cookieId, state, detail)
    }
  }

  /* ---------------------------- 启停 ---------------------------- */

  start(): void {
    if (this.stopped) return
    void this.connectLoop()
    // ① token 滚动 (3min): _m_h5_tk/WS token 保活 + cookie 轮换回写 (无消息冷却)
    this.tokenTimer = setInterval(() => {
      if (!this.stopped) void this.submitKeepAlive('token')
    }, jitter(TOKEN_ROLL_MS, 0.1))
    // ② 登录态触摸 (10min): loginuser.get 续 cookie2/skt 短登录会话 (无消息冷却)
    this.sessionTouchTimer = setInterval(() => {
      if (!this.stopped) void this.submitKeepAlive('touch')
    }, jitter(SESSION_TOUCH_MS, 0.1))
    // ③ 长登录续期 (1h): passport 三接口链续 havana_lgc2_77 (30 天长登录)
    this.longLoginTimer = setInterval(() => {
      if (!this.stopped) void this.submitKeepAlive('passport')
    }, jitter(LONG_LOGIN_RENEW_MS, 0.15))
  }

  /* ---------------------- 统一保活执行器 (v2.3.11) ---------------------- */

  /**
   * 提交保活任务 (串行, 同名去重 — 含执行中任务): 同一账号同一时刻最多一个
   * 出站保活请求, 执行中的同名提交跟随其完成 (不重复实调)。守卫统一在 drain。
   */
  private submitKeepAlive(task: KeepAliveTask): Promise<void> {
    if (this.keepAliveActive?.task === task) return this.keepAliveActive.done
    return new Promise((resolve) => {
      const queued = this.keepAliveQueue.find((q) => q.task === task)
      if (queued) {
        const prev = queued.resolve
        queued.resolve = () => {
          prev()
          resolve()
        }
      } else {
        this.keepAliveQueue.push({ task, resolve })
      }
      void this.drainKeepAlive()
    })
  }

  private async drainKeepAlive(): Promise<void> {
    if (this.keepAliveDraining) return
    this.keepAliveDraining = true
    try {
      while (this.keepAliveQueue.length > 0) {
        const { task, resolve } = this.keepAliveQueue.shift()!
        let done!: () => void
        const doneP = new Promise<void>((r) => (done = r))
        this.keepAliveActive = { task, done: doneP }
        try {
          // 守卫唯一收口: 停止 / 人工验证持有期 (零请求, 不作废用户正在验证的挑战) /
          // 风控冷却期 (零请求, 静默是让风控衰减的唯一方式)
          if (!this.stopped && !isManualVerifyHold(this.cookieId) && Date.now() >= this.riskCooldownUntil) {
            if (task === 'token') await this.refreshTokenSafely()
            else if (task === 'touch') await this.sessionTouch()
            else await this.renewLongLogin()
          }
        } catch {
          /* 任务体已自兜底, 此处防调度器死亡 */
        }
        done()
        this.keepAliveActive = null
        resolve()
      }
    } finally {
      this.keepAliveDraining = false
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const t of [this.tokenTimer, this.heartbeatTimer, this.reconnectTimer, this.sessionTouchTimer, this.longLoginTimer]) {
      if (t) clearTimeout(t)
      if (t) clearInterval(t)
    }
    this.tokenTimer = this.heartbeatTimer = this.reconnectTimer = null
    this.sessionTouchTimer = this.longLoginTimer = null
    // 排空执行器队列 (resolve 挂起的等待者, 如 connectOnce 的 token 任务)
    for (const q of this.keepAliveQueue.splice(0)) q.resolve()
    this.generation++
    this.setState('disabled', '已停止')
    try {
      this.ws?.close?.()
    } catch {}
    this.ws = null
  }

  /* ---------------------------- 连接主循环 ---------------------------- */

  private async connectLoop(): Promise<void> {
    while (!this.stopped) {
      // 人工验证持有期 (弹窗打开中): 引擎零请求 — 任何并发 mtop 调用都会作废用户正在验证的挑战
      if (isManualVerifyHold(this.cookieId)) {
        if (!this.holdNoted) {
          this.holdNoted = true
          this.setState('connecting', '人工滑块验证中, 引擎静默等待')
          logWarn(`[${this.cookieId}] 人工验证持有期, 引擎静默 (不重试 token/不自动求解)`)
        }
        await sleep(5_000)
        continue
      }
      this.holdNoted = false

      // 风控冷却期: 完全静默, 一个请求都不发
      const remainMs = this.riskCooldownUntil - Date.now()
      if (remainMs > 0) {
        this.setState('risk_cooldown', `风控冷却 ${Math.ceil(remainMs / 1000)}s`)
        await sleep(Math.min(remainMs, 30_000))
        continue
      }

      try {
        await this.connectOnce()
      } catch (e: any) {
        const msg = String(e?.message || e)
        this.connectionFailures++
        if (this.stopped) return
        const delay = backoffDelay(this.connectionFailures)
        this.setState('reconnecting', `第 ${this.connectionFailures} 次断开, ${Math.round(delay / 1000)}s 后重连`)
        logWarn(`[${this.cookieId}] 连接断开: ${msg} → ${Math.round(delay / 1000)}s 后重连`)
        await sleep(delay)
      }
    }
  }

  private async connectOnce(): Promise<void> {
    const gen = ++this.generation
    this.setState('connecting', '建立连接')

    // token 缺失或接近 TTL 上界先刷新 (经执行器串行, 与保活任务零竞态)
    if (!this.token || Date.now() - this.lastTokenRefresh > TOKEN_REFRESH_MS) {
      await this.submitKeepAlive('token')
      if (!this.token) {
        throw new Error('Token 获取失败')
      }
    }

    const ws = await createWsSocket(WEBSOCKET_URL, wsHeaders(this.cookieStr))
    this.ws = ws

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onErr = (err: any) => {
        cleanup()
        reject(new Error(err?.message || 'WebSocket 握手失败'))
      }
      const cleanup = () => {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onErr)
      }
      ws.addEventListener('open', onOpen)
      ws.addEventListener('error', onErr)
      setTimeout(() => {
        cleanup()
        reject(new Error('WebSocket 握手超时'))
      }, 20_000).unref?.()
    })

    // 注册 + 正确补差: 先 getState 拿服务端同步状态, 再用该状态 ackDiff (离线期消息不丢)
    ws.send(buildRegisterMsg(this.token, this.deviceId))
    await sleep(1000)
    if (gen !== this.generation || this.stopped) return
    try {
      const stateResp = await this.requestRaw(buildSyncStateMsg(), 8000)
      const serverState = Array.isArray(stateResp?.body) ? stateResp.body[0] : stateResp?.body
      ws.send(buildAckDiffMsg(serverState))
    } catch {
      // getState 失败回退旧行为 (ackDiff 当前时间), 不阻塞监听主链路
      ws.send(buildAckDiffMsg())
    }

    this.connectionFailures = 0
    this.riskLadderIndex = 0
    this.setState('listening', '监听中')
    logWarn(`[${this.cookieId}] 闲鱼消息通道已建立 (device=${maskDevice(this.deviceId)})`)

    this.startHeartbeat(gen, ws)

    await this.receiveLoop(gen, ws)
  }

  private startHeartbeat(gen: number, ws: any): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    const tick = () => {
      if (this.stopped || gen !== this.generation) return
      // 静默断线检测: 正常连接心跳回包 ≤15s 一帧, 超过 6 个心跳周期无任何下行帧 = 连接已假死
      // (TCP 半开不触发 close/error, 不主动重连会永远停在 listening 却收不到任何消息)
      if (Date.now() - this.lastDownstreamAt > 90_000) {
        logWarn(`[${this.cookieId}] 连接静默超过 90s (无任何下行帧), 判定假死, 主动断开重连`)
        try {
          ws.close()
        } catch {}
        return
      }
      try {
        if (ws.readyState === 1) ws.send(buildHeartbeatMsg())
      } catch {
        /* 断线由 receiveLoop 感知 */
      }
      this.heartbeatTimer = setTimeout(tick, jitter(this.heartbeatMs, 0.15))
    }
    this.heartbeatTimer = setTimeout(tick, jitter(this.heartbeatMs, 0.15))
  }

  private async receiveLoop(gen: number, ws: any): Promise<void> {
    await new Promise<void>((resolve) => {
      ws.addEventListener('message', (ev: any) => {
        if (gen !== this.generation || this.stopped) return resolve()
        this.lastDownstreamAt = Date.now()
        const raw = typeof ev.data === 'string' ? ev.data : ''
        if (!raw) return
        let message: any
        try {
          message = parseLosslessJson(raw)
        } catch {
          return
        }
        // 请求-响应按 mid 配对 (getState/会话列表等协议请求的回包)
        try {
          const mid = message?.headers?.mid
          if (mid && this.pendingRequests.has(mid)) {
            const pending = this.pendingRequests.get(mid)!
            this.pendingRequests.delete(mid)
            clearTimeout(pending.timer)
            pending.resolve(message)
            return
          }
          // 每条下行必确认 (风控关键)
          if (!('code' in message)) {
            try {
              ws.send(buildAckMsg(message))
            } catch {}
          }
          if (isSyncPackage(message)) {
            const items = message.body.syncPushPackage.data || []
            const rawItems: string[] = []
            for (const item of items) {
              if (!item?.data) continue
              rawItems.push(String(item.data))
              try {
                const parsed = parseSyncItem(item.data, this.myId)
                if (!parsed) continue
                if (parsed.kind === 'chat') {
                  this.events.onChat(this.cookieId, parsed)
                }
                else this.events.onSystem(this.cookieId, parsed)
              } catch (e: any) {
                logWarn(`[${this.cookieId}] 同步包解析失败: ${e?.message}`)
              }
            }
            if (rawItems.length) this.events.onSyncRaw?.(this.cookieId, rawItems)
          }
        } catch (e: any) {
          logWarn(`[${this.cookieId}] 消息处理异常: ${e?.message}`)
        }
      })
      const done = () => resolve()
      ws.addEventListener('close', done)
      ws.addEventListener('error', done)
    })
  }

  /* --------------------- 保活任务体 ①②③ (守卫统一在执行器) --------------------- */

  /**
   * ② 登录态触摸任务: loginuser.get 续 cookie2/skt 短登录会话 (参数级照抄参考
   * 项目 login_renew_task)。Set-Cookie 经轮换链落库; verdict 仅供观测:
   *   - risk → 跳过本周期 (该端点的风控判定与主站 token 链语义不等价, 绝不
   *     反噬主链路 — v2.3.8 同结论);
   *   - auth → 只留日志, 不据此判死: 账号生死由 token 链 (3min 周期, 监听的
   *     直接依赖) 唯一判定, 触摸端点的失效判定存在端点特异性误报, 误判死会
   *     吓迫用户重扫码并触发人脸核验。真失效时 token 链 3min 内即可判死,
   *     快于本触摸的 10min 周期。
   * 守卫 (停止/人工验证持有期/风控冷却期) 统一在执行器, 任务体零守卫。
   */
  private async sessionTouch(): Promise<void> {
    try {
      const { ret, mergedCookies } = await fetchLoginUserDetailed(this.cookieStr)
      const verdict = classifyTokenError(ret)
      // 登录失效 (auth) 响应的 Set-Cookie 不回写 (清理指令/空值, 合并只会毒化会话)
      if (verdict !== 'auth') {
        const mergedStr = Object.entries(mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
        if (mergedStr !== this.cookieStr) {
          this.cookieStr = mergedStr
          this.events.onCookieRotated(this.cookieId, mergedStr)
        }
      }
      if (verdict === 'ok') return
      if (verdict === 'risk') {
        logWarn(`[${this.cookieId}] 登录态触摸被风控拦截 (仅跳过本次触摸, 不影响监听链路): ${ret.join('; ')}`)
        return
      }
      logWarn(`[${this.cookieId}] 登录态触摸未成功 (以 token 链判定为准, 不据此判死): ${ret.join('; ') || '空响应'}`)
    } catch (e: any) {
      // 网络异常: 触摸失败不代表登录态死亡, 静默等下一周期
      logWarn(`[${this.cookieId}] 登录态触摸异常: ${e?.message}`)
    }
  }

  /**
   * ③ 长登录续期任务: passport 三接口链续 30 天长登录 (havana_lgc2_77)。
   * need_relogin 状态下照常执行 — 长登录 token 是会话死亡后无感拉活的通道
   * (参考项目实测「首次续期成功后 cookie 过期也可正常续期」); 拉活后 token 链
   * 下一次成功刷新会自动把账号带回 connecting。守卫统一在执行器。
   */
  private async renewLongLogin(): Promise<void> {
    try {
      const { cookieStr: mergedStr, notes } = await renewLongLoginChain(this.cookieStr)
      if (mergedStr !== this.cookieStr) {
        this.cookieStr = mergedStr
        this.events.onCookieRotated(this.cookieId, mergedStr)
      }
      logWarn(`[${this.cookieId}] 长登录续期: ${notes.join('; ')}`)
    } catch (e: any) {
      logWarn(`[${this.cookieId}] 长登录续期异常: ${e?.message}`)
    }
  }

  /**
   * ① token 滚动任务: token API 实调 + Set-Cookie 合并回写 + WS token 更新。
   * 全账号唯一的两个状态裁决点都在这里:
   *   - risk → tripRisk (冷却阶梯 5/10/20/30min, 连败 ≥3 → 30min / ≥6 → 2h);
   *   - auth → need_relogin (全账号唯一判死点, 状态已标记时绝不重复通知 —
   *     否则会话死亡期间每 3 分钟重发一条「登录态失效」全渠道通知)。
   * 守卫 (停止/人工验证持有期/风控冷却期) 统一在执行器; risk 分支内保留
   * 持有期短路 (调用执行期间用户可能刚打开弹窗)。
   */
  private async refreshTokenSafely(): Promise<void> {
    try {
      const { token, mergedCookies, ret, punishUrl } = await fetchTokenDetailed(this.cookieStr, this.deviceId)
      const verdict = classifyTokenError(ret)
      // 服务端滚动的 cookie 回写 (x5secdata 等状态字段保持新鲜)。
      // 唯一例外: 登录失效 (auth) 响应的 Set-Cookie 不回写 — 会话已判定失效, 此时下发
      // 的往往是清理指令/空值, 合并只会毒化 cookie (瞬时误判时更会误伤仍有效的会话)。
      if (verdict !== 'auth') {
        const mergedStr = Object.entries(mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
        if (mergedStr !== this.cookieStr) {
          this.cookieStr = mergedStr
          this.events.onCookieRotated(this.cookieId, mergedStr)
        }
      }
      if (verdict === 'ok' && token) {
        this.token = token
        this.lastTokenRefresh = Date.now()
        this.riskLadderIndex = 0
        recordTokenSuccess(this.cookieId)
        if (this.state === 'need_relogin') this.setState('connecting', '登录态恢复')
        return
      }
      if (verdict === 'risk') {
        // 人工验证持有期在此分支同样短路 (调用后可能才开启弹窗)
        if (isManualVerifyHold(this.cookieId)) return
        // 风控挑战 → 连败计数 + 冷却阶梯, 连败 ≥2 前端自动弹窗 (SSE 事件驱动),
        // 用户在弹窗内的真实验证页 iframe 人工拖滑块, x5sec 经官方 postMessage 契约回传合并。
        this.tripRisk(`token 接口风控拦截: ${ret.join('; ')}`, punishUrl, ret)
        return
      }
      if (verdict === 'auth') {
        // 与 sessionTouch auth 分支同守卫 (v2.3.8): cookie 保活 (3min) + 重连退避都会
        // 走到这里, 状态已标记时绝不重复 setState/通知 — 否则会话死亡期间每小时
        // 重发 20~30 条「登录态失效」通知 (通知中心/邮件/微信全渠道刷屏)。
        if (this.state !== 'need_relogin') {
          this.setState('need_relogin', '登录态失效, 请重新扫码')
          this.events.onCookieInvalid(this.cookieId, ret.join('; ') || 'Session 过期')
        }
        return
      }
      recordTokenFailure(this.cookieId, ret, punishUrl)
      logWarn(`[${this.cookieId}] token 刷新未成功: ${ret.join('; ') || '空响应'}`)
    } catch (e: any) {
      recordTokenFailure(this.cookieId, [String(e?.message || e).slice(0, 100)], '')
      logWarn(`[${this.cookieId}] token 刷新异常: ${e?.message}`)
    }
  }

  /**
   * 手动获取 IM token (用户在界面主动触发): 绕过冷却窗口立即实调一次, 返回真实结果。
   * 与自动刷新的区别: 不触发自动滑块求解器 (用户走人工验证), 失败同样计入连败与冷却阶梯。
   */
  async manualTokenFetch(): Promise<ManualTokenOutcome> {
    const { token, mergedCookies, ret, punishUrl } = await fetchTokenDetailed(this.cookieStr, this.deviceId)
    const verdict = classifyTokenError(ret)
    // auth (登录失效) 响应的 Set-Cookie 不回写, 与 refreshTokenSafely 同策略
    if (verdict !== 'auth') {
      const mergedStr = Object.entries(mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
      if (mergedStr !== this.cookieStr) {
        this.cookieStr = mergedStr
        this.events.onCookieRotated(this.cookieId, mergedStr)
      }
    }
    if (verdict === 'ok' && token) {
      this.token = token
      this.lastTokenRefresh = Date.now()
      this.riskLadderIndex = 0
      this.riskCooldownUntil = 0
      recordTokenSuccess(this.cookieId)
      if (this.state !== 'listening') this.setState('connecting', '手动获取 Token 成功, 重连中')
      return { ok: true, verdict, ret: ret.join('; '), message: 'Token 获取成功, 监听链路恢复中', punishUrl: '' }
    }
    if (verdict === 'risk') {
      this.tripRisk(`手动获取 Token 被风控拦截: ${ret.join('; ')}`, punishUrl, ret)
      return {
        ok: false,
        verdict,
        ret: ret.join('; '),
        message: '仍被风控拦截 (RGV587), 请在弹窗内完成滑块验证后重试',
        punishUrl,
      }
    }
    if (verdict === 'auth') {
      this.setState('need_relogin', '登录态失效, 请重新扫码')
      this.events.onCookieInvalid(this.cookieId, ret.join('; ') || 'Session 过期')
      return { ok: false, verdict, ret: ret.join('; '), message: '登录态已失效, 请到「账号管理」重新扫码', punishUrl: '' }
    }
    recordTokenFailure(this.cookieId, ret, punishUrl)
    return {
      ok: false,
      verdict,
      ret: ret.join('; '),
      message: `Token 获取未成功: ${ret.join('; ') || '空响应'}`,
      punishUrl,
    }
  }

  /* ---------------------------- 风控 ---------------------------- */

  private tripRisk(description: string, punishUrl = '', ret: string[] = []): void {
    const now = Date.now()
    if (now - this.lastRiskTripAt > RISK_LADDER_WINDOW_MS) this.riskLadderIndex = 0
    this.lastRiskTripAt = now
    let seconds = RISK_LADDER_SECONDS[Math.min(this.riskLadderIndex, RISK_LADDER_SECONDS.length - 1)]
    this.riskLadderIndex++
    // butler token_retry_interval 同语义: 连续失败时静默窗口逐级放大, 让风控窗口自然衰减 (高频重试只会加深风控)
    const streakAfter = peekStreak(this.cookieId) + 1
    let quietNote = ''
    if (streakAfter >= 6) {
      seconds = 7200
      quietNote = ' (连续失败, 静默 2h 等待风控衰减)'
    } else if (streakAfter >= 3) {
      seconds = 1800
      quietNote = ' (连续失败, 静默 30min 等待风控衰减)'
    }
    this.riskCooldownUntil = now + seconds * 1000
    this.token = ''
    recordTokenFailure(this.cookieId, ret, punishUrl, this.riskCooldownUntil)
    this.setState('risk_cooldown', `风控冷却 ${seconds}s${quietNote}`)
    this.events.onRisk(this.cookieId, `${description} → 冷却 ${seconds}s${quietNote}`)
    logWarn(`[${this.cookieId}] 触发风控: ${description} → 静默 ${seconds}s${quietNote}`)
  }

  /* ---------------------------- 发送 (人化队列) ---------------------------- */

  private enqueue(frame: string, delayMs: number): Promise<void> {
    const run = async () => {
      if (delayMs > 0) await sleep(delayMs)
      // 滑动窗口限速
      const now = Date.now()
      this.sendTimestamps = this.sendTimestamps.filter((t) => now - t < XianyuAccountClient.SEND_WINDOW_MS)
      if (this.sendTimestamps.length >= XianyuAccountClient.SEND_MAX_PER_WINDOW) {
        const wait = XianyuAccountClient.SEND_WINDOW_MS - (now - this.sendTimestamps[0]) + 500
        await sleep(wait)
      }
      // 人化随机间隔 0.8~2.5s
      await sleep(800 + Math.floor(Math.random() * 1700))
      const ws = this.ws
      if (!ws || ws.readyState !== 1) throw new Error('连接未就绪, 发送取消')
      ws.send(frame)
      this.sendTimestamps.push(Date.now())
    }
    const next = this.sendChain.then(run, run)
    this.sendChain = next.catch(() => {})
    return next
  }

  sendText(chatId: string, toUserId: string, text: string, delayMs = 0): Promise<void> {
    return this.enqueue(buildSendTextMsg(chatId, toUserId, this.myId, text), delayMs)
  }

  sendImage(chatId: string, toUserId: string, imageUrl: string, width = 800, height = 600, delayMs = 0): Promise<void> {
    return this.enqueue(buildSendImageMsg(chatId, toUserId, this.myId, imageUrl, width, height), delayMs)
  }

  /* ---------------------------- WS 协议请求-响应 ---------------------------- */

  /** 直发一帧并按 mid 等待配对响应 (绕过人化队列 — 协议请求不是聊天消息, 无风控节拍问题)。 */
  requestRaw(frame: string, timeoutMs = 10_000): Promise<any> {
    const ws = this.ws
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error('连接未就绪'))
    let mid = ''
    try {
      mid = String(JSON.parse(frame)?.headers?.mid || '')
    } catch {}
    if (!mid) return Promise.reject(new Error('报文缺少 mid'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(mid)
        reject(new Error('WS 协议请求超时'))
      }, timeoutMs)
      this.pendingRequests.set(mid, { resolve, reject, timer })
      try {
        ws.send(frame)
      } catch (e: any) {
        clearTimeout(timer)
        this.pendingRequests.delete(mid)
        reject(new Error(e?.message || 'WS 发送失败'))
      }
    })
  }

  /**
   * 拉取会话列表 (真实协议 /r/Conversation/listNewestPagination)。
   * 返回响应 body[0] (含 userConvs / hasMore / nextCursor), 由上层映射。
   */
  async fetchConversationList(startTimestamp = 0, limit = 30): Promise<any> {
    const resp = await this.requestRaw(buildConversationListMsg(startTimestamp, limit), 12_000)
    if (resp?.code && resp.code !== 200) throw new Error(`会话列表请求失败: code=${resp.code}`)
    return Array.isArray(resp?.body) ? resp.body[0] : resp?.body || {}
  }

  /** 当前连接是否可发送协议请求。 */
  isOnline(): boolean {
    const ws = this.ws
    return !!ws && ws.readyState === 1
  }
}

/* ---------------------------------- 工具 ---------------------------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function maskDevice(deviceId: string): string {
  return deviceId.length > 10 ? `${deviceId.slice(0, 6)}…${deviceId.slice(-4)}` : deviceId
}

function logWarn(msg: string): void {
  console.log(`[xianyu-listener] ${msg}`)
}

/**
 * 创建带自定义握手头的 WebSocket (异步)。
 * 优先 Node 原生 (undici) WebSocket (Node >= 21 支持 headers 选项), 失败回退 ws 包。
 */
async function createWsSocket(url: string, headers: Record<string, string>): Promise<any> {
  try {
    return new WebSocket(url, { headers } as any)
  } catch {
    const mod: any = await import('ws').catch(() => null)
    if (!mod?.default) {
      throw new Error('当前 Node 版本不支持原生 WebSocket 且未安装 ws 包, 无法建立闲鱼长连接')
    }
    const Ws = mod.default
    return new Ws(url, { headers })
  }
}
