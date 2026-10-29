/**
 * POST /api/api-keys/:id/regenerate — 重置 API Key 本体 (仅管理员)。
 * 旧 Key 即时作废, 返回新 Key 明文; 调用统计保留。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isFinite(id) || id <= 0) throw new ApiError(400, '无效的 API Key ID')

    const existing = await db.get('SELECT id FROM api_keys WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, 'API Key 不存在')

    const { generateApiKey } = await import('../../../utils/api-key-auth')
    const api_key = generateApiKey()
    await db.run('UPDATE api_keys SET api_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [api_key, id])
    return ok({ id, api_key }, 'API Key 已重置, 旧 Key 即时作废')
  }),
)
