/**
 * GET /api/open/items — 供外部系统调用的已上架商品列表 (按闲鱼账号分组)。
 * 鉴权: authorization: Bearer <apikey> (后台「API密钥」生成的 Key, 启用且未过期)。
 * 返回: { total, account_count, groups: [{ cookie_id, username, remark, item_count, items: [...] }] }
 * 每个商品带 item_id / item_title / item_price / item_description / item_detail / 更新时间。
 */
export default defineEventHandler(
  withApi(async (event) => {
    const identity = await requireApiKey(event, 'open/items')
    const db = await getDb()
    const q = getQuery(event)
    const keyword = (q.keyword || '').toString().trim()

    const params: any[] = []
    let sql = `
      SELECT
        i.cookie_id,
        i.item_id,
        i.item_title,
        i.item_description,
        i.item_category,
        i.item_price,
        i.item_detail,
        i.is_multi_spec,
        i.multi_quantity_delivery,
        i.updated_at,
        c.username,
        c.remark
      FROM item_info i
      LEFT JOIN cookies c ON c.id = i.cookie_id
      LEFT JOIN cookie_status cs ON cs.cookie_id = i.cookie_id
      WHERE COALESCE(cs.enabled, 1) = 1
    `
    if (keyword) {
      sql += ' AND (i.item_title LIKE ? OR i.item_id LIKE ?)'
      params.push(`%${keyword}%`, `%${keyword}%`)
    }
    sql += ' ORDER BY i.cookie_id ASC, i.updated_at DESC'

    const rows = await db.all<any>(sql, params)

    const groups: Record<string, any> = {}
    for (const r of rows) {
      const gid = r.cookie_id || 'unknown'
      if (!groups[gid]) {
        groups[gid] = {
          cookie_id: gid,
          username: r.username || r.remark || gid,
          remark: r.remark || '',
          item_count: 0,
          items: [],
        }
      }
      groups[gid].item_count += 1
      groups[gid].items.push({
        item_id: r.item_id,
        item_title: r.item_title || '',
        item_description: r.item_description || '',
        item_category: r.item_category || '',
        item_price: r.item_price || '',
        item_detail: r.item_detail || '',
        is_multi_spec: Number(r.is_multi_spec) === 1,
        multi_quantity_delivery: Number(r.multi_quantity_delivery) === 1,
        updated_at: r.updated_at,
      })
    }

    const list = Object.values(groups)
    return ok({
      total: rows.length,
      account_count: list.length,
      called_by: identity.name,
      groups: list,
    })
  }),
)
