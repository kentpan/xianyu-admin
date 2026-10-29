/**
 * POST /api/sync/xian18-consume — 触发发卡时从 xian18-shop 扣减卡密
 *
 * 对接: xian18-shop 的 POST /api/sync/consume
 * 鉴权: 调用方需登录 xianyu-admin(JWT),Bearer token 给 xian18-shop 用 XIAN18_SHOP_TOKEN
 *
 * 请求体: { commodityId: number, quantity?: number, externalOrderNo?: string }
 * 返回:   { commodityId, commodityName, quantity, cards: [{ id, secret }] }
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)  // xianyu-admin 登录校验

    const shopUrl = process.env.XIAN18_SHOP_URL || ''
    const shopToken = process.env.XIAN18_SHOP_TOKEN || ''
    if (!shopUrl || !shopToken) {
      throw new ApiError(500, '未配置 XIAN18_SHOP_URL 或 XIAN18_SHOP_TOKEN')
    }

    const body = await readBody(event) || {}
    const commodityId = Number(body.commodityId)
    const quantity = Number(body.quantity) || 1
    const externalOrderNo = (body.externalOrderNo || '').toString().trim()

    if (!commodityId) {
      throw new ApiError(400, '缺少 commodityId')
    }

    const url = `${shopUrl.replace(/\/$/, '')}/api/sync/consume`
    try {
      const res = await $fetch<any>(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${shopToken}`,
          'Content-Type': 'application/json',
          'X-Source': 'xianyu-admin',
        },
        body: { commodityId, quantity, externalOrderNo },
        timeout: 10000,
      })

      if (res?.code === 200 && res?.data) {
        return ok(res.data, `扣减成功,共 ${res.data.quantity || 0} 张卡密`)
      }
      throw new ApiError(502, `xian18-shop 返回异常: ${res?.msg || '未知错误'}`)
    } catch (e: any) {
      console.log('[sync/xian18-consume] error:', e)
      const msg = e?.data?.msg || e?.message || '网络错误'
      throw new ApiError(502, `扣减失败: ${msg}`)
    }
  }),
)
