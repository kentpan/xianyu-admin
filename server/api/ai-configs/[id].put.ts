/** PUT /api/ai-configs/:id — 更新 AI 配置 (仅管理员)。api_key 留空或掩码 "******" 时保留原值。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isFinite(id) || id <= 0) throw new ApiError(400, '无效的配置 ID')
    const body = await readBody(event) || {}

    const existing = await db.get<any>('SELECT * FROM ai_configs WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, '配置不存在')

    const name = (body.name ?? '').toString().trim()
    if (!name) throw new ApiError(400, '请填写配置名称')
    const dup = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM ai_configs WHERE name = ? AND id != ?', [name, id])
    if (dup?.c) throw new ApiError(400, '已存在同名配置')

    const model_name = (body.model_name ?? '').toString().trim() || 'qwen-plus'
    const base_url =
      (body.base_url ?? '').toString().trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    const enabled = body.enabled === 0 || body.enabled === false ? 0 : 1
    const remark = (body.remark ?? '').toString().trim().slice(0, 255)

    const incomingKey = (body.api_key ?? '').toString().trim()
    const api_key = (!incomingKey || incomingKey === '******') && existing.api_key ? existing.api_key : incomingKey

    await db.run(
      `UPDATE ai_configs SET
         name = ?, model_name = ?, api_key = ?, base_url = ?, enabled = ?, remark = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, model_name, api_key, base_url, enabled, remark, id],
    )
    return ok({ id }, 'AI 配置已更新')
  }),
)
