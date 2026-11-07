/** POST /api/admin/logs/clear — clear all logs (optionally by level). */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({})) || {}
    const level = (body.level || '').toString().trim().toUpperCase()

    let r
    if (level && level !== 'ALL') {
      r = await db.run('DELETE FROM system_logs WHERE level = ?', [level])
    } else {
      r = await db.run('DELETE FROM system_logs', [])
    }
    return ok({ deleted: r.changes }, level ? `已清空 ${level} 级日志` : '已清空全部日志')
  }),
)
