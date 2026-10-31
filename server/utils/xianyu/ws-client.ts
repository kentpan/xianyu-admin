/**
 * xianyu/ws-client — 单账号闲鱼消息长连接客户端 (TS 复刻自 xianyu-super-butler XianyuAutoAsync)。
 *
 * 生命周期: 取 token → WS 连接 → /reg 注册 → ackDiff → 心跳(15s±抖动) → 消息同步/确认 → 业务回调
 * 风控硬约束 (每一条都对应平台风控信号):
 *   1. 设备指纹持久化 — device_id 由调用方传入并落库, 重连不换指纹
 *   2. 心跳/重连/刷新全部带随机抖动, 不产生机器节拍
 *   3. 指数退避重连 (5s→300s 上限, ±20% 抖动)
 *   4. 风控挑战 (FAIL_SYS_USER_VALIDATE/RGV587) → 冷却阶梯 5/10/20/30 分钟, 冷却期零请求
 *   5. 发送人化队列 — 随机间隔 0.8~2.5s, 滑动窗口限速 12 条/分钟, 每条消息必 ack
 */
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

/** token 刷新周期 1h ± 5min 抖动。 */
const TOKEN_REFRESH_MS = 3600 * 1000

/** cookie 保活周期 3 分钟 (参考项目 cookie_refresh_interval=180s)。 */
const COOKIE_KEEPALIVE_MS = 180 * 1000
/** 收到聊天消息后 5 分钟内不滚动 cookie (参考项目 message_cookie_refresh_cooldown=300s)。 */
const COOKIE_MSG_COOLDOWN_MS = 300 * 1000

function jitter(ms: number, ratio = 0.15): number {
  return Math.round(ms * (1 - ratio + Math.random() * ratio * 2))
}

function backoffDelay(failures: number): number {
  const base = Math.min(300_000, 5_000 * Math.pow(2, Math.min(failures, 6)))
  return jitter(base, 0.2)
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
    // 合并服务端下发的 set-cookie (token 接口会滚动 _m_h5_tk / x5secdata 等) — 无论成败都合并, 保持会话状态新鲜
    const merged: Record<string, string> = { ...cookies }
    try {
      const setCookies: string[] = (res.headers as any).getSetCookie?.() || []
      for (const sc of setCookies) {
        const [pair] = sc.split(';')
        const eq = pair.indexOf('=')
        if (eq > 0) merged[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
      }
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
  private cookieKeepaliveTimer: NodeJS.Timeout | null = null
  private cookieRefreshing = false
  private lastChatMessageAt = 0
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
    this.tokenTimer = setInterval(() => {
      if (!this.stopped) void this.refreshTokenSafely()
    }, jitter(TOKEN_REFRESH_MS, 0.08))
    // cookie 保活 (复刻参考项目 cookie_refresh_loop): 每 3 分钟调 token API,
    // 服务端下发的 Set-Cookie 合并回写 DB, 会话持续滚动 → 登录态不衰减不掉线
    this.cookieKeepaliveTimer = setInterval(() => {
      if (!this.stopped) void this.maybeCookieKeepalive()
    }, jitter(COOKIE_KEEPALIVE_MS, 0.1))
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const t of [this.tokenTimer, this.heartbeatTimer, this.reconnectTimer, this.cookieKeepaliveTimer]) {
      if (t) clearTimeout(t)
      if (t) clearInterval(t)
    }
    this.tokenTimer = this.heartbeatTimer = this.reconnectTimer = this.cookieKeepaliveTimer = null
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

    // token 缺失或过期先刷新
    if (!this.token || Date.now() - this.lastTokenRefresh > TOKEN_REFRESH_MS) {
      await this.refreshTokenSafely()
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
          message = JSON.parse(raw)
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
                  this.lastChatMessageAt = Date.now()
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

  /* ---------------------------- Token ---------------------------- */

  /**
   * cookie 保活一次 (复刻参考项目语义): 收到聊天消息后 5 分钟内跳过 (活跃会话
   * 期间不滚动 cookie, 避免令牌轮换干扰对话); 防重入; 风控/人工验证持有期由
   * refreshTokenSafely 内部短路。
   */
  private async maybeCookieKeepalive(): Promise<void> {
    if (this.cookieRefreshing || this.stopped) return
    if (this.lastChatMessageAt && Date.now() - this.lastChatMessageAt < COOKIE_MSG_COOLDOWN_MS) return
    this.cookieRefreshing = true
    try {
      await this.refreshTokenSafely()
    } finally {
      this.cookieRefreshing = false
    }
  }

  private async refreshTokenSafely(): Promise<void> {
    // 人工验证持有期: 引擎静默, token 刷新完全交给弹窗内的人工重试
    if (isManualVerifyHold(this.cookieId)) return
    // 风控静默窗口: 一个请求都不发 (静默是让风控衰减的唯一方式)
    if (Date.now() < this.riskCooldownUntil) return
    try {
      const { token, mergedCookies, ret, punishUrl } = await fetchTokenDetailed(this.cookieStr, this.deviceId)
      const verdict = classifyTokenError(ret)
      // 无论成败都把服务端滚动的 cookie 回写 (x5secdata 等状态字段保持新鲜)
      const mergedStr = Object.entries(mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
      if (mergedStr !== this.cookieStr) {
        this.cookieStr = mergedStr
        this.events.onCookieRotated(this.cookieId, mergedStr)
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
        this.setState('need_relogin', '登录态失效, 请重新扫码')
        this.events.onCookieInvalid(this.cookieId, ret.join('; ') || 'Session 过期')
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
    const mergedStr = Object.entries(mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
    if (mergedStr !== this.cookieStr) {
      this.cookieStr = mergedStr
      this.events.onCookieRotated(this.cookieId, mergedStr)
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
