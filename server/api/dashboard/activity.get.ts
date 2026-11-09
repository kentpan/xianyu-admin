/** GET /api/dashboard/activity — recent activity feed (orders + logs + risk events + account changes, merged & time-sorted). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const { limit = 15 } = getQuery(event) as any
    const n = Math.min(Number(limit) || 15, 50)

    // Gather events from multiple sources in parallel
    const [orders, logs, riskLogs, accounts] = await Promise.all([
      db.all<{ order_id: string; item_id: string; buyer_id: string; amount: string; order_status: string; created_at: string }>(
        `SELECT order_id, item_id, buyer_id, amount, order_status, created_at FROM orders ORDER BY created_at DESC LIMIT ?`,
        [n],
      ).catch(() => []),
      db.all<{ id: number; level: string; module: string; message: string; created_at: string }>(
        `SELECT id, level, module, message, created_at FROM system_logs ORDER BY created_at DESC LIMIT ?`,
        [n],
      ).catch(() => []),
      db.all<{ id: number; cookie_id: string; event_type: string; event_description: string; processing_status: string; created_at: string }>(
        `SELECT id, cookie_id, event_type, event_description, processing_status, created_at FROM risk_control_logs ORDER BY created_at DESC LIMIT ?`,
        [n],
      ).catch(() => []),
      db.all<{ id: string; remark: string; created_at: string }>(
        `SELECT id, remark, created_at FROM cookies ORDER BY created_at DESC LIMIT ?`,
        [n],
      ).catch(() => []),
    ])

    type Activity = {
      id: string
      type: 'order' | 'log' | 'risk' | 'account'
      icon: string
      color: string
      title: string
      desc: string
      time: string
      ts: number
    }

    const activities: Activity[] = []

    for (const o of orders) {
      activities.push({
        id: 'ord-' + o.order_id,
        type: 'order',
        icon: 'orders',
        color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
        title: `新订单 ${o.order_id}`,
        desc: `买家 ${o.buyer_id || '—'} · ¥${o.amount || '0'} · ${o.order_status}`,
        time: o.created_at,
        ts: new Date(String(o.created_at).replace(' ', 'T')).getTime() || 0,
      })
    }
    for (const l of logs) {
      activities.push({
        id: 'log-' + l.id,
        type: 'log',
        icon: 'logs',
        color: l.level === 'ERROR' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
          : l.level === 'WARN' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
          : 'bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
        title: l.message?.slice(0, 60) || '系统日志',
        desc: `${l.module || 'system'} · ${l.level}`,
        time: l.created_at,
        ts: new Date(String(l.created_at).replace(' ', 'T')).getTime() || 0,
      })
    }
    for (const r of riskLogs) {
      activities.push({
        id: 'risk-' + r.id,
        type: 'risk',
        icon: 'riskLogs',
        color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
        title: `风控事件: ${r.event_type}`,
        desc: r.event_description || r.processing_status || '',
        time: r.created_at,
        ts: new Date(String(r.created_at).replace(' ', 'T')).getTime() || 0,
      })
    }
    for (const a of accounts) {
      activities.push({
        id: 'acc-' + a.id,
        type: 'account',
        icon: 'accounts',
        color: 'bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400',
        title: `账号 ${a.remark || a.id} 已添加`,
        desc: `ID: ${a.id}`,
        time: a.created_at,
        ts: new Date(String(a.created_at).replace(' ', 'T')).getTime() || 0,
      })
    }

    // Sort by time desc, take top N
    activities.sort((a, b) => b.ts - a.ts)
    return ok({ activities: activities.slice(0, n), total: activities.length })
  }),
)
