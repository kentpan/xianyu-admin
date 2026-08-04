/** PUT /api/accounts/:id — update cookie fields. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()
    const body = await readBody(event) || {}

    const existing = await db.get('SELECT id FROM cookies WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, '账号不存在')

    const fields: string[] = []
    const params: any[] = []

    const allowed: Record<string, string> = {
      remark: 'remark',
      pause_duration: 'pause_duration',
      auto_confirm: 'auto_confirm',
      username: 'username',
      password: 'password',
      show_browser: 'show_browser',
      value: 'value',
    }

    for (const [key, col] of Object.entries(allowed)) {
      if (body[key] !== undefined) {
        let v = body[key]
        if (key === 'auto_confirm' || key === 'show_browser') {
          v = v ? 1 : 0
        } else if (key === 'pause_duration') {
          v = Number(v) || 0
        } else {
          v = String(v ?? '')
        }
        fields.push(`${col} = ?`)
        params.push(v)
      }
    }

    if (fields.length === 0) throw new ApiError(400, '没有需要更新的字段')

    params.push(id)
    await db.run(`UPDATE cookies SET ${fields.join(', ')} WHERE id = ?`, params)

    return ok({ id }, '账号已更新')
  }),
)
