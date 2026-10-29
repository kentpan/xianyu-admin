/** GET /api/affiliate/networks — 列出全部联盟 (含注册指引 + 字段配置)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const { AFFILIATE_NETWORKS } = await import('../../../utils/affiliate-networks')
    return ok({
      domestic: AFFILIATE_NETWORKS.filter((n) => n.region === 'domestic' && n.enabled),
      overseas: AFFILIATE_NETWORKS.filter((n) => n.region === 'overseas' && n.enabled),
    })
  }),
)
