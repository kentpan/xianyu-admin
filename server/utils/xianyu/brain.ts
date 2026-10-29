/**
 * xianyu/brain — 监听引擎的业务决策中枢 (语义对齐 xianyu-super-butler)。
 *
 * 职责: 输入账号事件 (聊天/系统), 输出待执行动作 (发文本/发图片)。自身零业务状态 —
 * 所有规则/卡券/订单/日志读写都直接走后台数据库, 远程代理与本进程内置引擎共用同一份决策。
 *
 * 回复优先级 (与 butler 完全一致):
 *   过滤规则跳过 → 付款触发(优先于一切回复) → 系统通知文本跳过 → 关键词回复(商品绑定 > 通用)
 *   → AI回复(意图识别+议价) → 指定商品回复 → 默认回复
 * 发货触发 (与 butler 完全一致):
 *   - 聊天卡片文本命中付款关键词 ([我已付款，等待你发货] 等) → 订单落库 pending_ship → 自动发货
 *   - 系统消息 redReminder = 等待卖家发货 → 订单落库 pending_ship → 自动发货
 *   发货执行: 商品归属校验(缺失时 mtop 拉详情补齐) → 规则唯一匹配 → 卡券原子扣减
 *   → 延时 → 虚拟发货确认(cookies.auto_confirm) → 发送内容
 */
import { getDb } from '../db'
import { dispatchNotify } from '../notify'
import { generateCardCode, renderCodeTemplate, persistCardCode } from '../card-code'
import { fetchItemDetail, confirmOrderShipped, freeshippingOrder } from './mtop'
import { extractOrderId, type ParsedChatMessage, type ParsedSystemMessage } from './protocol'

export type EngineAction =
  | { type: 'send_text'; account: string; chat_id: string; to_user_id: string; text: string; delay_ms: number }
  | {
      type: 'send_image'
      account: string
      chat_id: string
      to_user_id: string
      image_url: string
      width: number
      height: number
      delay_ms: number
    }

interface BrainOptions {
  /** 当前事件归属的监听来源 (builtin slug 或远程代理 slug), 用于日志归因。 */
  source: string
}

/** 同一订单的发货内存锁 + 冷却 (10 分钟), 防重复发货 — 进程内状态, 与 DB 校验双保险。 */
const orderLocks = new Map<string, Promise<unknown>>()
const orderCooldown = new Map<string, number>()
const ORDER_COOLDOWN_MS = 10 * 60 * 1000

/** 卖家手动回复后暂停该会话自动回复 (到期时间戳; 时长读账号级 pause_duration, 0 = 不暂停, butler pause_chat 语义)。 */
const chatPause = new Map<string, number>()

/* ---------------------------------- 常量 (语义对齐 butler handle_message) ---------------------------------- */

/**
 * 平台系统通知文本: 只记录不回复 (butler handle_message 的系统消息清单)。
 * 这些文本由闲鱼平台以聊天消息形式下发, 误回复会造成风控与骚扰。
 */
const SYSTEM_NOTICE_TEXTS = new Set([
  '[我已拍下，待付款]',
  '[你关闭了订单，钱款已原路退返]',
  '[不想宝贝被砍价?设置不砍价回复  ]',
  '[不想宝贝被砍价?设置不砍价回复]',
  'AI正在帮你回复消息，不错过每笔订单',
  '发来一条消息',
  '发来一条新消息',
  '[买家确认收货，交易成功]',
  '快给ta一个评价吧~',
  '快给ta一个评价吧～',
  '卖家人不错？送Ta闲鱼小红花',
  '[你已确认收货，交易成功]',
  '[你已发货]',
  '已发货',
])

/** 付款成功触发关键词 (聊天卡片 reminderContent): 命中即触发自动发货 (butler _is_auto_delivery_trigger)。 */
const PAYMENT_TRIGGER_KEYWORDS = [
  '[我已付款，等待你发货]',
  '[已付款，待发货]',
  '我已付款，等待你发货',
  '[记得及时发货]',
]

function isPaymentTrigger(content: string): boolean {
  const text = String(content || '')
  return PAYMENT_TRIGGER_KEYWORDS.some((kw) => text.includes(kw))
}

function isSystemNotice(content: string): boolean {
  return SYSTEM_NOTICE_TEXTS.has(String(content || '').trim())
}

/* ---------------------------------- 入口 ---------------------------------- */

export async function handleChatEvent(
  account: string,
  msg: ParsedChatMessage,
  opts: BrainOptions,
): Promise<EngineAction[]> {
  const db = await getDb()
  const cookieId = account
  if (!cookieId) return []

  // 自己发出的消息 (手机端人工回复): 按账号 pause_duration 暂停该会话自动回复 (0 = 不暂停)
  if (msg.isSelf) {
    const pauseRow = await db
      .get<{ pause_duration: number }>('SELECT pause_duration FROM cookies WHERE id = ?', [cookieId])
      .catch(() => null)
    const pauseMinutes = Math.max(Number(pauseRow?.pause_duration ?? 10) || 0, 0)
    if (pauseMinutes > 0) chatPause.set(`${cookieId}:${msg.chatId}`, Date.now() + pauseMinutes * 60_000)
    return []
  }

  // 付款触发卡片 (先于暂停与回复链 — butler 自动发货独立于 pause_manager, 人工接入不阻断发货)
  if (isPaymentTrigger(msg.content)) {
    const orderId = extractOrderId(msg.raw)
    if (!orderId) {
      logWarn(`[${cookieId}] 检测到付款触发消息但未提取到订单号, 跳过自动发货`)
      return []
    }
    logWarn(`[${cookieId}] 付款触发: 订单 ${orderId} 商品 ${msg.itemId} → 自动发货`)
    await upsertOrderPending(db, cookieId, {
      orderId,
      itemId: msg.itemId,
      buyerId: msg.senderUserId,
      chatId: msg.chatId,
    })
    dispatchNotify(
      {
        type: 'payment',
        cookieId,
        title: '付款成功 · 买家已付款',
        fields: {
          订单号: orderId,
          商品ID: msg.itemId || '未知',
          买家: msg.senderNick || msg.senderUserId || '未知',
          处理: '已触发自动发货',
        },
        link: '/orders',
      },
      orderId,
    )
    return autoDeliver(db, cookieId, {
      orderId,
      itemId: msg.itemId,
      buyerId: msg.senderUserId,
      chatId: msg.chatId,
    }, opts)
  }

  // 人工接入暂停检查 (仅作用于回复链, 付款触发已在上方提前处理)
  const pausedUntil = chatPause.get(`${cookieId}:${msg.chatId}`)
  if (pausedUntil !== undefined) {
    if (Date.now() >= pausedUntil) chatPause.delete(`${cookieId}:${msg.chatId}`)
    else return []
  }

  // 过滤规则
  const filter = await db.get<{ keyword: string }>(
    `SELECT keyword FROM message_filters
     WHERE cookie_id = ? AND enabled = 1 AND filter_type = 'skip_reply'
       AND ? LIKE '%' || keyword || '%' LIMIT 1`,
    [cookieId, msg.content],
  )
  if (filter) {
    await addLog(db, cookieId, msg, opts, {
      process_status: 'skipped',
      decision_reason: 'skip_reply_filter',
      reply_strategy: 'none',
      matched_keyword: filter.keyword,
    })
    return []
  }

  // 平台系统通知文本: 记录后直接跳过 (与 butler 一致, 不进回复链)
  if (isSystemNotice(msg.content)) {
    await addLog(db, cookieId, msg, opts, {
      process_status: 'skipped',
      decision_reason: 'system_notice',
      reply_strategy: 'none',
    })
    return []
  }

  // 买家消息提醒 (旁路通知, 不影响回复链): 仅当通知绑定的 event_types 显式包含 message 才外发
  dispatchNotify({
    type: 'message',
    cookieId,
    title: '收到买家新消息',
    fields: {
      买家: msg.senderNick || msg.senderUserId || '未知',
      消息: msg.content.slice(0, 200),
      商品ID: msg.itemId || '未知',
    },
    link: '/reply-logs',
  }, `${msg.chatId}:${msg.createTime}`)

  const vars: Record<string, string> = {
    send_user_name: msg.senderNick,
    send_user_id: msg.senderUserId,
    send_message: msg.content,
    item_id: msg.itemId,
  }

  // 1) 关键词回复 (商品绑定 > 通用)
  const keywordHit = await matchKeywordReply(db, cookieId, msg, vars)
  if (keywordHit.result === 'empty') {
    await addLog(db, cookieId, msg, opts, {
      process_status: 'skipped',
      decision_reason: 'empty_reply',
      reply_strategy: 'keyword',
      matched_keyword: keywordHit.keyword || '',
    })
    return []
  }
  if (keywordHit.actions.length) {
    await addLog(db, cookieId, msg, opts, {
      process_status: 'success',
      decision_reason: 'reply_sent',
      reply_strategy: 'keyword',
      matched_keyword: keywordHit.keyword || '',
      reply_text: keywordHit.preview,
      send_status: 'pending',
    })
    return keywordHit.actions
  }

  // 2) AI 回复 (意图识别 + 议价控制 + 商品上下文)
  const aiReply = await getAiReply(db, cookieId, msg)
  if (aiReply) {
    await addLog(db, cookieId, msg, opts, {
      process_status: 'success',
      decision_reason: 'reply_sent',
      reply_strategy: 'ai',
      reply_text: aiReply,
      send_status: 'pending',
    })
    return [textAction(cookieId, msg, applyVars(aiReply, vars))]
  }

  // 3) 指定商品回复
  const itemReply = await db.get<{ reply_content: string }>(
    'SELECT reply_content FROM item_replay WHERE cookie_id = ? AND item_id = ? ORDER BY id DESC LIMIT 1',
    [cookieId, msg.itemId],
  )
  if (itemReply?.reply_content) {
    const text = applyVars(itemReply.reply_content, vars)
    await addLog(db, cookieId, msg, opts, {
      process_status: 'success',
      decision_reason: 'reply_sent',
      reply_strategy: 'default',
      reply_text: text,
      send_status: 'pending',
    })
    return [textAction(cookieId, msg, text)]
  }

  // 4) 默认回复 (支持只回复一次 + 图片; 账号未启用时回退系统全局 default_reply 设置, 纯文本不重复)
  let def = await db.get<any>(
    `SELECT dr.enabled, dr.reply_content, dr.reply_image_url, dr.reply_once
     FROM default_replies dr WHERE dr.cookie_id = ?`,
    [cookieId],
  )
  if (!def?.enabled) {
    const sysRow = await db
      .get<{ value: string }>("SELECT value FROM system_settings WHERE key_name = 'default_reply'")
      .catch(() => null)
    const sysText = String(sysRow?.value || '').trim()
    if (sysText) def = { enabled: 1, reply_content: sysText, reply_image_url: '', reply_once: 0 }
  }
  if (def?.enabled) {
    if (def.reply_once) {
      const seen = await db.get('SELECT id FROM default_reply_records WHERE cookie_id = ? AND chat_id = ?', [
        cookieId,
        msg.chatId,
      ])
      if (seen) return []
      await db.run('INSERT OR IGNORE INTO default_reply_records (cookie_id, chat_id) VALUES (?, ?)', [
        cookieId,
        msg.chatId,
      ])
    }
    const text = def.reply_content ? applyVars(def.reply_content, vars) : ''
    const image = (def.reply_image_url || '').trim()
    if (!text && !image) {
      await addLog(db, cookieId, msg, opts, {
        process_status: 'skipped',
        decision_reason: 'empty_reply',
        reply_strategy: 'default',
      })
      return []
    }
    const actions: EngineAction[] = []
    if (image) {
      actions.push(imageAction(cookieId, msg, image, 0))
    }
    if (text) {
      actions.push(textAction(cookieId, msg, text, image ? 1200 : 0))
    }
    await addLog(db, cookieId, msg, opts, {
      process_status: 'success',
      decision_reason: 'reply_sent',
      reply_strategy: 'default',
      reply_text: text || image,
      send_status: 'pending',
    })
    return actions
  }

  return []
}

export async function handleSystemEvent(
  account: string,
  msg: ParsedSystemMessage,
  opts: BrainOptions,
): Promise<EngineAction[]> {
  const db = await getDb()
  const cookieId = account
  if (!cookieId) return []

  // 订单状态回写 (交易卡片事件统一落 orders, 与后台订单页/统计共用)
  const orderId = msg.orderId
  if (orderId) {
    const statusMap: Record<string, string> = {
      等待买家付款: 'pending_payment',
      等待卖家发货: 'pending_ship',
      交易关闭: 'closed',
      交易成功: 'completed',
    }
    const mapped = statusMap[msg.redReminder] || 'unknown'
    const exists = await db.get('SELECT order_id, cookie_id, item_id, buyer_id FROM orders WHERE order_id = ?', [orderId])
    if (!exists) {
      await db.run(
        `INSERT INTO orders (order_id, item_id, buyer_id, order_status, cookie_id, chat_id, amount, version, system_shipped)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`,
        [orderId, msg.itemId, msg.buyerId, mapped, cookieId, msg.chatId, msg.amount || ''],
      ).catch(() => {})
    } else {
      if (mapped !== 'unknown') {
        await db.run(
          'UPDATE orders SET order_status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?',
          [mapped, orderId],
        ).catch(() => {})
      }
      // 金额回填: 卡片提取到金额且订单金额为空 (改价/小刀后卡片会重发, 只填空不覆盖)
      if (msg.amount) {
        await db.run(
          "UPDATE orders SET amount = ? WHERE order_id = ? AND (amount IS NULL OR amount = '')",
          [msg.amount, orderId],
        ).catch(() => {})
      }
    }
  }

  // 小刀卡片 (butler 同语义): 标记议价单 + 触发免拼发货, 再走正常发货链
  if (msg.cardTitle === '我已小刀，待刀成' && orderId) {
    await db.run('UPDATE orders SET is_bargain = 1, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?', [orderId]).catch(() => {})
    const shipRow = await db.get<any>('SELECT value FROM cookies WHERE id = ?', [cookieId])
    if (shipRow?.value && msg.itemId && msg.buyerId) {
      const fr = await freeshippingOrder(String(shipRow.value), orderId, String(msg.itemId), String(msg.buyerId))
      if (fr.finalCookieStr && fr.finalCookieStr !== shipRow.value) {
        await db.run('UPDATE cookies SET value = ? WHERE id = ?', [fr.finalCookieStr, cookieId]).catch(() => {})
      }
      logWarn(`[${cookieId}] 订单 ${orderId} 免拼发货: ${fr.success ? '成功' : `失败 (${fr.message.slice(0, 120)})`}`)
      await db
        .run(
          'UPDATE orders SET consign_status = ?, consign_message = ?, consign_at = CURRENT_TIMESTAMP WHERE order_id = ?',
          [fr.success ? 'success' : 'failed', fr.message.slice(0, 240), orderId],
        )
        .catch(() => {})
    }
  }

  if (msg.redReminder !== '等待卖家发货') return []
  if (!orderId) {
    logWarn(`[${cookieId}] 检测到付款事件但未提取到订单号, 跳过自动发货`)
    return []
  }

  // 会话/买家信息兜底: 纯系统卡片可能缺 chatId/buyerId, 从订单行回填 (缺失则无法发送, 跳过)
  const orderRow = await db.get<any>('SELECT buyer_id, chat_id FROM orders WHERE order_id = ?', [orderId])
  const buyerId = msg.buyerId || orderRow?.buyer_id || ''
  const chatId = msg.chatId || orderRow?.chat_id || ''
  // 付款通知 (按订单号去重: 聊天付款卡片与系统交易卡片先后到达只发首条)
  dispatchNotify(
    {
      type: 'payment',
      cookieId,
      title: '付款成功 · 买家已付款',
      fields: {
        订单号: orderId,
        商品ID: msg.itemId || '未知',
        买家: buyerId || '未知',
        处理: '已触发自动发货',
      },
      link: '/orders',
    },
    orderId,
  )
  if (!chatId || !buyerId) {
    logWarn(`[${cookieId}] 订单 ${orderId} 缺少会话/买家信息 (chatId=${chatId ? '有' : '无'}, buyerId=${buyerId ? '有' : '无'}), 等待付款卡片触发发货`)
    return []
  }
  return autoDeliver(db, cookieId, { orderId, itemId: msg.itemId, buyerId, chatId }, opts)
}

/* ---------------------------------- 订单落库 ---------------------------------- */

interface DeliveryContext {
  orderId: string
  itemId: string
  buyerId: string
  chatId: string
}

/**
 * 付款触发时把订单落为待发货 (语义对齐 butler insert_or_update_order + handle_auto_delivery_order_status)。
 * 已存在且已发货/已完成的订单不回退状态。
 */
async function upsertOrderPending(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  ctx: DeliveryContext,
): Promise<void> {
  await db
    .run(
      `INSERT INTO orders (order_id, item_id, buyer_id, order_status, cookie_id, chat_id, version, system_shipped)
       VALUES (?, ?, ?, 'pending_ship', ?, ?, 1, 0)
       ON CONFLICT(order_id) DO UPDATE SET
         order_status = CASE WHEN orders.order_status IN ('shipped', 'completed') THEN orders.order_status ELSE 'pending_ship' END,
         buyer_id = CASE WHEN orders.buyer_id IS NULL OR orders.buyer_id = '' THEN excluded.buyer_id ELSE orders.buyer_id END,
         chat_id = CASE WHEN orders.chat_id IS NULL OR orders.chat_id = '' THEN excluded.chat_id ELSE orders.chat_id END,
         updated_at = CURRENT_TIMESTAMP`,
      [ctx.orderId, ctx.itemId || '', ctx.buyerId || '', cookieId, ctx.chatId || ''],
    )
    .catch(() => {})
}

/* ---------------------------------- 回复链 ---------------------------------- */

interface KeywordHit {
  result: 'none' | 'empty' | 'hit'
  keyword?: string
  actions: EngineAction[]
  preview?: string
}

async function matchKeywordReply(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  msg: ParsedChatMessage,
  vars: Record<string, string>,
): Promise<KeywordHit> {
  const rows = await db.all<any>(
    'SELECT keyword, reply, item_id, type, image_url FROM keywords WHERE cookie_id = ?',
    [cookieId],
  )
  const content = msg.content.toLowerCase()
  const bound = rows.filter((r) => r.item_id && r.item_id === msg.itemId)
  const general = rows.filter((r) => !r.item_id)
  for (const pool of [bound, general]) {
    for (const row of pool) {
      if (!content.includes(String(row.keyword).toLowerCase())) continue
      if (row.type === 'image' && row.image_url) {
        return {
          result: 'hit',
          keyword: row.keyword,
          actions: [imageAction(cookieId, msg, row.image_url, 0)],
          preview: `[图片] ${row.image_url}`,
        }
      }
      if (!row.reply || !String(row.reply).trim()) {
        return { result: 'empty', keyword: row.keyword, actions: [] }
      }
      const text = applyVars(String(row.reply), vars)
      return { result: 'hit', keyword: row.keyword, actions: [textAction(cookieId, msg, text)], preview: text }
    }
  }
  return { result: 'none', actions: [] }
}

/* ---------------------------------- AI 回复 (语义对齐 butler ai_reply_engine) ---------------------------------- */

/** 意图类型: price=议价 / tech=技术售后 / default=通用客服。 */
type AiIntent = 'price' | 'tech' | 'default'

const PRICE_KEYWORDS = [
  '便宜', '优惠', '刀', '降价', '包邮', '价格', '多少钱', '能少', '还能', '最低', '底价',
  '实诚价', '到100', '能到', '包个邮', '给个价', '什么价',
]
const TECH_KEYWORDS = ['怎么用', '参数', '坏了', '故障', '设置', '说明书', '功能', '用法', '教程', '驱动']

function detectIntent(message: string): AiIntent {
  const msg = String(message || '').toLowerCase()
  if (PRICE_KEYWORDS.some((kw) => msg.includes(kw))) return 'price'
  if (TECH_KEYWORDS.some((kw) => msg.includes(kw))) return 'tech'
  return 'default'
}

/** 分意图默认提示词 (与 butler _init_default_prompts 一致)。 */
const DEFAULT_INTENT_PROMPTS: Record<AiIntent, string> = {
  price: `你是一位经验丰富的销售专家，擅长议价。
语言要求：简短直接，每句≤10字，总字数≤40字。
议价策略：
1. 根据议价次数递减优惠：第1次小幅优惠，第2次中等优惠，第3次最大优惠
2. 接近最大议价轮数时要坚持底线，强调商品价值
3. 优惠不能超过设定的最大百分比和金额
4. 语气要友好但坚定，突出商品优势
注意：结合商品信息、对话历史和议价设置，给出合适的回复。`,
  tech: `你是一位技术专家，专业解答产品相关问题。
语言要求：简短专业，每句≤10字，总字数≤40字。
回答重点：产品功能、使用方法、注意事项。
注意：基于商品信息回答，避免过度承诺。`,
  default: `你是一位资深电商卖家，提供优质客服。
语言要求：简短友好，每句≤10字，总字数≤40字。
回答重点：商品介绍、物流、售后等常见问题。
注意：结合商品信息，给出实用建议。`,
}

const BASE_GUARD_PROMPT =
  '你是闲鱼卖家客服, 语气亲切自然, 简洁回答买家问题, 不承诺平台外交易, 不发链接。'

/** 解析 custom_prompts: JSON 对象(按意图)优先; 纯文本作为通用兜底提示词。 */
function resolveIntentPrompts(customPrompts: string): Record<AiIntent, string> {
  const out = { ...DEFAULT_INTENT_PROMPTS }
  const raw = String(customPrompts || '').trim()
  if (!raw) return out
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of ['price', 'tech', 'default'] as AiIntent[]) {
        if (typeof parsed[key] === 'string' && parsed[key].trim()) out[key] = parsed[key]
      }
      return out
    }
  } catch {}
  // 纯文本: 覆盖 default + 兜底
  out.default = raw
  return out
}

/**
 * 解析配置行 (账号级/商品级) 的模型接入信息 — 唯一来源为 AI 配置中心。
 * ai_config_id > 0 时引用 ai_configs (配置不存在或已停用则返回 null, AI 回复跳过);
 * 未引用配置中心的行不再透传任何遗留 Key (全局 ai_api_key 已下线)。
 */
async function resolveAiEndpoint(
  db: Awaited<ReturnType<typeof getDb>>,
  conf: any,
): Promise<{ baseUrl: string; model: string; apiKey: string } | null> {
  const configId = Number(conf?.ai_config_id || 0)
  if (configId <= 0) return null
  const cfg = await db.get<any>(
    'SELECT model_name, api_key, base_url, enabled FROM ai_configs WHERE id = ?',
    [configId],
  )
  if (!cfg || !Number(cfg.enabled)) {
    logWarn(`AI 配置 #${configId} 不存在或已停用, AI 回复跳过`)
    return null
  }
  return {
    baseUrl: String(cfg.base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
    model: String(cfg.model_name || 'qwen-plus'),
    apiKey: String(cfg.api_key || ''),
  }
}

async function getAiReply(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  msg: ParsedChatMessage,
): Promise<string> {
  // 商品级 AI 配置优先 (指定商品回复页可按商品独立配置提示词/模型/议价)
  const itemConf = msg.itemId
    ? await db.get<any>('SELECT * FROM item_ai_settings WHERE cookie_id = ? AND item_id = ?', [cookieId, msg.itemId])
    : null
  const conf = itemConf && Number(itemConf.ai_enabled) === 1
    ? itemConf
    : await db.get<any>('SELECT * FROM ai_reply_settings WHERE cookie_id = ?', [cookieId])
  if (!conf?.ai_enabled) return ''
  const intent = detectIntent(msg.content)

  // 用户消息先落库 (与 butler generate_reply 一致: 保存先于一切 API 依赖检查)
  await saveConversation(db, cookieId, msg, 'user', msg.content, intent)

  // 议价轮数控制 (butler get_bargain_count: 本会话 user 消息中 intent=price 的次数, 含当前条)
  const maxBargainRounds = Math.max(parseInt(String(conf.max_bargain_rounds ?? '3'), 10) || 3, 0)
  let bargainCount = 0
  if (intent === 'price') {
    const cnt = await db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ai_conversations
       WHERE chat_id = ? AND cookie_id = ? AND intent = 'price' AND role = 'user'`,
      [msg.chatId, cookieId],
    )
    bargainCount = cnt?.c || 0
    if (maxBargainRounds > 0 && bargainCount >= maxBargainRounds) {
      logWarn(`[${cookieId}] 会话 ${msg.chatId} 议价次数已达上限 (${bargainCount}/${maxBargainRounds}), 拒绝继续议价`)
      const refuse = '抱歉，这个价格已经是最优惠的了，不能再便宜了哦！'
      await saveConversation(db, cookieId, msg, 'assistant', refuse, intent)
      return refuse
    }
  }

  const endpoint = await resolveAiEndpoint(db, conf)
  if (!endpoint) return ''

  // 商品上下文 (butler get_ai_reply: item_info → title/price/desc)
  const itemRow = msg.itemId
    ? await db.get<any>(
        'SELECT item_title, item_price, item_description, item_detail FROM item_info WHERE cookie_id = ? AND item_id = ?',
        [cookieId, msg.itemId],
      )
    : null
  const itemTitle = itemRow?.item_title || '未知商品'
  const itemPrice = itemRow?.item_price || '未知'
  const itemDesc = itemRow?.item_detail || itemRow?.item_description || '暂无商品描述'

  // 对话历史
  const history: { role: 'user' | 'assistant'; content: string }[] = []
  if (conf.context_enabled) {
    const cutoff = new Date(Date.now() - (conf.context_expire_minutes || 120) * 60_000).toISOString()
    const rows = await db.all<any>(
      `SELECT role, content FROM ai_conversations
       WHERE cookie_id = ? AND chat_id = ? AND created_at > ?
       ORDER BY id DESC LIMIT ?`,
      [cookieId, msg.chatId, cutoff, Math.min(conf.context_message_limit || 12, 30)],
    )
    for (const r of rows.reverse()) history.push({ role: r.role, content: r.content })
  }

  // 提示词组装 (butler generate_reply 的 user_prompt 结构)
  const prompts = resolveIntentPrompts(conf.custom_prompts)
  const systemPrompt = prompts[intent]
  const historyStr = history.slice(-10).map((h) => `${h.role === 'user' ? '买家' : '客服'}: ${h.content}`).join('\n')
  const userPrompt = `商品信息：
商品标题: ${itemTitle}
商品价格: ${itemPrice}元
商品描述: ${itemDesc}

对话历史：
${historyStr || '（无）'}

议价设置：
- 当前议价次数：${bargainCount}
- 最大议价轮数：${maxBargainRounds}
- 最大优惠百分比：${conf.max_discount_percent ?? 10}%
- 最大优惠金额：${conf.max_discount_amount ?? 100}元

买家昵称: ${msg.senderNick}
买家消息：${msg.content}

请根据以上信息生成回复：`

  const reply = await callAiApi(endpoint.baseUrl, endpoint.model, endpoint.apiKey, systemPrompt, userPrompt, history)
  if (!reply) return ''

  await saveConversation(db, cookieId, msg, 'assistant', reply, intent)
  return reply
}

async function saveConversation(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  msg: ParsedChatMessage,
  role: 'user' | 'assistant',
  content: string,
  intent: AiIntent,
): Promise<void> {
  await db
    .run(
      'INSERT INTO ai_conversations (cookie_id, chat_id, user_id, item_id, role, content, intent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [cookieId, msg.chatId, msg.senderUserId, msg.itemId, role, content, intent],
    )
    .catch(() => {})
}

/** AI 服务调用分派: Gemini(模型名含 gemini) / DashScope 应用(base_url 含 /apps/) / OpenAI 兼容(默认)。 */
async function callAiApi(
  baseUrlRaw: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const baseUrl = baseUrlRaw.replace(/\/+$/, '')
  try {
    if (model.toLowerCase().includes('gemini')) {
      return await callGeminiApi(model, apiKey, systemPrompt, userPrompt)
    }
    if (baseUrl.includes('/apps/')) {
      return await callDashscopeAppApi(baseUrl, apiKey, systemPrompt, userPrompt)
    }
    return await callOpenAiCompatibleApi(baseUrl, model, apiKey, systemPrompt, userPrompt, history)
  } catch (e: any) {
    logWarn(`AI 接口调用失败: ${e?.message}`)
    return ''
  }
}

async function callOpenAiCompatibleApi(
  baseUrl: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userPrompt }],
      max_tokens: 300,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const json: any = await res.json()
  return String(json?.choices?.[0]?.message?.content || '').trim()
}

async function callGeminiApi(model: string, apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    },
  )
  const json: any = await res.json()
  return String(json?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim()
}

async function callDashscopeAppApi(baseUrl: string, apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const appId = baseUrl.split('/apps/')[1]?.split('/')[0] || ''
  if (!appId) throw new Error('DashScope 应用 URL 中未找到 app_id')
  const res = await fetch(`https://dashscope.aliyuncs.com/api/v1/apps/${appId}/completion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      input: { prompt: `${systemPrompt}\n\n用户问题：${userPrompt}\n\n请直接回答用户的问题：` },
      parameters: { max_tokens: 300, temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const json: any = await res.json()
  return String(json?.output?.text || '').trim()
}

/* ---------------------------------- 自动发货 ---------------------------------- */

/**
 * 自动发货主流程 (语义对齐 butler _handle_auto_delivery + _auto_delivery)。
 * 调用前提: 订单已落库为 pending_ship (付款触发由调用方先 upsert)。
 */
async function autoDeliver(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  ctx: DeliveryContext,
  opts: BrainOptions,
): Promise<EngineAction[]> {
  const orderId = ctx.orderId

  // 订单归属三重校验 (防伪造文本/串号误发)
  const order = await db.get<any>(
    'SELECT order_id, cookie_id, item_id, buyer_id, order_status, quantity FROM orders WHERE order_id = ?',
    [orderId],
  )
  if (order) {
    if (order.cookie_id && String(order.cookie_id) !== String(cookieId)) return []
    if (order.item_id && ctx.itemId && String(order.item_id) !== String(ctx.itemId)) return []
    if (order.buyer_id && ctx.buyerId && String(order.buyer_id) !== String(ctx.buyerId)) return []
  }
  const localStatus = order?.order_status
  if (localStatus && !['pending_ship', 'unknown'].includes(localStatus)) {
    logWarn(`[${cookieId}] 订单 ${orderId} 状态为 ${localStatus}, 跳过自动发货`)
    return []
  }

  // 内存锁 + 冷却 (跨消息去重)
  if (orderCooldown.get(orderId) && Date.now() - (orderCooldown.get(orderId) || 0) < ORDER_COOLDOWN_MS) return []
  const existing = orderLocks.get(orderId)
  if (existing) {
    await existing.catch(() => {})
    return []
  }

  const run = (async () => {
    orderCooldown.set(orderId, Date.now())
    const buyerId = ctx.buyerId || order?.buyer_id || ''
    const chatId = ctx.chatId || order?.chat_id || ''

    // 商品归属校验: 商品必须属于当前账号; 缺失时按需拉取详情补齐 (butler get_item_info 行为)
    let item = ctx.itemId
      ? await db.get<any>(
          'SELECT item_id, item_title, item_description, item_detail, multi_quantity_delivery FROM item_info WHERE cookie_id = ? AND item_id = ?',
          [cookieId, ctx.itemId],
        )
      : null
    if (!item && ctx.itemId) {
      item = await backfillItemInfo(db, cookieId, ctx.itemId)
    }
    if (!item) {
      logWarn(`[${cookieId}] 商品 ${ctx.itemId || '未知'} 不属于当前账号, 跳过自动发货`)
      return []
    }

    // 规则匹配: payment 触发按商品直配; keyword 触发与商品标题/详情双向模糊匹配, 必须唯一
    const rules = await db.all<any>(
      `SELECT * FROM delivery_rules
       WHERE enabled = 1 AND (cookie_id IS NULL OR cookie_id = '' OR cookie_id = ?)
       ORDER BY id ASC`,
      [cookieId],
    )
    const paymentRules = rules.filter((r) => r.trigger_type === 'payment' && r.item_id === ctx.itemId)
    let rule = paymentRules[0] || null
    if (!rule) {
      const haystack = `${item.item_title || ''} ${item.item_description || ''} ${item.item_detail || ''}`.toLowerCase().trim()
      const kwRules = rules.filter((r) => {
        if (r.trigger_type !== 'keyword') return false
        const kw = String(r.keyword || '').toLowerCase().trim()
        if (!kw) return false
        return haystack.includes(kw) || kw.includes(haystack)
      })
      if (kwRules.length === 1) rule = kwRules[0]
      else if (kwRules.length > 1) {
        logWarn(`[${cookieId}] 订单 ${orderId} 命中 ${kwRules.length} 条关键词规则, 不唯一, 跳过自动发货`)
        return []
      }
    }
    if (!rule) {
      logWarn(`[${cookieId}] 订单 ${orderId} 无匹配发货规则`)
      dispatchNotify(
        {
          type: 'delivered',
          cookieId,
          title: '自动发货失败 · 无匹配发货规则',
          fields: { 订单号: orderId, 商品ID: ctx.itemId || '未知', 原因: '请检查发货规则 (商品直配或关键词匹配)' },
          link: '/delivery',
        },
        orderId,
      )
      return []
    }

    // require_paid: 本地订单已确认 pending_ship 视为已付款 (付款触发路径已先落库)
    if (rule.require_paid && localStatus !== 'pending_ship') {
      logWarn(`[${cookieId}] 订单 ${orderId} 付款状态未确认, 拒绝自动发货`)
      return []
    }

    // 卡券加载 + 内容提取 (text/data 原子扣减, api 实时拉取, image 直接发送)
    const card = await db.get<any>('SELECT * FROM cards WHERE id = ? AND enabled = 1', [rule.card_id])
    if (!card) {
      logWarn(`[${cookieId}] 规则 ${rule.id} 绑定的卡券不存在或已停用`)
      dispatchNotify(
        {
          type: 'delivered',
          cookieId,
          title: '自动发货失败 · 卡券不可用',
          fields: { 订单号: orderId, 原因: `规则 #${rule.id} 绑定的卡券不存在或已停用` },
          link: '/delivery',
        },
        orderId,
      )
      return []
    }
    // 发送数量 = 订单数量(多数量发货开启时) × delivery_count (卡密型按份逐一生成, 需先于内容提取)
    const orderQty = item.multi_quantity_delivery ? Math.max(parseInt(String(order?.quantity || '1'), 10) || 1, 1) : 1
    const perDelivery = Math.max(parseInt(String(rule.delivery_count || '1'), 10) || 1, 1)
    const total = Math.min(orderQty * perDelivery, 20)
    const delayMs = Math.max(parseInt(String(card.delay_seconds || '0'), 10) || 0, 0) * 1000

    // 卡券内容提取 (text 原文, data 按行原子扣减, code 按份生成随机卡密, api 实时拉取, image 直接发送)
    const extract = await extractCardContent(db, card, cookieId, total)
    if (!extract.items.length) {
      logWarn(`[${cookieId}] 卡券「${card.name}」无可用内容, 跳过自动发货`)
      dispatchNotify(
        {
          type: 'delivered',
          cookieId,
          title: '自动发货失败 · 卡券已发完',
          fields: { 订单号: orderId, 卡券: card.name, 原因: '卡券无可用内容 (库存已扣减完或为空)' },
          link: '/cards',
        },
        orderId,
      )
      return []
    }

    // 金额回填: 订单无金额时用商品定价填充 (卡片/详情后续可修正为实付价)
    const accountRow = await db.get<any>('SELECT value, auto_confirm FROM cookies WHERE id = ?', [cookieId])
    if (orderId && item.item_price) {
      await db
        .run(
          "UPDATE orders SET amount = CASE WHEN amount IS NULL OR amount = '' THEN ? ELSE amount END WHERE order_id = ?",
          [String(item.item_price), orderId],
        )
        .catch(() => {})
    }

    // 无需邮寄发货 (真实平台接口 mtop.taobao.idle.logistic.consign.dummy, 已实测幂等):
    // 规则 ship_mode 优先; 旧行为兼容: 未配置时沿用账号级 auto_confirm 开关
    const shipMode = String(rule.ship_mode || (accountRow?.auto_confirm ? 'dummy_consign' : 'none') || 'none')
    if (shipMode === 'dummy_consign' && orderId) {
      if (delayMs > 0) await sleep(delayMs)
      const confirm = await confirmOrderShipped(String(accountRow?.value || ''), orderId)
      if (confirm.finalCookieStr && confirm.finalCookieStr !== accountRow?.value) {
        await db.run('UPDATE cookies SET value = ? WHERE id = ?', [confirm.finalCookieStr, cookieId]).catch(() => {})
      }
      await db
        .run(
          'UPDATE orders SET consign_status = ?, consign_message = ?, consign_at = CURRENT_TIMESTAMP WHERE order_id = ?',
          [confirm.success ? 'success' : 'failed', confirm.message.slice(0, 240), orderId],
        )
        .catch(() => {})
      logWarn(`[${cookieId}] 订单 ${orderId} 无需邮寄发货: ${confirm.success ? '成功' : `失败 (${confirm.message.slice(0, 120)})`}`)
    }

    // 卡密型: 先落库生成记录 (唯一约束防重发, 冲突自动重试换码), 保证文案与落库码一致
    if (extract.generatedCodes?.length) {
      for (let i = 0; i < extract.generatedCodes.length; i++) {
        const finalCode = await persistCardCode(
          db,
          card,
          { cookieId, itemId: String(ctx.itemId || ''), orderId, buyerId },
          extract.generatedCodes[i],
        )
        if (finalCode && finalCode !== extract.generatedCodes[i]) {
          extract.generatedCodes[i] = finalCode
          const item = extract.items[i]
          if (item) {
            item.parts = [{ kind: 'text', value: renderCodeTemplate(card.code_template, finalCode) }]
            item.preview = `[卡密] ${finalCode}`
          }
        }
      }
    }

    const actions: EngineAction[] = []
    // 卡券内容交付消息 (是否发送/发什么由卡券管理配置决定):
    // 卡密型按份生成随机卡密并渲染文案模板, 文本/API/图片型原样发送内容
    for (let i = 0; i < total; i++) {
      const content = extract.items[i % extract.items.length]
      for (const part of content.parts) {
        if (part.kind === 'text') {
          actions.push({
            type: 'send_text',
            account: cookieId,
            chat_id: chatId,
            to_user_id: buyerId,
            text: part.value,
            delay_ms: 0,
          })
        } else {
          actions.push({
            type: 'send_image',
            account: cookieId,
            chat_id: chatId,
            to_user_id: buyerId,
            image_url: part.value,
            width: 800,
            height: 600,
            delay_ms: 0,
          })
        }
      }
    }
    // 消息回复 (卡券级附加消息): 留空则发货时不同时发送消息
    const replyMsg = String(card.description || '').trim()
    if (replyMsg) {
      actions.push({
        type: 'send_text',
        account: cookieId,
        chat_id: chatId,
        to_user_id: buyerId,
        text: replyMsg,
        delay_ms: 0,
      })
    }

    // 落库: 发货记录 + 订单状态 + 规则计数
    for (const content of extract.items) {
      await db
        .run(
          `INSERT INTO card_shipments (card_id, card_name, content, order_id, item_id, buyer_id, cookie_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [card.id, card.name, content.preview, orderId, ctx.itemId, buyerId, cookieId],
        )
        .catch(() => {})
    }
    await db
      .run(
        `UPDATE orders SET order_status = 'shipped', system_shipped = 1, updated_at = CURRENT_TIMESTAMP
         WHERE order_id = ?`,
        [orderId],
      )
      .catch(() => {})
    await db
      .run('UPDATE delivery_rules SET delivery_times = COALESCE(delivery_times, 0) + 1 WHERE id = ?', [rule.id])
      .catch(() => {})

    logWarn(
      `[${cookieId}] 订单 ${orderId} 自动发货: 卡券「${card.name}」× ${total} (规则 ${rule.id}, 来源 ${opts.source})`,
    )
    dispatchNotify(
      {
        type: 'delivered',
        cookieId,
        title: `自动发货成功 · ${card.name}`,
        fields: {
          订单号: orderId,
          商品ID: ctx.itemId || '未知',
          发送内容: `${total} 份`,
          ...(extract.generatedCodes?.length ? { 卡密: extract.generatedCodes.join(', ') } : {}),
          规则: `#${rule.id}`,
        },
        link: '/orders',
      },
      orderId,
    )
    return actions
  })()

  const lock = run.finally(() => {
    orderLocks.delete(orderId)
  })
  orderLocks.set(orderId, lock)
  return lock
}

/** 商品缺失时通过 mtop 拉取详情并补齐 item_info (butler get_item_info + save_item_info_to_db)。 */
async function backfillItemInfo(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  itemId: string,
): Promise<any | null> {
  const accountRow = await db.get<any>('SELECT value FROM cookies WHERE id = ?', [cookieId])
  if (!accountRow?.value) return null
  try {
    const { detail, finalCookieStr } = await fetchItemDetail(String(accountRow.value), itemId)
    if (finalCookieStr && finalCookieStr !== accountRow.value) {
      await db.run('UPDATE cookies SET value = ? WHERE id = ?', [finalCookieStr, cookieId]).catch(() => {})
    }
    if (!detail) return null
    await db
      .run(
        `INSERT INTO item_info (cookie_id, item_id, item_title, item_description, item_price, item_detail, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(cookie_id, item_id) DO UPDATE SET
           item_title = excluded.item_title,
           item_description = excluded.item_description,
           item_price = excluded.item_price,
           item_detail = excluded.item_detail,
           updated_at = CURRENT_TIMESTAMP`,
        [cookieId, itemId, detail.item_title, detail.item_desc, detail.item_price, detail.item_desc],
      )
      .catch(() => {})
    logWarn(`[${cookieId}] 商品 ${itemId} 详情已按需补齐: ${detail.item_title}`)
    return await db.get<any>(
      'SELECT item_id, item_title, item_description, item_detail, multi_quantity_delivery FROM item_info WHERE cookie_id = ? AND item_id = ?',
      [cookieId, itemId],
    )
  } catch (e: any) {
    logWarn(`[${cookieId}] 商品 ${itemId} 详情拉取失败: ${e?.message}`)
    return null
  }
}

/** 卡券内容提取: text/code/api/image 四类型 (code 按份生成随机卡密; 遗留 data 按行原子扣减)。 */
async function extractCardContent(
  db: Awaited<ReturnType<typeof getDb>>,
  card: any,
  cookieId: string,
  count = 1,
): Promise<{ items: { parts: { kind: 'text' | 'image'; value: string }[]; preview: string }[]; generatedCodes?: string[] }> {
  const parts: { kind: 'text' | 'image'; value: string }[] = []
  const previewOf = () => parts.map((p) => (p.kind === 'image' ? `[图片] ${p.value}` : p.value)).join(' | ')

  if (card.type === 'text') {
    if (card.text_content) parts.push({ kind: 'text', value: String(card.text_content) })
  } else if (card.type === 'image') {
    if (card.image_url) parts.push({ kind: 'image', value: String(card.image_url) })
    if (card.text_content) parts.push({ kind: 'text', value: String(card.text_content) })
  } else if (card.type === 'code') {
    const items: { parts: { kind: 'text'; value: string }[]; preview: string }[] = []
    const generatedCodes: string[] = []
    for (let i = 0; i < Math.max(1, count); i++) {
      const code = generateCardCode(card)
      generatedCodes.push(code)
      items.push({
        parts: [{ kind: 'text', value: renderCodeTemplate(card.code_template, code) }],
        preview: `[卡密] ${code}`,
      })
    }
    return { items, generatedCodes }
  } else if (card.type === 'data') {
    const raw = String(card.data_content || '')
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length) {
      const taken = lines.shift() as string
      await db
        .run('UPDATE cards SET data_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
          lines.join('\n'),
          card.id,
        ])
        .catch(() => {})
      parts.push({ kind: 'text', value: taken })
    }
  } else if (card.type === 'api') {
    try {
      const conf = JSON.parse(String(card.api_config || '{}'))
      const res = await fetch(String(conf.url || ''), {
        method: String(conf.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
        headers: conf.headers && typeof conf.headers === 'object' ? conf.headers : { 'content-type': 'application/json' },
        body: conf.method === 'POST' && conf.body != null ? JSON.stringify(conf.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      })
      const json: any = await res.json().catch(() => null)
      const path = String(conf.data_path || 'data')
      let value: any = json
      for (const seg of path.split('.')) {
        if (value == null) break
        value = value[seg]
      }
      const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
      if (text) parts.push({ kind: 'text', value: text })
    } catch (e: any) {
      logWarn(`[${cookieId}] API 卡券拉取失败: ${e?.message}`)
    }
  }

  if (!parts.length) return { items: [] }
  return { items: [{ parts, preview: previewOf() }] }
}

/* ---------------------------------- 工具 ---------------------------------- */

function textAction(cookieId: string, msg: ParsedChatMessage, text: string, delayMs = 0): EngineAction {
  return { type: 'send_text', account: cookieId, chat_id: msg.chatId, to_user_id: msg.senderUserId, text, delay_ms: delayMs }
}

function imageAction(
  cookieId: string,
  msg: ParsedChatMessage,
  imageUrl: string,
  delayMs = 0,
): EngineAction {
  return {
    type: 'send_image',
    account: cookieId,
    chat_id: msg.chatId,
    to_user_id: msg.senderUserId,
    image_url: imageUrl,
    width: 800,
    height: 600,
    delay_ms: delayMs,
  }
}

/** 变量替换: {send_user_name}/{send_user_id}/{send_message}/{item_id}。 */
function applyVars(template: string, vars: Record<string, string>): string {
  return String(template || '')
    .replaceAll('{send_user_name}', vars.send_user_name)
    .replaceAll('{send_user_id}', vars.send_user_id)
    .replaceAll('{send_message}', vars.send_message)
    .replaceAll('{item_id}', vars.item_id)
}

async function addLog(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  msg: ParsedChatMessage,
  opts: BrainOptions,
  fields: Record<string, string>,
): Promise<void> {
  await db
    .run(
      `INSERT INTO auto_reply_logs
       (cookie_id, chat_id, item_id, sender_user_id, sender_user_name, source_message,
        process_status, decision_reason, reply_strategy, matched_keyword, reply_text, send_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cookieId,
        msg.chatId,
        msg.itemId,
        msg.senderUserId,
        msg.senderNick,
        msg.content.slice(0, 500),
        fields.process_status || 'success',
        fields.decision_reason || '',
        fields.reply_strategy || 'none',
        fields.matched_keyword || '',
        fields.reply_text || '',
        fields.send_status || 'unknown',
      ],
    )
    .catch(() => {})
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function logWarn(msg: string): void {
  console.log(`[xianyu-brain] ${msg}`)
}

/**
 * AI 配置连通性测试 (后台「发送测试」按钮, 语义对齐 butler /ai-reply-test/{cookie_id})。
 * 使用与引擎完全相同的配置读取、意图识别与提示词组装, 但不落库会话、不计议价轮数。
 */
export async function testAiReply(
  cookieId: string,
  testMessage: string,
  itemCtx?: { item_title?: string; item_price?: string; item_desc?: string },
): Promise<{ ok: boolean; reply: string; model: string; error: string }> {
  const db = await getDb()
  const conf = await db.get<any>('SELECT * FROM ai_reply_settings WHERE cookie_id = ?', [cookieId])
  if (!conf) return { ok: false, reply: '', model: '', error: '该账号尚未保存 AI 配置' }

  const endpoint = await resolveAiEndpoint(db, conf)
  if (!endpoint) {
    const configId = Number(conf.ai_config_id || 0)
    return {
      ok: false,
      reply: '',
      model: String(conf.model_name || ''),
      error: configId > 0 ? '所选 AI 配置不存在或已停用' : '未配置模型接入 (请在 AI 配置中心选择配置)',
    }
  }
  if (!conf.ai_enabled) {
    return { ok: false, reply: '', model: String(conf.model_name || ''), error: '该账号未启用 AI 回复' }
  }

  const message = String(testMessage || '你好').trim() || '你好'
  const intent = detectIntent(message)
  const prompts = resolveIntentPrompts(conf.custom_prompts)
  const userPrompt = `商品信息：
商品标题: ${itemCtx?.item_title || '测试商品'}
商品价格: ${itemCtx?.item_price || '100'}元
商品描述: ${itemCtx?.item_desc || '这是一个测试商品'}

对话历史：
（无）

议价设置：
- 当前议价次数：0
- 最大议价轮数：${conf.max_bargain_rounds ?? 3}
- 最大优惠百分比：${conf.max_discount_percent ?? 10}%
- 最大优惠金额：${conf.max_discount_amount ?? 100}元

买家昵称: 测试买家
买家消息：${message}

请根据以上信息生成回复：`

  const reply = await callAiApi(
    endpoint.baseUrl,
    endpoint.model,
    endpoint.apiKey,
    prompts[intent],
    userPrompt,
    [],
  )
  if (!reply) {
    return { ok: false, reply: '', model: endpoint.model, error: 'AI 接口未返回内容, 请检查 API 地址 / 模型名 / Key (详见服务端日志)' }
  }
  return { ok: true, reply, model: endpoint.model, error: '' }
}

/**
 * AI 配置中心连通性探针: 直接用 ai_configs 行的接入信息调一次大模型 (管理页「测试」按钮)。
 * 与引擎 getAiReply 同一条 callAiApi 分派链路, 不落库、不依赖账号。
 */
export async function probeAiConfig(
  conf: { base_url: string; model_name: string; api_key: string },
  testMessage: string,
): Promise<{ ok: boolean; reply: string; model: string; error: string }> {
  const model = String(conf.model_name || 'qwen-plus')
  const apiKey = String(conf.api_key || '')
  if (!apiKey) return { ok: false, reply: '', model, error: '该配置未填写 API Key' }
  const message = String(testMessage || '你好').trim() || '你好'
  const intent = detectIntent(message)
  const prompts = resolveIntentPrompts('')
  const userPrompt = `商品信息：
商品标题: 测试商品
商品价格: 100元
商品描述: 这是一个测试商品

对话历史：
（无）

议价设置：
- 当前议价次数：0
- 最大议价轮数：0
- 最大优惠百分比：0%
- 最大优惠金额：0元

买家昵称: 测试买家
买家消息：${message}

请根据以上信息生成回复：`
  const reply = await callAiApi(
    String(conf.base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
    model,
    apiKey,
    prompts[intent],
    userPrompt,
    [],
  )
  if (!reply) {
    return { ok: false, reply: '', model, error: 'AI 接口未返回内容, 请检查 API 地址 / 模型名 / Key (详见服务端日志)' }
  }
  return { ok: true, reply, model, error: '' }
}
