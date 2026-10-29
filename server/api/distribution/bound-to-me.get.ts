/**
 * GET /api/distribution/bound-to-me — 对接我的分销商
 *
 * 列出绑定我对接码的分销商 (target_user_id = current)
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    const items = await db.all(
      `SELECT b.id, b.user_id, b.dock_code, b.target_user_id, b.created_at,
              u.username, u.email
       FROM dock_code_bindings b
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.target_user_id = ?
       ORDER BY b.created_at DESC`,
      [payload.userId],
    )

    return ok({ items })
  }),
)
