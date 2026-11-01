/**
 * POST /api/orders/batch — batch operations on orders.
 * Body: { ids: string[], action: 'ship' | 'delete' | 'export' }
 *   - ship: set order_status='shipped' for all ids
 *   - delete: delete all ids
 *   - export: return the selected orders as JSON
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const body = await readBody(event)
    const { ids, action } = body || {}
    if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(400, '请选择至少一条订单')
    if (!['ship', 'delete', 'export'].includes(action)) throw new ApiError(400, '不支持的操作')

    const db = await getDb()
    const placeholders = ids.map(() => '?').join(',')
    if (action === 'export') {
      const rows = await db.all(
        `SELECT * FROM orders WHERE order_id IN (${placeholders})`,
        ids,
      )
      return ok({ count: rows.length, orders: rows }, `已导出 ${rows.length} 条订单`)
    }

    if (action === 'ship') {
      let affected = 0
      await db.transaction(async () => {
        for (const id of ids) {
          const r = await db.run(
            "UPDATE orders SET order_status='shipped', updated_at=CURRENT_TIMESTAMP WHERE order_id=?",
            [id],
          )
          affected += r.changes
        }
      })
      return ok({ affected }, `已批量发货 ${affected} 条订单`)
    }

    if (action === 'delete') {
      let affected = 0
      await db.transaction(async () => {
        for (const id of ids) {
          const row = await db.get<{ cookie_id: string }>('SELECT cookie_id FROM orders WHERE order_id=?', [id]).catch(() => null)
          const r = await db.run('DELETE FROM orders WHERE order_id=?', [id])
          affected += r.changes
          // 登记删除屏蔽: 否则下一轮订单同步会原样拉回, 表现为「删不掉」
          if (r.changes > 0) await rememberDeletedOrder(db, String(id), String(row?.cookie_id || ''))
        }
      })
      return ok({ affected }, `已批量删除 ${affected} 条订单 (同步不再拉回)`)
    }
  }),
)
