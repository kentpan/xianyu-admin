/**
 * xianyu/publisher — 引擎事件发布器 (把监听到的原始事件转发给下游订阅项目)。
 *
 * 定位: 纯转发 + 鉴权, 不碰业务逻辑 — 大脑 (回复链/发货链) 的决策流程完全不受影响,
 * 发布是旁路 fire-and-forget: 任何失败绝不阻塞/抛出到事件处理主流程。
 *
 * 鉴权: 向订阅者 webhook 发送时携带标准 `Authorization: Bearer <token>`,
 * 由订阅方服务端校验 (与远程代理/引擎令牌同一规范, 零自定义 header)。
 *
 * 限速与自护: 每订阅者令牌桶 120 次/分钟 (复用 rate-limit); 连续 5 次失败静默
 * 10 分钟 (防打死 webhook / 防雪崩); 单次投递 10s 超时; 统计落库供面板展示。
 */
import { getDb } from '../db'
import { consumeRate } from '../rate-limit'

export interface SubscriberRow {
  id: number
  name: string
  token: string
  webhook_url: string
  enabled: number
  total_delivered: number
  total_failed: number
  consecutive_failures: number
  muted_until: string | null
}

const FAILURE_MUTE_THRESHOLD = 5
const FAILURE_MUTE_MS = 10 * 60_000
const DELIVERY_TIMEOUT_MS = 10_000

/** 订阅者缓存: 15s 刷新一次, 避免每事件查库 */
let cache: { rows: SubscriberRow[]; at: number } = { rows: [], at: 0 }
const CACHE_TTL_MS = 15_000

async function loadSubscribers(): Promise<SubscriberRow[]> {
  const now = Date.now()
  if (now - cache.at < CACHE_TTL_MS) return cache.rows
  try {
    const db = await getDb()
    const rows = await db.all<SubscriberRow>(
      `SELECT id, name, token, webhook_url, enabled, total_delivered, total_failed, consecutive_failures, muted_until
       FROM engine_subscribers WHERE enabled = 1 AND webhook_url != '' AND token != ''`,
    )
    cache = { rows, at: now }
    return rows
  } catch {
    return cache.rows
  }
}

export function invalidateSubscriberCache(): void {
  cache = { rows: [], at: 0 }
}

function isMuted(row: SubscriberRow): boolean {
  if (!row.muted_until) return false
  const t = Date.parse(row.muted_until.includes('T') || row.muted_until.includes('Z') ? row.muted_until : row.muted_until.replace(' ', 'T') + 'Z')
  return Number.isFinite(t) && t > Date.now()
}

async function persistStats(row: SubscriberRow, delivered: number, failed: number, failures: number, muted: boolean): Promise<void> {
  try {
    const db = await getDb()
    await db
      .run(
        `UPDATE engine_subscribers SET
           total_delivered = total_delivered + ?,
           total_failed = total_failed + ?,
           consecutive_failures = ?,
           muted_until = ?,
           last_delivery_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [delivered, failed, failures, muted ? new Date(Date.now() + FAILURE_MUTE_MS).toISOString().slice(0, 19).replace('T', ' ') : null, row.id],
      )
      .catch(() => {})
  } catch {}
}

/** 单条投递 (带限速/超时/429 退避), 返回是否成功。 */
async function deliver(row: SubscriberRow, payload: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const rl = consumeRate(`subscriber:${row.id}`, { capacity: 40, perMinute: 120 })
  if (!rl.ok) {
    return { ok: false, message: `发布限速中, ${rl.retryAfterSeconds}s 后恢复` }
  }

  let res: Response
  try {
    res = await fetch(row.webhook_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${row.token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })
  } catch (e: any) {
    return { ok: false, message: e?.message || '网络错误' }
  }

  if (res.status === 429) {
    const retry = Math.min(Number(res.headers.get('retry-after') || 5), 60)
    await new Promise((r) => setTimeout(r, retry * 1000))
    try {
      res = await fetch(row.webhook_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${row.token}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      })
    } catch (e: any) {
      return { ok: false, message: e?.message || '重试网络错误' }
    }
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const j: any = await res.json()
      if (j?.message) message = j.message
    } catch {}
    return { ok: false, message }
  }
  return { ok: true, message: '' }
}

async function publish(row: SubscriberRow, event: Record<string, unknown>): Promise<void> {
  const payload = { ...event, published_at: Date.now() }
  const result = await deliver(row, payload)

  if (result.ok) {
    row.consecutive_failures = 0
    row.total_delivered += 1
    await persistStats(row, 1, 0, 0, false)
    return
  }

  row.consecutive_failures += 1
  row.total_failed += 1
  const mute = row.consecutive_failures >= FAILURE_MUTE_THRESHOLD
  await persistStats(row, 0, 1, row.consecutive_failures, mute)
  if (mute) {
    console.log(`[publisher] 订阅者「${row.name}」连续 ${row.consecutive_failures} 次投递失败, 静默 10 分钟`)
  } else {
    console.log(`[publisher] 订阅者「${row.name}」投递失败: ${result.message}`)
  }
}

/* ---------------------------------- 事件入口 (fire-and-forget) ---------------------------------- */

function dispatch(event: Record<string, unknown>): void {
  void (async () => {
    try {
      const rows = await loadSubscribers()
      for (const row of rows) {
        if (isMuted(row)) continue
        void publish(row, event)
      }
    } catch {
      // 发布层任何异常都不允许影响业务主流程
    }
  })()
}

export function publishChatEvent(account: string, msg: { chatId: string; senderUserId: string; senderNick: string; content: string; itemId: string; createTime: number; sessionType: string; isSelf: boolean }, source: string): void {
  if (!account) return
  dispatch({
    type: 'chat',
    account,
    chat_id: msg.chatId,
    sender_user_id: msg.senderUserId,
    sender_nick: msg.senderNick,
    content: msg.content,
    item_id: msg.itemId,
    create_time: msg.createTime,
    session_type: msg.sessionType,
    is_self: msg.isSelf,
    source,
  })
}

export function publishSystemEvent(account: string, msg: { redReminder: string; itemId: string; buyerId: string; orderId: string; chatId: string }, source: string): void {
  if (!account) return
  dispatch({
    type: 'system',
    account,
    red_reminder: msg.redReminder,
    item_id: msg.itemId,
    buyer_id: msg.buyerId,
    order_id: msg.orderId,
    chat_id: msg.chatId,
    source,
  })
}

export function publishRiskEvent(account: string, description: string, source: string): void {
  if (!account) return
  dispatch({ type: 'risk', account, description: String(description).slice(0, 500), source })
}

/** 面板「测试推送」: 发送一条标记事件并返回投递结果 (同步等待, 供 UI 展示)。 */
export async function deliverTestEvent(subscriberId: number): Promise<{ ok: boolean; message: string }> {
  const db = await getDb()
  const row = await db.get<SubscriberRow>(
    'SELECT id, name, token, webhook_url, enabled, total_delivered, total_failed, consecutive_failures, muted_until FROM engine_subscribers WHERE id = ?',
    [subscriberId],
  )
  if (!row) return { ok: false, message: '订阅者不存在' }
  if (!row.webhook_url) return { ok: false, message: '请先配置 Webhook 地址' }
  if (!row.token) return { ok: false, message: '请先生成订阅令牌' }
  const result = await deliver(row, {
    type: 'chat',
    account: 'test_account',
    chat_id: 'test_chat',
    sender_user_id: 'test_buyer',
    sender_nick: '测试买家',
    content: '[测试推送] 这是一条来自后台「事件发布」的测试事件',
    item_id: '',
    create_time: Date.now(),
    session_type: '1',
    is_self: false,
    source: 'test',
    __test: true,
    published_at: Date.now(),
  })
  if (result.ok) {
    await db
      .run('UPDATE engine_subscribers SET consecutive_failures = 0, muted_until = NULL, last_delivery_at = CURRENT_TIMESTAMP WHERE id = ?', [subscriberId])
      .catch(() => {})
  }
  return result
}
