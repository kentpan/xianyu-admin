/**
 * GET /api/distribution/pickup — 提货接口 (免认证, 秘钥授权, 纯文本返回)
 *
 * Query: ?key=<secret_key>&dock_id=<id>
 *
 * 流程:
 *   1. 内存级频率限制 (每个 dock_id 5 秒内只允许 1 次)
 *   2. 调用 doPickup 执行: 校验秘钥 → 取卡券内容 → 创建代理订单 → 结算
 *   3. 成功: 返回纯文本卡券内容 (Content-Type: text/plain)
 *   4. 失败: 返回错误描述文本 (HTTP 200, 与 Python 实现保持一致)
 */

// 内存级频率限制: Map<dock_id, last_ts>
const PICKUP_RATE_MAP = new Map<number, number>()
const PICKUP_RATE_INTERVAL_MS = 5000

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const key = (q.key || '').toString().trim()
  const dockId = Number(q.dock_id || 0)

  if (!key || !dockId) {
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    setResponseStatus(event, 200)
    return '参数错误: 缺少 key 或 dock_id'
  }

  // 频率限制
  const now = Date.now()
  const lastTs = PICKUP_RATE_MAP.get(dockId) || 0
  if (now - lastTs < PICKUP_RATE_INTERVAL_MS) {
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    setResponseStatus(event, 200)
    return '操作过于频繁, 请 5 秒后重试'
  }
  PICKUP_RATE_MAP.set(dockId, now)

  // 定期清理过期项 (避免内存泄漏)
  if (PICKUP_RATE_MAP.size > 1000) {
    for (const [k, v] of PICKUP_RATE_MAP) {
      if (now - v > 60000) PICKUP_RATE_MAP.delete(k)
    }
  }

  let content: string
  try {
    const db = await getDb()
    const result = await doPickup(db, key, dockId)
    content = result.content
    if (!content) content = result.settleOk ? '卡券内容为空' : '提货成功但卡券内容为空'
  } catch (e: any) {
    content = e?.message || '提货失败'
  }

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setResponseStatus(event, 200)
  return content
})
