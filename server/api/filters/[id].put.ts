/**
 * PUT /api/filters/:id — 更新消息过滤规则 (启停/改关键词/改类型)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!id || Number.isNaN(id)) throw new ApiError(400, '无效的规则 ID')

    const body = await readBody(event) || {}
    const existing = await db.get<any>('SELECT id FROM message_filters WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, '过滤规则不存在')

    const fields: string[] = []
    const params: any[] = []
    if (body.keyword !== undefined) {
      const keyword = (body.keyword || '').toString().trim()
      if (!keyword) throw new ApiError(400, '关键词不能为空')
      fields.push('keyword = ?')
      params.push(keyword)
    }
    if (body.filter_type !== undefined) {
      const ft = (body.filter_type || '').toString().trim()
      if (!['skip_reply', 'skip_notify'].includes(ft)) throw new ApiError(400, '无效的过滤类型')
      fields.push('filter_type = ?')
      params.push(ft)
    }
    if (body.enabled !== undefined) {
      fields.push('enabled = ?')
      params.push(body.enabled ? 1 : 0)
    }
    if (!fields.length) throw new ApiError(400, '没有需要更新的字段')

    fields.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id)
    await db.run(`UPDATE message_filters SET ${fields.join(', ')} WHERE id = ?`, params)

    return ok({ id }, '过滤规则已更新')
  }),
)
