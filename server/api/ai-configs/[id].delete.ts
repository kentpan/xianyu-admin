/**
 * DELETE /api/ai-configs/:id — 删除 AI 配置 (仅管理员)。
 * 仍被账号级/商品级 AI 设置引用的配置不允许删除, 需先改选其他配置。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isFinite(id) || id <= 0) throw new ApiError(400, '无效的配置 ID')

    const existing = await db.get<any>('SELECT id, name FROM ai_configs WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, '配置不存在')

    const accRefs = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM ai_reply_settings WHERE ai_config_id = ?', [id])
    const itemRefs = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM item_ai_settings WHERE ai_config_id = ?', [id])
    const refs = (accRefs?.c || 0) + (itemRefs?.c || 0)
    if (refs > 0) {
      throw new ApiError(400, `该配置仍被 ${refs} 处 AI 设置引用, 请先在自动回复/指定商品回复中改选其他配置`)
    }

    await db.run('DELETE FROM ai_configs WHERE id = ?', [id])
    return ok({ id }, 'AI 配置已删除')
  }),
)
