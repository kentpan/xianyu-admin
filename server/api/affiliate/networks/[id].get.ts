/** GET /api/affiliate/networks/:id — 获取单个联盟详情 (注册指引 + 字段)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const { getNetworkById } = await import('../../../utils/affiliate-networks')
    const n = getNetworkById(id)
    if (!n) throw new ApiError(404, '联盟不存在')
    return ok(n)
  }),
)
