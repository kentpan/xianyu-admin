/**
 * POST /api/verify-codes/verify — 卡密核销 (开放接口, 业务方 Bearer 鉴权)。
 *
 * 请求:
 *   Authorization: Bearer <apikey>   (「API Key管理」生成的业务方 Key, 受独立限速+有效期)
 *   Body: { "code": "A3b9x2" }      (买家收到的卡密, 卡密型卡券发货时生成)
 *
 * 响应 (统一 envelope, 业务结果一律 HTTP 200, 鉴权/限速错误保留对应状态码):
 *   { "success": true,  "msg": "验证成功",       "data": { 卡密/订单/商品/买家 回执 } }
 *   { "success": false, "msg": "验证失败: 原因",  "data": {} }
 *   401/403/429        → { "success": false, "msg": "鉴权/停用/过期/限速原因", "data": {} }
 */
export default defineEventHandler(async (event) => {
  let identity: Awaited<ReturnType<typeof requireApiKey>>
  try {
    identity = await requireApiKey(event, 'verify-codes/verify')
  } catch (e: any) {
    setResponseStatus(event, e?.statusCode || 500)
    return { success: false, msg: e?.message || '验证失败: 服务器内部错误', data: {} }
  }

  try {
    const body = await readBody(event) || {}
    const rawCode = (body.code ?? body.card ?? body.key ?? '').toString()
    const ip = clientIp(event)

    const db = await getDb()
    const outcome = await consumeCardCode(db, rawCode, identity.id, ip)
    await logApiKeyCall(identity.id, 'verify-codes/verify', outcome.valid, 200, outcome.reason.slice(0, 200), event)
    setResponseStatus(event, 200)

    if (outcome.valid) {
      return {
        success: true,
        msg: '验证成功',
        data: {
          code: outcome.row?.code || rawCode.trim(),
          card_name: outcome.row?.card_name || '',
          order_id: outcome.row?.order_id || '',
          item_id: outcome.row?.item_id || '',
          buyer_id: outcome.row?.buyer_id || '',
          status: 'used',
          used_at: outcome.row?.used_at || null,
          verified_by: identity.name,
        },
      }
    }
    return {
      success: false,
      msg: `验证失败: ${outcome.reason}`,
      data: outcome.row
        ? {
            code: outcome.row.code,
            card_name: outcome.row.card_name,
            order_id: outcome.row.order_id,
            item_id: outcome.row.item_id,
            buyer_id: outcome.row.buyer_id,
            status: outcome.row.status,
            used_at: outcome.row.used_at,
          }
        : {},
    }
  } catch (e: any) {
    await logApiKeyCall(identity.id, 'verify-codes/verify', false, 400, String(e?.message || '请求无效').slice(0, 200), event)
    setResponseStatus(event, 200)
    return { success: false, msg: `验证失败: ${e?.message || '请求无效'}`, data: {} }
  }
})
