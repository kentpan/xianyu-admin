/**
 * GET /api/user/balance — 我的余额 + 最近 5 条流水
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    const balance = await getBalance(db, payload.userId)

    const recentFlows = await db.all(
      `SELECT id, type, amount, balance_before, balance_after, description, created_at
       FROM fund_flows
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 5`,
      [payload.userId],
    )

    return ok({ balance, recent_flows: recentFlows })
  }),
)
