/**
 * POST /api/listener/manual-token — 手动获取 IM token (用户在界面主动触发)。
 *
 * 立即对账号实调一次 mtop token 接口 (绕过引擎冷却窗口), 返回真实结果:
 *   ok          → token 已拿到, 监听链路恢复
 *   verdict=risk → 仍被 RGV587 拦截, 返回 punishUrl 供弹窗直接 iframe 加载官方验证页
 *                  (addCookieToHeader 契约, 人工拖滑块后凭证自动回传)
 *   verdict=auth → 登录态失效, 需重新扫码
 * 引擎托管中的账号走在线客户端 (状态/连败计数一致); 引擎未托管时独立实调并合并滚动 Cookie。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const body = await readBody(event).catch(() => ({}))
    const cookieId = String(body?.cookieId || '')
    if (!cookieId) {
      throw createError({ statusCode: 400, message: '缺少 cookieId' })
    }
    const db = await getDb()
    const row = await db.get<any>(
      `SELECT c.id, c.value, c.device_id, c.remark, c.username, COALESCE(cs.enabled, 1) AS enabled
       FROM cookies c LEFT JOIN cookie_status cs ON cs.cookie_id = c.id WHERE c.id = ?`,
      [cookieId],
    )
    if (!row) {
      throw createError({ statusCode: 404, message: '账号不存在' })
    }
    if (!row.enabled) {
      throw createError({ statusCode: 400, message: '账号已停用, 请先在「账号管理」启用' })
    }

    // 1) 内置引擎托管中 → 走在线客户端 (token/连败/冷却状态保持一致)
    const viaClient = await manualTokenForAccount(cookieId)
    if (viaClient) {
      return ok({
        ok: viaClient.ok,
        verdict: viaClient.verdict,
        ret: viaClient.ret,
        message: viaClient.message,
        punish_url: viaClient.punishUrl,
        account: cookieId,
        label: row.remark || row.username || cookieId,
      })
    }

    // 2) 引擎未托管 (待命/远程代理/刚重启) → 独立实调一次, 结果同样如实返回
    const cookieStr = String(row.value || '')
    if (!cookieStr) {
      throw createError({ statusCode: 400, message: '账号 Cookie 为空, 请重新扫码' })
    }
    const deviceId = row.device_id || generateDeviceId(transCookies(cookieStr)['unb'] || row.id)
    const { token, mergedCookies, ret, punishUrl } = await fetchTokenDetailed(cookieStr, deviceId)
    const verdict = classifyTokenError(ret)
    const mergedStr = Object.entries(mergedCookies).map(([k, v]) => `${k}=${v}`).join('; ')
    if (mergedStr && mergedStr !== cookieStr) {
      await db.run('UPDATE cookies SET value = ?, last_check_at = CURRENT_TIMESTAMP WHERE id = ?', [mergedStr, cookieId]).catch(() => {})
      applyExternalCookieUpdate(cookieId, mergedStr)
    }
    if (verdict === 'ok' && token) {
      recordTokenSuccess(cookieId)
      return ok({
        ok: true,
        verdict,
        ret: ret.join('; '),
        message: 'Token 获取成功 (该账号当前未被风控拦截)',
        punish_url: '',
        account: cookieId,
        label: row.remark || row.username || cookieId,
      })
    }
    if (verdict === 'risk') {
      recordTokenFailure(cookieId, ret, punishUrl)
      return ok({
        ok: false,
        verdict,
        ret: ret.join('; '),
        message: '被风控拦截 (RGV587), 请在弹窗内完成滑块验证后重试',
        punish_url: punishUrl,
        account: cookieId,
        label: row.remark || row.username || cookieId,
      })
    }
    if (verdict === 'auth') {
      return ok({
        ok: false,
        verdict,
        ret: ret.join('; '),
        message: '登录态已失效, 请到「账号管理」重新扫码',
        punish_url: '',
        account: cookieId,
        label: row.remark || row.username || cookieId,
      })
    }
    recordTokenFailure(cookieId, ret, punishUrl)
    return ok({
      ok: false,
      verdict,
      ret: ret.join('; '),
      message: `Token 获取未成功: ${ret.join('; ') || '空响应'}`,
      punish_url: punishUrl || '',
      account: cookieId,
      label: row.remark || row.username || cookieId,
    })
  }),
)
