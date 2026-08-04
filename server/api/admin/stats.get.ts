/** GET /api/admin/stats — admin dashboard metrics. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()

    const [users, logs, riskLogs, cards, channels, accounts, orders, items, keywords] = await Promise.all([
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM users'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM system_logs'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM risk_control_logs'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM cards'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM notification_channels'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM cookies'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM orders'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM item_info'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM keywords'),
    ])

    // Total rows across whitelisted tables
    let totalRows = 0
    for (const t of DATA_TABLE_WHITELIST) {
      try {
        const r = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${t}`)
        totalRows += r?.c ?? 0
      } catch { /* ignore */ }
    }

    return ok({
      userCount: users?.c ?? 0,
      logCount: logs?.c ?? 0,
      riskLogCount: riskLogs?.c ?? 0,
      cardCount: cards?.c ?? 0,
      channelCount: channels?.c ?? 0,
      accountCount: accounts?.c ?? 0,
      orderCount: orders?.c ?? 0,
      itemCount: items?.c ?? 0,
      keywordCount: keywords?.c ?? 0,
      totalRows,
    })
  }),
)
