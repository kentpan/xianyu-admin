/**
 * 提现审核 HMAC Token 生成与校验
 *
 * Token = HMAC-SHA256(jwtSecret, `${recordId}:${action}`).slice(0,32)
 * 用于邮件中的审核链接, 实现无需登录即可访问的审核入口
 */
import crypto from 'node:crypto'

function getSecret(): string {
  const s = getRuntimeState().jwtSecret
  if (!s) throw new Error('JWT_SECRET 未配置, 无法生成审核 token')
  return s
}

/** 生成审核 token (recordId + action → HMAC-SHA256 前 32 字符) */
export function genReviewToken(recordId: number, action: string): string {
  return crypto
    .createHmac('sha256', getSecret())
    .update(`${recordId}:${action}`)
    .digest('hex')
    .slice(0, 32)
}

/** 常量时间比较, 防止时序攻击 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

/** 校验审核 token */
export function verifyReviewToken(
  recordId: number,
  action: string,
  token: string,
): boolean {
  if (!token || typeof token !== 'string') return false
  // action 仅允许 approve / reject
  if (action !== 'approve' && action !== 'reject') return false
  const expected = genReviewToken(recordId, action)
  return safeEqual(expected, token)
}
