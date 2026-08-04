/**
 * GET /api/dashboard/report — generates a printable HTML report (opens in new tab, user prints to PDF).
 * Returns an HTML page with dashboard summary stats, suitable for browser "Save as PDF".
 */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const db = await getDb()

  // Gather all dashboard data
  const [accountsRow, ordersRow, keywordsRow, itemsRow, cardsRow] = await Promise.all([
    db.get<{ c: number }>('SELECT COUNT(*) as c FROM cookies'),
    db.get<{ c: number; rev: number }>('SELECT COUNT(*) as c, COALESCE(SUM(CAST(amount AS REAL)), 0) as rev FROM orders'),
    db.get<{ c: number }>('SELECT COUNT(*) as c FROM keywords'),
    db.get<{ c: number }>('SELECT COUNT(*) as c FROM item_info'),
    db.get<{ c: number }>('SELECT COUNT(*) as c FROM cards'),
  ])

  const statusRows = await db.all<{ order_status: string; c: number }>(
    'SELECT order_status, COUNT(*) as c FROM orders GROUP BY order_status',
  )

  const recentOrders = await db.all(
    'SELECT order_id, item_id, buyer_id, amount, order_status, created_at FROM orders ORDER BY created_at DESC LIMIT 10',
  )

  const now = new Date()
  const dateStr = now.toLocaleString('zh-CN')

  const statusLabels: Record<string, string> = {
    pending_ship: '待发货', shipped: '已发货', completed: '已完成',
    cancelled: '已取消', refunding: '退款中', processing: '处理中', unknown: '未知',
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>闲鱼超级管家 - 运营报告 ${now.toISOString().slice(0, 10)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #1e293b; padding: 40px; background: white; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #f59e0b; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 24px; color: #0f172a; }
  .header .meta { text-align: right; color: #64748b; font-size: 13px; }
  .section { margin-bottom: 28px; }
  .section h2 { font-size: 16px; color: #f59e0b; margin-bottom: 12px; border-left: 4px solid #f59e0b; padding-left: 8px; }
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
  .stat { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
  .stat .label { font-size: 12px; color: #64748b; margin-bottom: 4px; }
  .stat .value { font-size: 24px; font-weight: 700; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f8fafc; padding: 8px 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; }
  td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; }
  .badge.pending_ship { background: #fef3c7; color: #92400e; }
  .badge.shipped { background: #e0f2fe; color: #075985; }
  .badge.completed { background: #d1fae5; color: #065f46; }
  .badge.cancelled { background: #f1f5f9; color: #475569; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px; }
  @media print { body { padding: 20px; } .header { page-break-after: avoid; } }
</style>
</head>
<body>
  <div class="header">
    <h1>🐟 闲鱼超级管家 · 运营报告</h1>
    <div class="meta">
      <p>生成时间: ${dateStr}</p>
      <p>报告日期: ${now.toISOString().slice(0, 10)}</p>
    </div>
  </div>

  <div class="section">
    <h2>核心指标</h2>
    <div class="stats">
      <div class="stat"><div class="label">闲鱼账号</div><div class="value">${accountsRow?.c || 0}</div></div>
      <div class="stat"><div class="label">订单总数</div><div class="value">${ordersRow?.c || 0}</div></div>
      <div class="stat"><div class="label">总收入(¥)</div><div class="value">${(ordersRow?.rev || 0).toFixed(2)}</div></div>
      <div class="stat"><div class="label">关键词</div><div class="value">${keywordsRow?.c || 0}</div></div>
      <div class="stat"><div class="label">商品/卡券</div><div class="value">${(itemsRow?.c || 0) + (cardsRow?.c || 0)}</div></div>
    </div>
  </div>

  <div class="section">
    <h2>订单状态分布</h2>
    <table>
      <thead><tr><th>状态</th><th>数量</th><th>占比</th></tr></thead>
      <tbody>
        ${statusRows.map((s) => {
          const total = statusRows.reduce((a, b) => a + b.c, 0) || 1
          const pct = Math.round((s.c / total) * 100)
          const label = statusLabels[s.order_status] || s.order_status
          return `<tr><td><span class="badge ${s.order_status}">${label}</span></td><td>${s.c}</td><td>${pct}%</td></tr>`
        }).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>最近 10 条订单</h2>
    <table>
      <thead><tr><th>订单号</th><th>商品</th><th>买家</th><th>金额</th><th>状态</th><th>时间</th></tr></thead>
      <tbody>
        ${recentOrders.map((o) => {
          const label = statusLabels[o.order_status] || o.order_status
          return `<tr><td>${o.order_id}</td><td>${o.item_id || '—'}</td><td>${o.buyer_id || '—'}</td><td>¥${o.amount || '0'}</td><td><span class="badge ${o.order_status}">${label}</span></td><td>${o.created_at}</td></tr>`
        }).join('')}
        ${recentOrders.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">暂无订单</td></tr>' : ''}
      </tbody>
    </table>
  </div>

  <div class="footer">
    <p>闲鱼超级管家 · 自动生成报告 · 仅供学习研究使用</p>
  </div>
</body>
</html>`

  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'content-disposition', `inline; filename="report_${now.toISOString().slice(0, 10)}.html"`)
  return html
})
