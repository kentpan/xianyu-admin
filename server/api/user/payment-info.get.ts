/**
 * GET /api/user/payment-info — 获取我的收款信息 (payment_type, payment_qrcode)
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    const paymentType = (await getUserSetting(db, payload.userId, 'payment_type')) || 'alipay'
    const paymentQrcode = await getUserSetting(db, payload.userId, 'payment_qrcode')
    const alipayId = await getUserSetting(db, payload.userId, 'alipay_id')

    return ok({
      payment_type: paymentType,
      payment_qrcode: paymentQrcode || '',
      alipay_id: alipayId || '',
    })
  }),
)
