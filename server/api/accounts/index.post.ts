/** POST /api/accounts — create a new cookie (and seed cookie_status enabled=1). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event)
    const id = (body?.id || '').trim() || (crypto.randomUUID?.() || randomId())
    const value = (body?.value || '').toString().trim()
    const remark = (body?.remark || '').toString().trim()
    const pause_duration = Number(body?.pause_duration ?? 10)
    const auto_confirm = body?.auto_confirm === false || body?.auto_confirm === 0 ? 0 : 1

    if (!value) throw new ApiError(400, 'Cookie 内容不能为空')

    const existing = await db.get('SELECT id FROM cookies WHERE id = ?', [id])
    if (existing) throw new ApiError(409, '账号 ID 已存在')

    await db.run(
      `INSERT INTO cookies (id, value, user_id, auto_confirm, remark, pause_duration, username, password, show_browser)
       VALUES (?, ?, ?, ?, ?, ?, '', '', 0)`,
      [id, value, 1, auto_confirm, remark, pause_duration],
    )
    await db.run(
      `INSERT INTO cookie_status (cookie_id, enabled, updated_at) VALUES (?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(cookie_id) DO UPDATE SET enabled = 1, updated_at = CURRENT_TIMESTAMP`,
      [id],
    )

    await auditLog(event, { action: 'create', module: 'accounts', targetType: 'cookie', targetId: id, desc: `新增账号 ${body.remark || id}` })
    return ok({ id }, '账号已添加')
  }),
)

function randomId(): string {
  return 'acc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
