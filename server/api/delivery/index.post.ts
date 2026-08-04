/** POST /api/delivery — create a delivery rule. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const keyword = (body.keyword || '').toString().trim()
    const card_id = Number(body.card_id)
    if (!keyword) throw new ApiError(400, '关键词不能为空')
    if (!card_id) throw new ApiError(400, '请选择关联卡券')

    const card = await db.get('SELECT id FROM cards WHERE id = ?', [card_id])
    if (!card) throw new ApiError(404, '关联卡券不存在')

    const r = await db.run(
      `INSERT INTO delivery_rules (keyword, card_id, delivery_count, enabled, description)
       VALUES (?, ?, ?, ?, ?)`,
      [
        keyword,
        card_id,
        Math.max(1, Number(body.delivery_count ?? 1) || 1),
        body.enabled === false || body.enabled === 0 ? 0 : 1,
        (body.description || '').toString().trim() || null,
      ],
    )

    return ok({ id: r.lastInsertId }, '发货规则已创建')
  }),
)
