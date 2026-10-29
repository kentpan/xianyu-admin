/**
 * GET /api/sync/xian18 — 从 xian18-shop 拉取商品 + 库存
 *
 * 对接: xian18-shop 的 GET /api/sync/commodities
 * 鉴权: 调用方需登录 xianyu-admin(JWT),Bearer token 给 xian18-shop 用 XIAN18_SHOP_TOKEN
 *
 * 配置(.env):
 *   XIAN18_SHOP_URL=http://localhost:3000   # xian18-shop 地址
 *   XIAN18_SHOP_TOKEN=                       # xian18-shop 的 SEED_RECEIVE_TOKEN
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)  // xianyu-admin 登录校验

    const shopUrl = process.env.XIAN18_SHOP_URL || ''
    const shopToken = process.env.XIAN18_SHOP_TOKEN || ''
    if (!shopUrl || !shopToken) {
      throw new ApiError(500, '未配置 XIAN18_SHOP_URL 或 XIAN18_SHOP_TOKEN,请在 .env 中配置后重启')
    }

    const url = `${shopUrl.replace(/\/$/, '')}/api/sync/commodities`
    try {
      const res = await $fetch<any>(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${shopToken}`,
          'X-Source': 'xianyu-admin',
        },
        timeout: 10000,
      })

      // xian18-shop 返回 { code, msg, data: { commodities, total } }
      if (res?.code === 200 && res?.data) {
        return ok({
          commodities: res.data.commodities || [],
          total: res.data.total || 0,
          syncedAt: new Date().toISOString(),
        }, `同步成功,共 ${res.data.total || 0} 个商品`)
      }
      throw new ApiError(502, `xian18-shop 返回异常: ${res?.msg || '未知错误'}`)
    } catch (e: any) {
      console.log('[sync/xian18] error:', e)
      const msg = e?.data?.msg || e?.message || '网络错误'
      throw new ApiError(502, `同步失败: ${msg}`)
    }
  }),
)
