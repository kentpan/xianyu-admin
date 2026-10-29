/**
 * xianyu/im-store — IM 会话/消息落库 + 进程内事件总线 (SSE 实时推送数据源)。
 *
 * 数据源 (源头采集, 非轮询):
 *   - 入站: ws-client 同步包解析后的 chat/system 消息 (engine-manager onChat/onSystem)
 *   - 出站: 引擎动作发送 (engine-manager executeActions) 与后台手动发送 (messages/send API)
 * 去重: message_key = md5(cookie|chat|sender|createTime|content|direction), UNIQUE(cookie_id, message_key)。
 * 广播: onImEvent 订阅 → /api/messages/stream SSE 直推前端, 零轮询。
 */
import crypto from 'node:crypto'
import { getDb } from '../db'
import { publishToHub } from '../realtime'
import type { ParsedChatMessage, ParsedSystemMessage } from './protocol'

export type ImEvent =
  | { type: 'chat'; cookieId: string; chatId: string; message: Record<string, any> }
  | { type: 'system'; cookieId: string; chatId: string; message: Record<string, any> }
  | { type: 'conversation'; cookieId: string; chatId: string }
  | { type: 'sent'; cookieId: string; chatId: string; message: Record<string, any> }

type Listener = (e: ImEvent) => void

const g = globalThis as any
if (!g.__xianyuImListeners) {
  g.__xianyuImListeners = new Set<Listener>()
}
const listeners = g.__xianyuImListeners as Set<Listener>

export function onImEvent(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitImEvent(e: ImEvent): void {
  for (const fn of [...listeners]) {
    try {
      fn(e)
    } catch {}
  }
  // edge (DO hub): 事件 isolate 内的本地监听器通常为空, 统一转发进 $DurableObject 广播;
  // node 运行时无 DO 绑定, publishToHub 内部直接跳过 (SSE 负责实时)
  publishToHub(imEventPacket(e))
}

/** 事件 → 推送帧 (与 SSE /api/messages/stream 载荷同构, WebSocket 客户端共用)。 */
export function imEventPacket(e: ImEvent): Record<string, any> {
  const p: Record<string, any> = { type: e.type, cookie_id: e.cookieId, chat_id: e.chatId }
  if (e.type !== 'conversation') p.message = e.message
  return p
}

/** 统一 "YYYY-MM-DD HH:MM:SS" 时间戳 (北京时间, 与全站 TIMESTAMP 列一致)。 */
export function imTimestamp(ms?: number): string {
  const d = ms && ms > 0 ? new Date(ms) : new Date()
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')
}

function messageKey(parts: (string | number)[]): string {
  return crypto.createHash('md5').update(parts.join('|')).digest('hex')
}

export interface ImUpsertResult {
  stored: boolean
  conversationId: string
}

/** 入站聊天消息落库 + 会话聚合。 */
export async function persistChatMessage(cookieId: string, msg: ParsedChatMessage): Promise<ImUpsertResult> {
  const db = await getDb().catch(() => null)
  if (!db || !msg.chatId) return { stored: false, conversationId: '' }
  const key = messageKey([cookieId, msg.chatId, msg.senderUserId, msg.createTime, msg.content, 'in'])
  const timeStr = imTimestamp(msg.createTime)
  const contentType = msg.content.startsWith('[图片]') || msg.raw?.['1']?.['10']?.reminderContentType === 2 ? 'image' : 'text'

  const res = await db
    .run(
      `INSERT INTO im_messages (cookie_id, chat_id, direction, message_key, sender_user_id, sender_nick, content, content_type, item_id, msg_time)
       VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cookie_id, message_key) DO NOTHING`,
      [cookieId, msg.chatId, key, msg.senderUserId, msg.senderNick, msg.content, contentType, msg.itemId || '', timeStr],
    )
    .catch(() => ({ changes: 0, lastInsertId: 0 }))
  const stored = (res?.changes || 0) > 0

  await upsertConversation(cookieId, msg.chatId, {
    peer_user_id: msg.senderUserId,
    peer_nick: msg.senderNick,
    item_id: msg.itemId || '',
    last_message: msg.content,
    last_message_type: contentType,
    last_message_time: timeStr,
  })
  if (stored) {
    emitImEvent({ type: 'chat', cookieId, chatId: msg.chatId, message: { direction: 'in', content: msg.content, sender_nick: msg.senderNick, sender_user_id: msg.senderUserId, content_type: contentType, item_id: msg.itemId, msg_time: timeStr } })
  }
  return { stored, conversationId: msg.chatId }
}

/** 系统交易事件落库 (订单卡片: 状态/金额对账信息)。 */
export async function persistSystemMessage(cookieId: string, msg: ParsedSystemMessage): Promise<void> {
  if (!msg.orderId) return
  const db = await getDb().catch(() => null)
  if (!db) return
  const statusText = msg.redReminder || msg.cardTitle || ''
  const key = messageKey([cookieId, msg.chatId || 'system', 'system', msg.orderId, statusText, msg.amount])
  const res = await db
    .run(
      `INSERT INTO im_messages (cookie_id, chat_id, direction, message_key, sender_user_id, sender_nick, content, content_type, item_id, order_id, amount, status_text, msg_time)
       VALUES (?, ?, 'system', ?, '', '闲鱼交易', ?, 'system', ?, ?, ?, ?, ?)
       ON CONFLICT(cookie_id, message_key) DO NOTHING`,
      [cookieId, msg.chatId || 'system', key, statusText, msg.itemId || '', msg.orderId, msg.amount || '', statusText, imTimestamp()],
    )
    .catch(() => ({ changes: 0, lastInsertId: 0 }))
  if ((res?.changes || 0) > 0) {
    const chatId = msg.chatId || 'system'
    emitImEvent({ type: 'system', cookieId, chatId, message: { direction: 'system', content: statusText, order_id: msg.orderId, amount: msg.amount, item_id: msg.itemId, status_text: statusText, msg_time: imTimestamp() } })
    emitImEvent({ type: 'conversation', cookieId, chatId })
  }
}

/** 出站消息落库 (引擎回复/手动发送共用)。 */
export async function persistOutgoingMessage(
  cookieId: string,
  chatId: string,
  toUserId: string,
  content: string,
  contentType: 'text' | 'image',
): Promise<void> {
  const db = await getDb().catch(() => null)
  if (!db || !chatId) return
  const timeStr = imTimestamp()
  const key = messageKey([cookieId, chatId, 'out', Date.now(), content, Math.random()])
  await db
    .run(
      `INSERT OR IGNORE INTO im_messages (cookie_id, chat_id, direction, message_key, sender_user_id, sender_nick, content, content_type, msg_time)
       VALUES (?, ?, 'out', ?, ?, '我', ?, ?, ?)`,
      [cookieId, chatId, key, toUserId, content, contentType, timeStr],
    )
    .catch(() => {})
  await upsertConversation(cookieId, chatId, {
    peer_user_id: toUserId,
    last_message: content,
    last_message_type: contentType,
    last_message_time: timeStr,
  })
  emitImEvent({ type: 'sent', cookieId, chatId, message: { direction: 'out', content, content_type: contentType, sender_nick: '我', msg_time: timeStr } })
}

export interface ConversationPatch {
  peer_user_id?: string
  peer_nick?: string
  item_id?: string
  last_message?: string
  last_message_type?: string
  last_message_time?: string
}

/** 会话聚合 (最新一条消息摘要), 全部字段仅在非空时覆盖。 */
export async function upsertConversation(cookieId: string, chatId: string, patch: ConversationPatch): Promise<void> {
  const db = await getDb().catch(() => null)
  if (!db || !chatId) return
  await db
    .run(
      `INSERT INTO im_conversations (cookie_id, chat_id, peer_user_id, peer_nick, item_id, last_message, last_message_type, last_message_time, total_messages, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(cookie_id, chat_id) DO UPDATE SET
         peer_user_id = CASE WHEN excluded.peer_user_id != '' THEN excluded.peer_user_id ELSE im_conversations.peer_user_id END,
         peer_nick = CASE WHEN excluded.peer_nick != '' THEN excluded.peer_nick ELSE im_conversations.peer_nick END,
         item_id = CASE WHEN excluded.item_id != '' THEN excluded.item_id ELSE im_conversations.item_id END,
         last_message = CASE WHEN excluded.last_message != '' THEN excluded.last_message ELSE im_conversations.last_message END,
         last_message_type = CASE WHEN excluded.last_message_type != '' THEN excluded.last_message_type ELSE im_conversations.last_message_type END,
         last_message_time = CASE WHEN excluded.last_message_time != '' THEN excluded.last_message_time ELSE im_conversations.last_message_time END,
         total_messages = im_conversations.total_messages + 1,
         updated_at = CURRENT_TIMESTAMP`,
      [
        cookieId,
        chatId,
        patch.peer_user_id || '',
        patch.peer_nick || '',
        patch.item_id || '',
        patch.last_message || '',
        patch.last_message_type || 'text',
        patch.last_message_time || '',
      ],
    )
    .catch(() => {})
  emitImEvent({ type: 'conversation', cookieId, chatId })
}

/** 会话列表拉取结果落库 (WS 真实协议回包映射: body[0].userConvs → singleChatUserConversation, 尽力而为)。 */
export async function persistPlatformConversations(cookieId: string, payload: any): Promise<number> {
  const convs = Array.isArray(payload?.userConvs) ? payload.userConvs : Array.isArray(payload) ? payload : []
  let stored = 0
  for (const c of convs) {
    try {
      const single = c?.singleChatUserConversation
      const convInfo = single?.singleChatConversation
      const chatId = String(convInfo?.cid ?? c?.cid ?? '').split('@')[0]
      if (!chatId) continue
      const msg = single?.lastMessage?.message
      // 内容: content.custom.data (base64 JSON {contentType,text:{text}}) → content.text.text / searchableContent.summary
      let content = ''
      let contentType = 'text'
      const contentRoot = msg?.content || {}
      const customData = contentRoot?.custom?.data
      if (typeof customData === 'string' && customData) {
        try {
          const parsed = JSON.parse(Buffer.from(customData, 'base64').toString('utf-8'))
          content = String(parsed?.text?.text || '')
        } catch {}
      }
      if (!content && typeof contentRoot?.text?.text === 'string') content = contentRoot.text.text
      if (!content && typeof contentRoot?.content === 'string') content = contentRoot.content.slice(0, 200)
      if (!content) content = String(msg?.searchableContent?.summary || '')
      if (!content) continue
      const timeMs = Number(msg?.createAt ?? single?.modifyTime ?? convInfo?.createAt ?? 0)
      const pairSecond = String(convInfo?.pairSecond ?? '').split('@')[0]
      const pairFirst = String(convInfo?.pairFirst ?? '').split('@')[0]
      // 对方 = pair 中不等于本方 (pairFirst 是注册者自身)
      const peer = pairSecond || pairFirst
      // 昵称: lastMessage.message.extension.reminderTitle (对方昵称)
      const peerNick = String(msg?.extension?.reminderTitle || '')
      const itemTitle = String(convInfo?.extension?.itemTitle || '')
      await upsertConversation(cookieId, chatId, {
        peer_user_id: peer,
        peer_nick: peerNick,
        item_id: String(convInfo?.extension?.itemId || ''),
        last_message: content,
        last_message_type: contentType,
        last_message_time: timeMs > 0 ? imTimestamp(timeMs) : '',
      })
      // 商品标题补齐 (itemTitle 在会话 extension 中, item_info 缺失时也有价值)
      if (itemTitle) {
        const db = await getDb().catch(() => null)
        if (db) {
          await db
            .run(
              `UPDATE im_conversations SET item_id = COALESCE(NULLIF(item_id, ''), ?) WHERE cookie_id = ? AND chat_id = ?`,
              [String(convInfo?.extension?.itemId || ''), cookieId, chatId],
            )
            .catch(() => {})
        }
      }
      stored++
    } catch {}
  }
  return stored
}
