/** POST /api/ai-configs — 新建 AI 配置 (仅管理员)。Body: { name, model_name, api_key, base_url, enabled, remark } */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const name = (body.name ?? '').toString().trim()
    if (!name) throw new ApiError(400, '请填写配置名称')
    const model_name = (body.model_name ?? '').toString().trim() || 'qwen-plus'
    const api_key = (body.api_key ?? '').toString().trim()
    const base_url =
      (body.base_url ?? '').toString().trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    const enabled = body.enabled === 0 || body.enabled === false ? 0 : 1
    const remark = (body.remark ?? '').toString().trim().slice(0, 255)

    const dup = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM ai_configs WHERE name = ?', [name])
    if (dup?.c) throw new ApiError(400, '已存在同名配置')

    const r = await db.run(
      `INSERT INTO ai_configs (name, model_name, api_key, base_url, enabled, remark)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, model_name, api_key, base_url, enabled, remark],
    )
    return ok({ id: r.lastInsertId }, 'AI 配置已创建')
  }),
)
