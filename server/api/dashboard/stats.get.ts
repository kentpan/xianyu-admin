/** GET /api/dashboard/stats — aggregated metrics for the dashboard. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const [accountsRow, activeRow, keywordsRow, ordersRow, itemsRow, cardsRow, channelsRow] = await Promise.all([
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM cookies'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM cookie_status WHERE enabled = 1'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM keywords'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM orders'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM item_info'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM cards'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM notification_channels'),
    ])

    const statusRows = await db.all<{ order_status: string; c: number }>(
      'SELECT order_status, COUNT(*) as c FROM orders GROUP BY order_status',
    )
    const orderStatusDist: Record<string, number> = {}
    for (const r of statusRows) orderStatusDist[r.order_status || 'unknown'] = r.c

    const recentOrders = await db.all(
      'SELECT order_id, item_id, buyer_id, amount, order_status, created_at FROM orders ORDER BY created_at DESC LIMIT 8',
    )

    const recentLogs = await db.all(
      'SELECT id, level, module, message, created_at FROM system_logs ORDER BY created_at DESC LIMIT 10',
    ).catch(() => [])

    return ok({
      totalAccounts: accountsRow?.c || 0,
      activeAccounts: activeRow?.c || 0,
      totalKeywords: keywordsRow?.c || 0,
      totalOrders: ordersRow?.c || 0,
      totalItems: itemsRow?.c || 0,
      totalCards: cardsRow?.c || 0,
      totalChannels: channelsRow?.c || 0,
      orderStatusDist,
      recentOrders,
      recentLogs,
    })
  }),
)
