/**
 * GET /api/open/items — 供外部系统调用的已上架商品列表 (按闲鱼账号分组)。
 *
 * 鉴权: Authorization: Bearer <apikey> (后台「API Key管理」生成的业务方 Key, 启用且未过期, 受独立限速)。
 *
 * 参数 (Query):
 *   - limit   每个闲鱼账号返回的商品条数, 默认 10, 可传 N (1-200), 按更新时间取最新 N 条
 *   - keyword 商品标题/商品ID 模糊过滤 (可选)
 *
 * 返回: { total, returned, account_count, limit, called_by, groups: [...] }
 *   - total        全部在售商品总数 (不过滤 limit)
 *   - returned     本次实际返回的商品条数
 *   - groups[]     按账号分组: { cookie_id, username, remark, item_count, returned_count, items: [...] }
 *   - 每个商品: item_id / item_title / item_description / item_category / item_price /
 *     item_detail / is_multi_spec / multi_quantity_delivery / updated_at
 *
 * 调用留痕: 每次请求写 api_key_logs (成功/失败), 在「API Key管理」可查调用日志。
 */
export default defineEventHandler(
  withApi(async (event) => {
    const identity = await requireApiKey(event, 'open/items')

    try {
      const db = await getDb()
      const q = getQuery(event)
      const keyword = (q.keyword || '').toString().trim()
      const limit = Math.min(200, Math.max(1, parseInt(String(q.limit ?? q.count ?? q.pageSize ?? ''), 10) || 10))

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

      // 按账号分组; limit 控制每个账号返回的最新条数 (item_count 仍统计该账号全部商品数)
      const groups: Record<string, any> = {}
      let returned = 0
      for (const r of rows) {
        const gid = r.cookie_id || 'unknown'
        if (!groups[gid]) {
          groups[gid] = {
            cookie_id: gid,
            username: r.username || r.remark || gid,
            remark: r.remark || '',
            item_count: 0,
            returned_count: 0,
            items: [],
          }
        }
        groups[gid].item_count += 1
        if (groups[gid].items.length >= limit) continue
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
        groups[gid].returned_count += 1
        returned += 1
      }

      const list = Object.values(groups)
      await logApiKeyCall(identity.id, 'open/items', true, 200, `商品列表查询 (返回 ${returned}/${rows.length} 条, limit=${limit})`, event)

      return ok({
        total: rows.length,
        returned,
        account_count: list.length,
        limit,
        keyword,
        called_by: identity.name,
        groups: list,
      })
    } catch (e: any) {
      await logApiKeyCall(identity.id, 'open/items', false, 500, String(e?.message || '查询失败').slice(0, 200), event)
      throw e
    }
  }),
)
