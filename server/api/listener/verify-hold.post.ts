/**
 * POST /api/listener/verify-hold — 人工验证持有期开关。
 *
 * 弹窗打开 → on: 引擎对该账号完全静默 (不重试 token / 不自动派滑块求解器),
 * 避免引擎与人工验证抢同一个风控挑战 (挑战一次性, 被引擎消费则用户拖了也白拖)。
 * 弹窗关闭/验证成功 → off: 引擎恢复自身冷却阶梯内的正常节奏。
 * 持有期自带 10min 兜底过期, 弹窗异常关闭也不会永久卡死监听。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const body = await readBody(event).catch(() => ({}))
    const cookieId = String(body?.cookieId || '')
    const on = !!body?.on
    if (!cookieId) {
      throw createError({ statusCode: 400, message: '缺少 cookieId' })
    }
    setManualVerifyHold(cookieId, on)
    return ok({ cookie_id: cookieId, hold: on })
  }),
)
