/** PUT /api/item-replies/:cookieId/:itemId — upsert item reply. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    const itemId = getRouterParam(event, 'itemId') || ''
    const db = await getDb()
    const body = await readBody(event) || {}

    const reply_content = (body.reply_content || '').toString().trim()
    if (!reply_content) throw new ApiError(400, '回复内容不能为空')

    const existing = await db.get(
      'SELECT id FROM item_replay WHERE cookie_id = ? AND item_id = ?',
      [cookieId, itemId],
    )

    if (existing) {
      await db.run(
        `UPDATE item_replay SET reply_content = ?, updated_at = CURRENT_TIMESTAMP
         WHERE cookie_id = ? AND item_id = ?`,
        [reply_content, cookieId, itemId],
      )
      return ok({ id: existing.id, cookieId, itemId }, '回复已更新')
    }

    const r = await db.run(
      `INSERT INTO item_replay (item_id, cookie_id, reply_content)
       VALUES (?, ?, ?)`,
      [itemId, cookieId, reply_content],
    )
    return ok({ id: r.lastInsertId, cookieId, itemId }, '回复已添加')
  }),
)
