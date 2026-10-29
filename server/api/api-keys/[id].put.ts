/**
 * PUT /api/api-keys/:id — 更新 API Key 元信息 (仅管理员)。
 * 可更新: name / rate_limit_num / rate_limit_window / enabled / remark / expires_at (Key 本体只能重置)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isFinite(id) || id <= 0) throw new ApiError(400, '无效的 API Key ID')
    const body = await readBody(event) || {}

    const existing = await db.get<any>('SELECT * FROM api_keys WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, 'API Key 不存在')

    const fields: string[] = []
    const params: any[] = []
    if (body.name !== undefined) {
      const name = (body.name || '').toString().trim()
      if (!name) throw new ApiError(400, '业务方名称不能为空')
      const dup = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM api_keys WHERE name = ? AND id != ?', [name, id])
      if (dup?.c) throw new ApiError(400, '已存在同名业务方')
      fields.push('name = ?')
      params.push(name)
    }
    if (body.rate_limit_num !== undefined) {
      fields.push('rate_limit_num = ?')
      params.push(Math.min(100000, Math.max(1, Math.round(Number(body.rate_limit_num) || 30))))
    }
    if (body.rate_limit_window !== undefined) {
      fields.push('rate_limit_window = ?')
      params.push(Math.min(86400, Math.max(1, Math.round(Number(body.rate_limit_window) || 60))))
    }
    if (body.enabled !== undefined) {
      fields.push('enabled = ?')
      params.push(body.enabled ? 1 : 0)
    }
    if (body.remark !== undefined) {
      fields.push('remark = ?')
      params.push((body.remark || '').toString().trim().slice(0, 255))
    }
    if (body.expires_at !== undefined) {
      const { normalizeApiKeyExpiry } = await import('../../utils/api-key-auth')
      fields.push('expires_at = ?')
      params.push(normalizeApiKeyExpiry(body.expires_at))
    }
    if (!fields.length) throw new ApiError(400, '没有需要更新的字段')

    params.push(id)
    await db.run(`UPDATE api_keys SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params)
    return ok({ id }, 'API Key 已更新')
  }),
)
