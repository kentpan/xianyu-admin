/**
 * POST /api/kb/group-items — 商品加入/移出分组 (v2.4.0)。
 * Body: { group_id, cookie_id, item_id, action: 'add' | 'remove' }
 *
 * 分组 = 商品组: 成员是商品 (cookie_id + item_id), 多账号商品可同组, 同一商品可进多个分组。
 * 商品必须真实存在 (item_info 为准), 防止错选商品 ID 落脏成员行。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const groupId = Number(body?.group_id)
    const cookieId = String(body?.cookie_id || '').trim()
    const itemId = String(body?.item_id || '').trim()
    const action = String(body?.action) === 'remove' ? 'remove' : 'add'
    if (!groupId) throw new ApiError(400, '缺少分组 ID')
    if (!cookieId || !itemId) throw new ApiError(400, '缺少商品 (账号 + 商品 ID)')

    const group = await db.get<{ id: number }>('SELECT id FROM kb_groups WHERE id = ?', [groupId])
    if (!group) throw new ApiError(404, '分组不存在')

    if (action === 'add') {
      const item = await db
        .get<{ item_id: string }>('SELECT item_id FROM item_info WHERE cookie_id = ? AND item_id = ?', [cookieId, itemId])
        .catch(() => null)
      if (!item) throw new ApiError(404, '商品不存在 (请先在商品管理页同步该账号的商品)')
      await db.run(
        'INSERT INTO kb_group_items (group_id, cookie_id, item_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        [groupId, cookieId, itemId],
      )
      return ok({ groupId, cookieId, itemId }, '商品已加入分组')
    }
    await db.run('DELETE FROM kb_group_items WHERE group_id = ? AND cookie_id = ? AND item_id = ?', [groupId, cookieId, itemId])
    return ok({ groupId, cookieId, itemId }, '商品已移出分组')
  }),
)
