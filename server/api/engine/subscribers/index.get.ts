/**
 * GET /api/engine/subscribers — 事件发布订阅者列表 (管理端)。
 * 返回全字段含 token (面板复制/重置用, 仅登录管理员可达)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const rows = await db.all<any>(
      `SELECT id, name, token, webhook_url, remark, enabled, total_delivered, total_failed,
              consecutive_failures, muted_until, last_delivery_at, created_at
       FROM engine_subscribers ORDER BY id ASC`,
    )
    return ok({
      subscribers: rows.map((r) => ({ ...r, enabled: !!r.enabled, muted: isSubscriberMuted(r) })),
    })
  }),
)

function isSubscriberMuted(row: any): boolean {
  if (!row.muted_until) return false
  const t = Date.parse(String(row.muted_until).includes('T') || String(row.muted_until).includes('Z') ? row.muted_until : row.muted_until.replace(' ', 'T') + 'Z')
  return Number.isFinite(t) && t > Date.now()
}
