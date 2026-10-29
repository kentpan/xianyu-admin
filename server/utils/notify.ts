/**
 * notify — 引擎事件通知分发器 (付款/发货/风控/登录失效 → 站内信 + 用户渠道)。
 *
 * 对齐 butler notification_manager 的触发语义:
 *   payment        付款成功 (买家已付款, 待发货) — 同订单 10min 冷却 (聊天卡片与系统
 *                  交易卡片可能先后各报一次, 只发首条)
 *   delivered      自动发货结果 (成功 / 失败原因) — 同订单 10min 冷却
 *   risk           风控触发进入冷却 — 每账号 30min 冷却
 *   cookie_invalid 登录态失效需重新扫码 — 每账号 3h 冷却 (butler token 通知同款 3h)
 *   message        买家消息提醒 — 仅当绑定显式配置包含该类型才发 (默认不发, 防骚扰)
 *
 * 绑定关系: message_notifications (cookie_id × channel_id, enabled, event_types)。
 *   - event_types 为 NULL/空 → 发默认四类 (payment/delivered/risk/cookie_invalid)
 *   - event_types 为 JSON 数组 (如 ["payment","message"]) → 只发列出的类型
 *
 * 站内信: in_app_notifications 写入全部 users (管理后台铃铛/通知中心直接可见)。
 *
 * 安全性: dispatchNotify 为 fire-and-forget, 内部全量捕获 — 通知链路的任何异常
 * (库未就绪/渠道挂掉) 绝不阻塞也不污染回复/发货主链路; 渠道失败落 system_logs。
 */
import { getDb } from './db'
import { sendChannelMessage, type ChannelRow } from './channel-send'

export type NotifyEventType = 'payment' | 'delivered' | 'risk' | 'cookie_invalid' | 'message'

/** 不配置 event_types 时的默认通知类型。 */
const DEFAULT_EVENT_TYPES: NotifyEventType[] = ['payment', 'delivered', 'risk', 'cookie_invalid']

/** 各事件类型冷却 (毫秒)。 */
const COOLDOWN_MS: Record<NotifyEventType, number> = {
  payment: 10 * 60_000,
  delivered: 10 * 60_000,
  risk: 30 * 60_000,
  cookie_invalid: 3 * 60 * 60_000,
  message: 60_000,
}

export interface NotifyEvent {
  type: NotifyEventType
  cookieId: string
  title: string
  /** 渲染为逐行 "key: value" 的业务字段。 */
  fields: Record<string, string | number>
  /** 站内信跳转链接 (可选)。 */
  link?: string
}

/** 进程内冷却表: `${type}:${dedupeKey}` → 上次发送时间。 */
const notifyCooldown = new Map<string, number>()

function fmtNow(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')
}

function renderText(evt: NotifyEvent): string {
  const lines = [evt.title, '']
  for (const [k, v] of Object.entries(evt.fields)) {
    if (v !== '' && v !== null && v !== undefined) lines.push(`${k}: ${v}`)
  }
  lines.push(`账号: ${evt.cookieId}`)
  lines.push(`时间: ${fmtNow()}`)
  return lines.join('\n')
}

/** 冷却检查 (内存态; 重启后清零, 与发货内存锁同级别的进程内去重)。 */
function cooled(type: NotifyEventType, dedupeKey: string): boolean {
  const key = `${type}:${dedupeKey}`
  const last = notifyCooldown.get(key)
  if (last && Date.now() - last < COOLDOWN_MS[type]) return false
  notifyCooldown.set(key, Date.now())
  // 防 Map 无限膨胀: 超过 512 条清理过期项
  if (notifyCooldown.size > 512) {
    for (const [k, t] of notifyCooldown) {
      const kt = k.split(':')[0] as NotifyEventType
      if (t < Date.now() - (COOLDOWN_MS[kt] || 60_000)) notifyCooldown.delete(k)
    }
  }
  return true
}

async function writeInApp(evt: NotifyEvent, text: string): Promise<void> {
  const db = await getDb()
  const users = await db.all<{ id: number }>('SELECT id FROM users WHERE is_active = 1').catch(() => [])
  for (const u of users) {
    await db
      .run(
        'INSERT INTO in_app_notifications (user_id, type, title, message, read, link) VALUES (?, ?, ?, ?, 0, ?)',
        [u.id, evt.type, evt.title.slice(0, 255), text, evt.link || ''],
      )
      .catch(() => {})
  }
}

async function dispatchChannels(evt: NotifyEvent, text: string): Promise<void> {
  const db = await getDb()
  const rows = await db
    .all<ChannelRow & { event_types: string | null }>(
      `SELECT ch.id, ch.name, ch.type, ch.config, mn.event_types
       FROM message_notifications mn
       JOIN notification_channels ch ON ch.id = mn.channel_id
       WHERE mn.cookie_id = ? AND mn.enabled = 1 AND ch.enabled = 1`,
      [evt.cookieId],
    )
    .catch(() => [])
  if (!rows.length) return

  for (const row of rows) {
    // 事件类型过滤: 绑定未配置 → 默认四类; 配置了 → 白名单精确匹配
    let allowed = DEFAULT_EVENT_TYPES
    const raw = String(row.event_types || '').trim()
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length) allowed = parsed as NotifyEventType[]
      } catch {
        // 兼容逗号分隔写法
        const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
        if (parts.length) allowed = parts as NotifyEventType[]
      }
    }
    if (!allowed.includes(evt.type)) continue

    const result = await sendChannelMessage(row, text)
    if (!result.sent) {
      await db
        .run("INSERT INTO system_logs (level, module, message) VALUES ('WARN', 'notify', ?)", [
          `通知渠道「${row.name}」(${row.type}) 发送失败 [${evt.type}]: ${result.error}`,
        ])
        .catch(() => {})
    }
  }
}

async function runNotify(evt: NotifyEvent, dedupeKey: string): Promise<void> {
  if (!cooled(evt.type, dedupeKey)) return
  const text = renderText(evt)
  await Promise.allSettled([writeInApp(evt, text), dispatchChannels(evt, text)])
}

/**
 * dispatchNotify — 引擎事件通知入口 (fire-and-forget, 永不抛出)。
 *
 * @param evt        通知事件
 * @param dedupeKey  冷却去重键 (缺省 = cookieId; 订单级事件传订单号)
 */
export function dispatchNotify(evt: NotifyEvent, dedupeKey?: string): void {
  void runNotify(evt, dedupeKey || evt.cookieId).catch(() => {})
}
