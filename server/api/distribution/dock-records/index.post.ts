/**
 * POST /api/distribution/dock-records — 创建一级对接记录
 *
 * Body: { card_id, dock_name, markup_amount?, remark? }
 *  - 卡券必须 is_dockable=1 且不属于当前用户
 *  - 校验可见性: public 任意可对接; dealer_only 需当前用户与货主已建立 binding
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const cardId = Number(body.card_id)
    if (!cardId) throw new ApiError(400, '请提供 card_id')
    const dockName = (body.dock_name || '').toString().trim()
    if (!dockName) throw new ApiError(400, '对接名称不能为空')

    const card = await db.get<{
      id: number; user_id: number; is_dockable: number; enabled: number
      dock_visibility: string | null; price: string | null
    }>(
      'SELECT id, user_id, is_dockable, enabled, dock_visibility, price FROM cards WHERE id = ?',
      [cardId],
    )
    if (!card) throw new ApiError(404, '卡券不存在')
    if (card.user_id === payload.userId) throw new ApiError(400, '不能对接自己的卡券')
    if (!card.is_dockable) throw new ApiError(400, '该卡券未开放对接')
    if (!card.enabled) throw new ApiError(400, '该卡券已下架')

    // 可见性校验
    if (card.dock_visibility === 'dealer_only') {
      const binding = await db.get<{ id: number }>(
        'SELECT id FROM dock_code_bindings WHERE user_id = ? AND target_user_id = ?',
        [payload.userId, card.user_id],
      )
      if (!binding) throw new ApiError(403, '该卡券仅限指定分销商对接, 请先绑定货主对接码')
    }

    // 防重复对接
    const exists = await db.get<{ id: number }>(
      'SELECT id FROM dock_records WHERE user_id = ? AND card_id = ? AND level = 1',
      [payload.userId, cardId],
    )
    if (exists) throw new ApiError(409, '已对接过该卡券, 请勿重复对接')

    const markup = (body.markup_amount || '0.00').toString()
    const remark = (body.remark || '').toString().trim()

    const r = await db.run(
      `INSERT INTO dock_records (
        user_id, card_id, dock_name, markup_amount, remark, delivery_count,
        status, disable_reason, owner_disabled, level,
        parent_dock_id, source_user_id, allow_sub_dock,
        sub_dock_price, sub_dock_visibility,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 1, NULL, 0, 1, NULL, NULL, 0, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [payload.userId, cardId, dockName, markup, remark || null],
    )

    return ok({ id: r.lastInsertId }, '对接成功')
  }),
)
