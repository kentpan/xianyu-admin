/**
 * GET /api/distribution/source-bindings — 我绑定的上货主 (对接码绑定列表)
 *
 * 列出当前用户通过对接码绑定的上货主 (user_id = current, target_user_id = supplier)
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    const items = await db.all(
      `SELECT b.id, b.user_id, b.dock_code, b.target_user_id, b.created_at,
              u.username AS target_username, u.email AS target_email
       FROM dock_code_bindings b
       LEFT JOIN users u ON u.id = b.target_user_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
      [payload.userId],
    )

    return ok({ items })
  }),
)
