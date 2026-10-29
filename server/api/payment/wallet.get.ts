/**
 * GET /api/payment/wallet — 我的钱包概览
 *
 * 返回: { balance, fund_flow_count, pending_withdraw_count }
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    const balance = await getBalance(db, payload.userId)

    const flowRow = await db.get<{ c: number }>(
      'SELECT COUNT(*) as c FROM fund_flows WHERE user_id = ?',
      [payload.userId],
    )

    const pendingRow = await db.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM settlement_records WHERE user_id = ? AND status IN ('pending_review','approved')",
      [payload.userId],
    )

    return ok({
      balance,
      fund_flow_count: flowRow?.c || 0,
      pending_withdraw_count: pendingRow?.c || 0,
    })
  }),
)
