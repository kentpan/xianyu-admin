/**
 * GET /api/listener/verify-state?cookieId=xxx — 滑块验证弹窗打开时读一次本地状态。
 *
 * 纯本地读取 (数据库 + 进程内连败状态), 零闲鱼请求。弹窗打开时调用一次用于展示
 * 连败次数与挑战链接, 不做任何轮询 (自动弹窗走 /api/listener/verify-stream SSE 推送)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const query = getQuery(event)
    const cookieId = String(query.cookieId || '')
    if (!cookieId) {
      throw createError({ statusCode: 400, message: '缺少 cookieId' })
    }
    const db = await getDb()
    const row = await db.get<any>(
      'SELECT id, value, cookie_status_text, remark, username FROM cookies WHERE id = ?',
      [cookieId],
    )
    if (!row) {
      throw createError({ statusCode: 404, message: '账号不存在' })
    }
    const st = getVerifyState(cookieId)
    return ok({
      cookie_id: cookieId,
      label: row.remark || row.username || cookieId,
      state: row.cookie_status_text || '',
      streak: st?.streak || 0,
      punish_url: st?.punishUrl || '',
      last_ret: st?.lastRet || '',
      last_at: st?.lastAt || 0,
      x5sec_present: /(?:^|;\s*)x5sec=/i.test(String(row.value || '')),
    })
  }),
)
