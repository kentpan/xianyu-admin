/**
 * GET /api/orders/hot-trends — 全平台热门商品趋势榜单 (v2.3.0)。
 * Query: { keyword?: string, item_type?: 'virtual'|'physical'|'', limit?: number, sort?: 'want'|'seen'|'recent' }
 *
 * 数据源: trend_hot_items 表 (闲鱼站内搜索快照聚合, 由 POST /api/orders/hot-trends/sync 写入)。
 * 聚合统计: 在售商品总数 / 不同卖家数 (同款竞争度) / 价格带 min-max / 关键词分布。
 * 排序: want=想要人数降序 (默认, 热度) / seen=搜索命中次数 (在售稳定度) / recent=最近发现。
 * 商品类型: virtual=虚拟商品 / physical=实体商品 / 空=全部 (按标题特征词分类, 同步入库时落列);
 *   未分类旧数据 (item_type='') 在读取前自愈回填, 趋势页默认只看虚拟商品。
 */
import { classifyItemType } from '../../../utils/xianyu/item-classify'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const q = getQuery(event)
    const keyword = String(q.keyword || '').trim()
    const itemType = String(q.item_type || '') === 'virtual' || String(q.item_type || '') === 'physical' ? String(q.item_type) : ''
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 300)
    const sort = String(q.sort || 'want')

    // 未分类旧数据自愈回填: 按标题特征词补齐 item_type (幂等, 只碰空值行)
    const unclassified = await db
      .all<{ item_id: string; title: string }>(
        `SELECT item_id, title FROM trend_hot_items WHERE (item_type = '' OR item_type IS NULL) AND title != '' LIMIT 500`,
      )
      .catch(() => [])
    for (const row of unclassified) {
      await db
        .run('UPDATE trend_hot_items SET item_type = ? WHERE item_id = ?', [classifyItemType(row.title), row.item_id])
        .catch(() => {})
    }

    const orderSql =
      sort === 'seen'
        ? 'seen_count DESC, want_count DESC'
        : sort === 'recent'
          ? 'last_seen_at DESC, want_count DESC'
          : 'want_count DESC, seen_count DESC'
    const whereParts: string[] = []
    const whereParams: unknown[] = []
    if (keyword) {
      whereParts.push('keyword LIKE ?')
      whereParams.push(`%${keyword}%`)
    }
    if (itemType) {
      whereParts.push('item_type = ?')
      whereParams.push(itemType)
    }
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''
    const params: unknown[] = [...whereParams]
    params.push(limit)

    const items = await db
      .all(
        `SELECT item_id, title, price, seller_id, seller_nick, area, pic_url, want_count, keyword, item_type,
                seen_count, first_seen_at, last_seen_at
         FROM trend_hot_items ${whereSql}
         ORDER BY ${orderSql}
         LIMIT ?`,
        params,
      )
      .catch(() => [])

    const stats = await db
      .get<{ total: number; sellers: number; min_price: string; max_price: string }>(
        `SELECT COUNT(*) total,
                COUNT(DISTINCT CASE WHEN seller_id != '' THEN seller_id END) sellers,
                MIN(CASE WHEN price != '' THEN CAST(price AS REAL) END) min_price,
                MAX(CASE WHEN price != '' THEN CAST(price AS REAL) END) max_price
         FROM trend_hot_items ${whereSql}`,
        whereParams,
      )
      .catch(() => ({ total: 0, sellers: 0, min_price: null, max_price: null }))

    // 关键词分布跟随当前类型口径 (与榜单一致, 而非全表)
    const keywords = await db
      .all<{ keyword: string; c: number }>(
        `SELECT keyword, COUNT(*) c FROM trend_hot_items ${whereSql} GROUP BY keyword ORDER BY c DESC LIMIT 10`,
        whereParams,
      )
      .catch(() => [])

    return ok({
      items,
      stats: {
        total: Number(stats?.total || 0),
        sellers: Number(stats?.sellers || 0),
        min_price: stats?.min_price != null ? Number(stats.min_price) : null,
        max_price: stats?.max_price != null ? Number(stats.max_price) : null,
      },
      keywords,
    })
  }),
)
