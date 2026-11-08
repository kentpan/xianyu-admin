/** GET /api/dashboard/stats — aggregated metrics for the dashboard.
 *
 * (v2.3.5 hotfix) TTL 缓存 60s: 多标签页轮询折叠为每 isolate 每分钟 1 次真实查询,
 * 叠加索引迁移把日读行数压回 D1 免费额度内。 */
import { cachedQuery } from '../../utils/db-cache'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)

    return ok(await cachedQuery('dash:stats', 60_000, async () => {
    const db = await getDb()

    // (v2.3.5) 订单总数从状态分布一次 GROUP BY 推导, 不再单独 COUNT(*) —
    // 原实现对 orders 做了 2 次全量扫描 (COUNT + GROUP BY), D1 下读配额×2
    const [accountsRow, activeRow, keywordsRow, itemsRow, cardsRow, channelsRow] = await Promise.all([
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM cookies'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM cookie_status WHERE enabled = 1'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM keywords'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM item_info'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM cards'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM notification_channels'),
    ])

    const statusRows = await db.all<{ order_status: string; c: number }>(
      'SELECT order_status, COUNT(*) as c FROM orders GROUP BY order_status',
    )
    const orderStatusDist: Record<string, number> = {}
    for (const r of statusRows) orderStatusDist[r.order_status || 'unknown'] = r.c
    const totalOrders = Object.values(orderStatusDist).reduce((a, b) => a + b, 0)

    const recentOrders = await db.all(
      'SELECT order_id, item_id, buyer_id, amount, order_status, created_at FROM orders ORDER BY created_at DESC LIMIT 8',
    )

    const recentLogs = await db.all(
      'SELECT id, level, module, message, created_at FROM system_logs ORDER BY created_at DESC LIMIT 10',
    ).catch(() => [])

    return {
      totalAccounts: accountsRow?.c || 0,
      activeAccounts: activeRow?.c || 0,
      totalKeywords: keywordsRow?.c || 0,
      totalOrders,
      totalItems: itemsRow?.c || 0,
      totalCards: cardsRow?.c || 0,
      totalChannels: channelsRow?.c || 0,
      orderStatusDist,
      recentOrders,
      recentLogs,
    }
    }))
  }),
)
