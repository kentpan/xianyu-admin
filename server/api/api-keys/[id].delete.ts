/**
 * DELETE /api/api-keys/:id — 删除 API Key (仅管理员)。
 * 调用日志与已发放的验证码保留 (日志脱钩删除, 验证码与 Key 无强绑定)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isFinite(id) || id <= 0) throw new ApiError(400, '无效的 API Key ID')

    const existing = await db.get('SELECT id FROM api_keys WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, 'API Key 不存在')

    await db.run('DELETE FROM api_keys WHERE id = ?', [id])
    await db.run('DELETE FROM api_key_logs WHERE api_key_id = ?', [id]).catch(() => {})
    return ok({ id }, 'API Key 已删除')
  }),
)
