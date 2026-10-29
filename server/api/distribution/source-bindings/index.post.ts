/**
 * POST /api/distribution/source-bindings — 通过对接码绑定上货主
 *
 * Body: { dock_code }
 *  - 查找 dock_code 对应的用户 (上货主)
 *  - 不能绑定自己
 *  - 已存在绑定则跳过 (UNIQUE 约束)
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const dockCode = (body.dock_code || '').toString().trim().toUpperCase()
    if (!dockCode) throw new ApiError(400, '请提供对接码')

    const target = await db.get<{ id: number; username: string }>(
      'SELECT id, username FROM users WHERE dock_code = ?',
      [dockCode],
    )
    if (!target) throw new ApiError(404, '对接码无效, 未找到对应用户')
    if (target.id === payload.userId) throw new ApiError(400, '不能绑定自己')

    // 已存在则返回成功 (幂等)
    const existing = await db.get<{ id: number }>(
      'SELECT id FROM dock_code_bindings WHERE user_id = ? AND target_user_id = ?',
      [payload.userId, target.id],
    )
    if (existing) {
      return ok({ id: existing.id, target_user_id: target.id, target_username: target.username }, '已绑定')
    }

    const r = await db.run(
      `INSERT INTO dock_code_bindings (user_id, dock_code, target_user_id, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [payload.userId, dockCode, target.id],
    )

    return ok({ id: r.lastInsertId, target_user_id: target.id, target_username: target.username }, '绑定成功')
  }),
)
