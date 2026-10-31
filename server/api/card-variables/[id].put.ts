/** PUT /api/card-variables/:id — 更新变量 (显示名/说明/固定值/启用开关/排序); builtin 变量不可改 var_key。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const id = Math.round(Number(getRouterParam(event, 'id')) || 0)
    const row = await db.get<any>('SELECT id, builtin FROM card_variables WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '变量不存在')
    const body = await readBody(event) || {}

    const sets: string[] = []
    const params: any[] = []
    if (body.label !== undefined) {
      const label = (body.label || '').toString().trim()
      if (!label) throw new ApiError(400, '变量显示名不能为空')
      sets.push('label = ?')
      params.push(label)
    }
    if (body.description !== undefined) {
      sets.push('description = ?')
      params.push((body.description || '').toString().slice(0, 500))
    }
    if (body.sample_value !== undefined) {
      sets.push('sample_value = ?')
      params.push((body.sample_value ?? '').toString().slice(0, 2000))
    }
    if (body.enabled !== undefined) {
      sets.push('enabled = ?')
      params.push(body.enabled === false || body.enabled === 0 ? 0 : 1)
    }
    if (body.sort !== undefined) {
      sets.push('sort = ?')
      params.push(Math.round(Number(body.sort) || 0))
    }
    if (!sets.length) throw new ApiError(400, '没有需要更新的字段')
    sets.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id)
    await db.run(`UPDATE card_variables SET ${sets.join(', ')} WHERE id = ?`, params)
    return ok({ id }, '变量已更新')
  }),
)
