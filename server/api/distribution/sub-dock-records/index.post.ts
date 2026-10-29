/**
 * POST /api/distribution/sub-dock-records — 创建二级对接记录
 *
 * Body: { parent_dock_id, dock_name, markup_amount?, remark? }
 *  - 一级对接记录必须 allow_sub_dock=1 AND status=1
 *  - 不能对接自己的一级记录
 *  - 防止重复对接
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const parentDockId = Number(body.parent_dock_id)
    if (!parentDockId) throw new ApiError(400, '请提供 parent_dock_id')
    const dockName = (body.dock_name || '').toString().trim()
    if (!dockName) throw new ApiError(400, '对接名称不能为空')

    const parent = await db.get<{
      id: number; user_id: number; card_id: number
      allow_sub_dock: number; status: number; level: number
      sub_dock_price: string | null; sub_dock_visibility: string | null
    }>(
      `SELECT id, user_id, card_id, allow_sub_dock, status, level, sub_dock_price, sub_dock_visibility
       FROM dock_records WHERE id = ?`,
      [parentDockId],
    )
    if (!parent) throw new ApiError(404, '一级对接记录不存在')
    if (parent.level !== 1) throw new ApiError(400, '只能基于一级对接记录创建二级对接')
    if (parent.user_id === payload.userId) throw new ApiError(400, '不能对接自己的一级记录')
    if (!parent.allow_sub_dock) throw new ApiError(403, '对方未开启二级分销')
    if (!parent.status) throw new ApiError(403, '一级对接记录已被禁用')

    // 可见性校验
    if (parent.sub_dock_visibility === 'dealer_only') {
      const binding = await db.get<{ id: number }>(
        'SELECT id FROM dock_code_bindings WHERE user_id = ? AND target_user_id = ?',
        [payload.userId, parent.user_id],
      )
      if (!binding) throw new ApiError(403, '该一级货源仅限指定分销商对接')
    }

    // 防重复
    const exists = await db.get<{ id: number }>(
      'SELECT id FROM dock_records WHERE user_id = ? AND parent_dock_id = ? AND level = 2',
      [payload.userId, parentDockId],
    )
    if (exists) throw new ApiError(409, '已对接过该一级货源')

    const markup = (body.markup_amount || '0.00').toString()
    const remark = (body.remark || '').toString().trim()

    const r = await db.run(
      `INSERT INTO dock_records (
        user_id, card_id, dock_name, markup_amount, remark, delivery_count,
        status, disable_reason, owner_disabled, level,
        parent_dock_id, source_user_id, allow_sub_dock,
        sub_dock_price, sub_dock_visibility,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 1, NULL, 0, 2, ?, ?, 0, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [payload.userId, parent.card_id, dockName, markup, remark || null, parentDockId, parent.user_id],
    )

    return ok({ id: r.lastInsertId }, '二级对接成功')
  }),
)
