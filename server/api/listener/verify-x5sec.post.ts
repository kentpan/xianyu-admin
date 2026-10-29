/**
 * POST /api/listener/verify-x5sec — 接收官方验证页 iframe postMessage 回传的 x5sec 凭证。
 *
 * 官方契约 (punishpage.min.js 实证): 挑战页以 addCookieToHeader=1 且处于 iframe 中时,
 * 滑块人工拖动通过 → 页面 XHR /_____tmd_____/verify/ → 从 bx-x5sec 响应头取凭证 →
 * window.parent.postMessage({type:'child', content:'{...x5sec:{value,expire,host}...}'}, '*')。
 *
 * 本端点收到凭证后:
 *   1) 合并 x5sec 进账号 Cookie (DB 持久化 + 引擎运行时热替换, mergeSetCookiesIntoAccount)
 *   2) 立即实调一次 mtop token 接口验证赎回结果 (绕过引擎冷却, 与 manual-token 同语义)
 *   3) 如实返回 ok / risk (附新挑战链接) / auth / unknown
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const body = await readBody(event).catch(() => ({}))
    const cookieId = String(body?.cookieId || '')
    const x5sec = String(body?.x5sec || '').trim()
    if (!cookieId) {
      throw createError({ statusCode: 400, message: '缺少 cookieId' })
    }
    if (!x5sec || x5sec.length > 4096 || /["'\\\s]/.test(x5sec)) {
      throw createError({ statusCode: 400, message: 'x5sec 凭证格式无效' })
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

    // 1) 凭证合并进账号 Cookie (真实合并结果: added 变更字段数 / x5sec 是否落库)
    const merged = await mergeSetCookiesIntoAccount(cookieId, [`x5sec=${x5sec}; Path=/; Domain=.goofish.com`])
    if (!merged.x5sec) {
      throw createError({ statusCode: 500, message: 'x5sec 合并未生效, 请重试验证' })
    }

    // 2) 实调 token 验证赎回 (引擎托管 → 在线客户端, 状态/连败/冷却保持一致)
    const viaClient = await manualTokenForAccount(cookieId)
    if (viaClient) {
      return ok({
        ok: viaClient.ok,
        verdict: viaClient.verdict,
        ret: viaClient.ret,
        message: viaClient.ok
          ? '滑块验证通过, x5sec 已合并回账号, Token 获取成功, 监听恢复中'
          : viaClient.message,
        punish_url: viaClient.punishUrl,
        merged_fields: merged.added,
        account: cookieId,
        label: row.remark || row.username || cookieId,
      })
    }

    // 3) 引擎未托管 → 独立实调一次, 结果同样如实返回
    const cookieStr = String(row.value || '')
    if (!cookieStr) {
      throw createError({ statusCode: 400, message: '账号 Cookie 为空, 请重新扫码' })
    }
    const deviceId = row.device_id || generateDeviceId(transCookies(cookieStr)['unb'] || row.id)
    const { token, ret, punishUrl } = await fetchTokenDetailed(cookieStr, deviceId)
    const verdict = classifyTokenError(ret)
    if (verdict === 'ok' && token) {
      recordTokenSuccess(cookieId)
      return ok({
        ok: true,
        verdict,
        ret: ret.join('; '),
        message: '滑块验证通过, x5sec 已合并回账号, Token 获取成功',
        punish_url: '',
        merged_fields: merged.added,
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
        message: 'x5sec 已合并但仍被风控拦截, 已换新挑战, 请在弹窗内重新拖动滑块',
        punish_url: punishUrl,
        merged_fields: merged.added,
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
        merged_fields: merged.added,
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
      merged_fields: merged.added,
      account: cookieId,
      label: row.remark || row.username || cookieId,
    })
  }),
)
