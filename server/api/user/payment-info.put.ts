/**
 * PUT /api/user/payment-info — 更新我的收款信息
 *
 * Body: { payment_type, payment_qrcode, alipay_id? }
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const paymentType = (body.payment_type || 'alipay').toString()
    if (!['alipay', 'wechat'].includes(paymentType)) {
      throw new ApiError(400, '收款方式仅支持 alipay 或 wechat')
    }
    const paymentQrcode = (body.payment_qrcode || '').toString().trim()
    if (!paymentQrcode) throw new ApiError(400, '收款码不能为空')
    const alipayId = body.alipay_id !== undefined ? String(body.alipay_id) : null

    await db.transaction(async () => {
      await setUserSetting(db, payload.userId, 'payment_type', paymentType)
      await setUserSetting(db, payload.userId, 'payment_qrcode', paymentQrcode)
      if (alipayId !== null) {
        await setUserSetting(db, payload.userId, 'alipay_id', alipayId)
      }
    })

    return ok({ payment_type: paymentType, payment_qrcode: paymentQrcode }, '收款信息已保存')
  }),
)
