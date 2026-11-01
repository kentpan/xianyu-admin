/**
 * card-code — 卡密型卡券的随机卡密生成 + 生成记录/核销生命周期。
 *
 * 配置 (cards 表 code_* 列): 长度 / 是否含英文字母 / 是否含数字 / 字母大小写 / 发送文案。
 * 文案支持 {code} 占位符, 发货时替换为本次生成的卡密。
 *
 * 生命周期: 发货时生成卡密 → 落库 card_code_logs (status=unused, 含时间/卡券/账号/商品/订单/买家)
 *           → 业务方携 Authorization: Bearer <apikey> 调 /api/verify-codes/verify 核销
 *           → 核销后 status=used 并留痕核销方/时间/IP。
 */
import crypto from 'node:crypto'
import type { DatabaseAdapter } from './db'

export const DEFAULT_CODE_TEMPLATE = '你的验证码为: {code}, 请复制后加群验证!'

export interface CardCodeConfig {
  code_length?: number | string | null
  code_letters?: number | string | null
  code_digits?: number | string | null
  code_case?: string | null
  code_template?: string | null
}

/** 按卡券配置生成一个随机卡密 (crypto.randomInt 无模偏; 英文/数字至少保底数字)。 */
export function generateCardCode(card: CardCodeConfig): string {
  const length = Math.min(32, Math.max(4, Math.round(Number(card.code_length ?? 6) || 6)))
  const wantLetters = Number(card.code_letters ?? 1) === 1
  const wantDigits = Number(card.code_digits ?? 1) === 1
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const upper = lower.toUpperCase()
  let pool = ''
  if (wantLetters) {
    const cs = card.code_case === 'lower' ? lower : card.code_case === 'upper' ? upper : lower + upper
    pool += cs
  }
  if (wantDigits || !pool) pool += '0123456789'
  let out = ''
  for (let i = 0; i < length; i++) out += pool[crypto.randomInt(0, pool.length)]
  return out
}

/** 文案模板渲染: {code} → 卡密; 空模板回落默认文案。 */
export function renderCodeTemplate(template: string | null | undefined, code: string): string {
  const t = String(template ?? '').trim() || DEFAULT_CODE_TEMPLATE
  return t.replaceAll('{code}', code)
}

/**
 * 卡密生成落库 (时间/卡券/账号/商品/订单/买家, status=unused 待核销)。
 * source: ''=真实发货, 'test'=卡密发货测试 (测试卡密同样可被消费 API 核销, 记录带测试标签)。
 * 优先落 preferredCode (extract 阶段预生成并已渲染进文案); 唯一冲突时重新生成重试,
 * 返回最终生效的卡密 (与文案一致), 失败不阻断发货。
 */
export async function persistCardCode(
  db: DatabaseAdapter,
  card: CardCodeConfig & { id: number; name: string },
  ctx: { cookieId?: string; itemId?: string; orderId?: string; buyerId?: string },
  preferredCode?: string,
  source = '',
): Promise<string | null> {
  let code = String(preferredCode || '') || generateCardCode(card)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.run(
        `INSERT INTO card_code_logs (card_id, card_name, code, cookie_id, item_id, order_id, buyer_id, status, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unused', ?)`,
        [
          card.id || 0,
          String(card.name || '').slice(0, 128),
          code,
          String(ctx.cookieId || ''),
          String(ctx.itemId || ''),
          String(ctx.orderId || ''),
          String(ctx.buyerId || ''),
          source === 'test' ? 'test' : '',
        ],
      )
      return code
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        code = generateCardCode(card)
        continue
      }
      console.error('[card-code] persist failed:', msg)
      return null
    }
  }
  return null
}

export interface ConsumeOutcome {
  valid: boolean
  reason: string
  row?: {
    id: number
    code: string
    card_name: string
    order_id: string
    item_id: string
    buyer_id: string
    status: string
    used_at: string | null
    source?: string
  }
}

/**
 * 核销卡密: unused → 原子置为 used 并回执分配信息; 其余情形给出明确失败原因。
 * 原子性: UPDATE ... WHERE code = ? AND status = 'unused', 以受影响行数判定, 防并发双花。
 */
export async function consumeCardCode(
  db: DatabaseAdapter,
  rawCode: string,
  apiKeyId: number,
  ip: string,
): Promise<ConsumeOutcome> {
  const code = String(rawCode || '').trim()
  if (!code || code.length > 64 || !/^[A-Za-z0-9_-]+$/.test(code)) {
    return { valid: false, reason: '卡密格式错误' }
  }
  const row = await db.get<any>(
    `SELECT l.*, k.name AS used_by_key_name
     FROM card_code_logs l LEFT JOIN api_keys k ON k.id = l.used_by_key_id
     WHERE l.code = ?`,
    [code],
  )
  if (!row) {
    return { valid: false, reason: '卡密不存在' }
  }
  if (row.status === 'used') {
    return {
      valid: false,
      reason: `卡密已被使用 (使用时间 ${row.used_at || '未知'})`,
      row: { id: row.id, code, card_name: row.card_name, order_id: row.order_id, item_id: row.item_id, buyer_id: row.buyer_id, status: row.status, used_at: row.used_at, source: row.source || '' },
    }
  }
  const usedAt = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const r = await db.run(
    `UPDATE card_code_logs
     SET status = 'used', used_at = ?, used_ip = ?, used_by_key_id = ?
     WHERE code = ? AND status = 'unused'`,
    [usedAt, ip, apiKeyId, code],
  )
  if (!r.changes) {
    return { valid: false, reason: '卡密状态已变化, 请重新查询' }
  }
  return {
    valid: true,
    reason: '验证通过',
    row: { id: row.id, code, card_name: row.card_name, order_id: row.order_id, item_id: row.item_id, buyer_id: row.buyer_id, status: 'used', used_at: usedAt, source: row.source || '' },
  }
}

export interface CardConsumeEntry {
  codeId?: number
  code: string
  cardName?: string
  orderId?: string
  itemId?: string
  buyerId?: string
  apiKeyId?: number
  apiKeyName?: string
  ip?: string
  result: 'success' | 'failed'
  message?: string
  /** 来源标记: 从被核销卡密的 card_code_logs.source 带出 ('test'=测试卡密核销) */
  source?: string
}

/**
 * 消费留痕: 每次外部核销请求 (成功/失败) 落 card_consume_logs 一条。
 * 与核销主流程解耦 — 留痕失败只打日志, 不阻塞核销响应 (核销原子性由 consumeCardCode 保证)。
 */
export async function recordCardConsume(db: DatabaseAdapter, entry: CardConsumeEntry): Promise<void> {
  try {
    await db.run(
      `INSERT INTO card_consume_logs (code_id, code, card_name, order_id, item_id, buyer_id, api_key_id, api_key_name, ip, result, message, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.codeId || 0,
        String(entry.code || '').slice(0, 64),
        String(entry.cardName || '').slice(0, 128),
        String(entry.orderId || ''),
        String(entry.itemId || ''),
        String(entry.buyerId || ''),
        entry.apiKeyId || 0,
        String(entry.apiKeyName || '').slice(0, 128),
        String(entry.ip || '').slice(0, 64),
        entry.result === 'success' ? 'success' : 'failed',
        String(entry.message || '').slice(0, 240),
        entry.source === 'test' ? 'test' : '',
      ],
    )
  } catch (e: any) {
    console.error('[card-code] consume log failed:', String(e?.message || e))
  }
}
