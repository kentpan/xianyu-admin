/**
 * verify-codes — 提货验证码 (8 位随机卡密) 生命周期。
 *
 * 发放: 无需邮寄自动发货规则开启 send_verify_code 后, 发货时生成唯一 8 位码落库
 *       并作为聊天消息发给买家。
 * 核销: 外部业务方携 Authorization: Bearer <apikey> 调用 /api/verify-codes/verify,
 *       未使用 → 标记已使用并回执订单/商品信息; 已使用/不存在 → 回执失败原因。
 */
import { getDb } from './db'
import { generateVerifyCode } from './api-key-auth'

export interface IssuedCode {
  id: number
  code: string
}

/** 生成全局唯一 8 位验证码并落库 (冲突重试, 理论概率极低)。 */
export async function issueVerifyCode(
  db: Awaited<ReturnType<typeof getDb>>,
  ctx: { orderId: string; itemId: string; buyerId: string; cookieId: string; ruleId: number; cardId: number },
): Promise<IssuedCode | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateVerifyCode()
    try {
      const r = await db.run(
        `INSERT INTO verify_codes (code, order_id, item_id, buyer_id, cookie_id, rule_id, card_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [code, ctx.orderId || '', ctx.itemId || '', ctx.buyerId || '', ctx.cookieId || '', ctx.ruleId || 0, ctx.cardId || 0],
      )
      return { id: Number(r.lastInsertId), code }
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('UNIQUE') || msg.includes('unique')) continue
      console.error('[verify-codes] issue failed:', msg)
      return null
    }
  }
  return null
}

export interface VerifyOutcome {
  valid: boolean
  reason: string
  row?: {
    id: number
    code: string
    order_id: string
    item_id: string
    buyer_id: string
    status: string
    used_at: string | null
  }
}

/**
 * 核销验证码: unused → 原子置为 used 并回执信息; 其余情形给出明确失败原因。
 * 原子性: UPDATE ... WHERE code = ? AND status = 'unused', 以受影响行数判定, 防并发双花。
 */
export async function consumeVerifyCode(
  db: Awaited<ReturnType<typeof getDb>>,
  rawCode: string,
  apiKeyId: number,
  ip: string,
): Promise<VerifyOutcome> {
  const code = String(rawCode || '').trim()
  if (!/^\d{8}$/.test(code)) {
    return { valid: false, reason: '验证码格式错误 (应为 8 位数字)' }
  }
  const row = await db.get<any>('SELECT * FROM verify_codes WHERE code = ?', [code])
  if (!row) {
    return { valid: false, reason: '验证码不存在' }
  }
  if (row.status === 'used') {
    return {
      valid: false,
      reason: `验证码已被使用 (使用时间 ${row.used_at || '未知'})`,
      row: { id: row.id, code, order_id: row.order_id, item_id: row.item_id, buyer_id: row.buyer_id, status: row.status, used_at: row.used_at },
    }
  }
  const r = await db.run(
    `UPDATE verify_codes
     SET status = 'used', used_at = CURRENT_TIMESTAMP, used_by_key_id = ?, used_ip = ?, updated_at = CURRENT_TIMESTAMP
     WHERE code = ? AND status = 'unused'`,
    [apiKeyId, ip, code],
  )
  if (!r.changes) {
    return { valid: false, reason: '验证码状态已变化, 请重新查询' }
  }
  return {
    valid: true,
    reason: '验证通过',
    row: { id: row.id, code, order_id: row.order_id, item_id: row.item_id, buyer_id: row.buyer_id, status: 'used', used_at: new Date().toISOString().slice(0, 19).replace('T', ' ') },
  }
}
