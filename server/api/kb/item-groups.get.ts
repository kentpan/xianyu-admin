/**
 * GET /api/kb/item-groups?cookie_id=&item_id= — 单个商品所属分组列表 (v2.4.0)。
 * 商品级 AI 配置弹窗用: 展示/勾选该商品归属的分组 (同一商品允许加入多个分组)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const q = getQuery(event)
    const cookieId = (q.cookie_id || '').toString().trim()
    const itemId = (q.item_id || '').toString().trim()
    if (!cookieId || !itemId) throw new ApiError(400, '缺少 cookie_id 或 item_id')
    const db = await getDb()
    const rows = await db
      .all<{ id: number; name: string }>(
        `SELECT g.id, g.name FROM kb_group_items gi
         JOIN kb_groups g ON g.id = gi.group_id
         WHERE gi.cookie_id = ? AND gi.item_id = ?
         ORDER BY g.sort ASC, g.id ASC`,
        [cookieId, itemId],
      )
      .catch(() => [])
    return ok({ groups: rows })
  }),
)
