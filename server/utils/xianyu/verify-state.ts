/**
 * xianyu/verify-state — IM token 风控连败状态 (进程级共享) + 滑块验证 Cookie 赎回合并。
 *
 * 全局弹窗判定依据: token 连续失败 ≥ 2 次且持有风控挑战链接 (punishUrl) → 前端弹全局
 * 弹窗, 直接 iframe 嵌入闲鱼官方验证页 (punishUrl + addCookieToHeader=1, 真实
 * h5api.m.goofish.com 页面, 零代理零 python)。用户人工拖滑块通过后, 官方页面按
 * addCookieToHeader 契约把 x5sec 凭证 postMessage 给父窗口 (target=*), 前端回传
 * verify-x5sec 端点合并进账号 Cookie (DB 持久化 + 引擎运行时热替换) 后重试 token。
 *
 * 人工验证持有期 (manualVerifyHold): 弹窗打开 → 关闭/成功期间, 引擎对该账号完全静默
 * (不重试 token) — 但ler语义: 验证期间任何并发 mtop 调用都会重新触发风控并作废
 * 用户正在验证的挑战, 这是"滑块拖了也过不了"的根因。
 *
 * 风控警报推送: 连败首次达到阈值时通过 onVerifyAlert 发射事件, SSE 端点转发给前端
 * 全局弹窗 — 事件驱动, 前端零轮询。
 */

export interface XyVerifyState {
  cookieId: string
  /** token 连续失败次数 (成功清零) */
  streak: number
  /** 最近一次风控挑战返回的验证页链接 (滑块 iframe 加载入口) */
  punishUrl: string
  /** 引擎风控冷却截止时间戳 (ms, 仅供展示) */
  cooldownUntil: number
  /** 人工验证持有期截止时间戳 (ms, 0=未持有); 期间引擎对该账号零请求 */
  holdUntil: number
  /** 最近一次记录时间戳 (ms) */
  lastAt: number
  /** 最近一次接口 ret 串 */
  lastRet: string
}

/** 人工验证持有期时长 (弹窗忘关的兑底, 到期引擎自动恢复重试节奏)。 */
const HOLD_TTL_MS = 10 * 60 * 1000

const g = globalThis as any
if (!g.__xyVerifyStates) g.__xyVerifyStates = new Map<string, XyVerifyState>()
const states: Map<string, XyVerifyState> = g.__xyVerifyStates
if (!g.__xyVerifyAlertCbs) g.__xyVerifyAlertCbs = new Set<(s: XyVerifyState) => void>()
const alertCbs = g.__xyVerifyAlertCbs as Set<(s: XyVerifyState) => void>

/** 订阅风控人工验证警报 (SSE 端点用); 返回退订函数。 */
export function onVerifyAlert(cb: (s: XyVerifyState) => void): () => void {
  alertCbs.add(cb)
  return () => alertCbs.delete(cb)
}

function emitVerifyAlert(s: XyVerifyState): void {
  for (const cb of [...alertCbs]) {
    try { cb(s) } catch {}
  }
}

/** 人工验证持有期开关 (on: 弹窗打开; off: 关闭/成功)。 */
export function setManualVerifyHold(cookieId: string, on: boolean): void {
  const s = states.get(cookieId)
  if (on) {
    if (s) {
      s.holdUntil = Date.now() + HOLD_TTL_MS
    } else {
      states.set(cookieId, {
        cookieId,
        streak: 0,
        punishUrl: '',
        cooldownUntil: 0,
        holdUntil: Date.now() + HOLD_TTL_MS,
        lastAt: Date.now(),
        lastRet: '',
      })
    }
  } else if (s) {
    s.holdUntil = 0
  }
}

/** 人工验证持有期内 → 引擎对该账号必须完全静默。 */
export function isManualVerifyHold(cookieId: string): boolean {
  const s = states.get(cookieId)
  return !!s && s.holdUntil > Date.now()
}

/** 当前连败次数 (不新增记录)。 */
export function peekStreak(cookieId: string): number {
  return states.get(cookieId)?.streak || 0
}

/** token 失败一次 (风控/未知/异常), 连败 +1 并记录验证链接供手动验证弹窗使用。 */
export function recordTokenFailure(cookieId: string, ret: string[], punishUrl: string, cooldownUntil = 0): void {
  const prev = states.get(cookieId)
  const next: XyVerifyState = {
    cookieId,
    streak: (prev?.streak || 0) + 1,
    punishUrl: punishUrl || prev?.punishUrl || '',
    cooldownUntil: cooldownUntil || prev?.cooldownUntil || 0,
    holdUntil: prev?.holdUntil || 0,
    lastAt: Date.now(),
    lastRet: (ret || []).join('; ').slice(0, 300),
  }
  states.set(cookieId, next)
  // 连败达到人工验证阈值 (用户约定: 失败 2 次) 且持有挑战链接 → 推送全局弹窗 (SSE 事件驱动, 前端零轮询)
  if (next.streak >= 2 && next.punishUrl) emitVerifyAlert(next)
}

/** token 成功, 清零全部连败状态。 */
export function recordTokenSuccess(cookieId: string): void {
  states.delete(cookieId)
}

/**
 * 人工验证弹窗打开时, 服务端现拿的新鲜挑战回写 (不增连败、不动冷却、不触发警报)。
 * 挑战是一次性的且 x5secdata 有时效 — 弹窗里若沿用引擎失败瞬间存的旧链接,
 * 用户点开时多半已过期 (Alibaba 渲染纯错误页), 这是"拖了也过不去"的根因。
 */
export function refreshPunishUrl(cookieId: string, punishUrl: string): void {
  if (!punishUrl) return
  const s = states.get(cookieId)
  if (s) {
    s.punishUrl = punishUrl
    s.lastAt = Date.now()
  } else {
    states.set(cookieId, {
      cookieId,
      streak: 0,
      punishUrl,
      cooldownUntil: 0,
      holdUntil: 0,
      lastAt: Date.now(),
      lastRet: '',
    })
  }
}

export function getVerifyState(cookieId: string): XyVerifyState | null {
  return states.get(cookieId) || null
}

export function getAllVerifyStates(): XyVerifyState[] {
  return [...states.values()]
}

/**
 * 把滑块验证过程中闲鱼下发的 Set-Cookie 合并进账号 Cookie (DB + 引擎运行时热替换)。
 * 返回真实合并结果: added = 发生变化的字段数, x5sec = 是否出现了 x5* 赎回凭证。
 */
export async function mergeSetCookiesIntoAccount(
  cookieId: string,
  setCookieList: string[],
): Promise<{ added: number; x5sec: boolean }> {
  const list = (setCookieList || []).filter(Boolean)
  if (!list.length) return { added: 0, x5sec: false }
  const db = await getDb().catch(() => null)
  if (!db) return { added: 0, x5sec: false }
  const row = await db.get<any>('SELECT value FROM cookies WHERE id = ?', [cookieId]).catch(() => null)
  if (!row?.value) return { added: 0, x5sec: false }
  const merged = transCookies(String(row.value))
  let added = 0
  let x5sec = false
  for (const sc of list) {
    const [pair] = String(sc).split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (!name) continue
    if (merged[name] !== value) added++
    merged[name] = value
    const lower = name.toLowerCase()
    if (lower === 'x5sec' || lower.startsWith('x5secdata') || lower.startsWith('x5sec')) x5sec = true
  }
  const mergedStr = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ')
  if (mergedStr !== String(row.value)) {
    await db.run('UPDATE cookies SET value = ? WHERE id = ?', [mergedStr, cookieId]).catch(() => {})
    // 引擎在线时热替换 (动态引入避免 verify-state ↔ engine-manager 循环依赖)
    try {
      const em: any = await import('./engine-manager')
      em.applyExternalCookieUpdate?.(cookieId, mergedStr)
    } catch {}
  }
  return { added, x5sec }
}
