/** PUT /api/notifications/channels/:id — update a channel. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的渠道 ID')
    const db = await getDb()
    const body = await readBody(event) || {}

    const existing = await db.get('SELECT id FROM notification_channels WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, '渠道不存在')

    if (body.type !== undefined) {
      const ALLOWED = ['qq', 'ding_talk', 'dingtalk', 'feishu', 'lark', 'bark', 'email', 'webhook', 'wechat', 'telegram']
      if (!ALLOWED.includes(String(body.type).toLowerCase())) throw new ApiError(400, '渠道类型无效')
    }

    const fields: string[] = []
    const params: any[] = []

    if (body.name !== undefined) { fields.push('name = ?'); params.push(String(body.name)) }
    if (body.type !== undefined) { fields.push('type = ?'); params.push(String(body.type).toLowerCase()) }
    if (body.config !== undefined) {
      let cfg = ''
      if (typeof body.config === 'string') {
        try { JSON.parse(body.config); cfg = body.config } catch { throw new ApiError(400, 'config 不是合法的 JSON 字符串') }
      } else if (body.config && typeof body.config === 'object') {
        cfg = JSON.stringify(body.config)
      } else { cfg = '{}' }
      fields.push('config = ?'); params.push(cfg)
    }
    if (body.enabled !== undefined) { fields.push('enabled = ?'); params.push(body.enabled ? 1 : 0) }

    if (fields.length === 0) throw new ApiError(400, '没有需要更新的字段')
    params.push(id)
    await db.run(`UPDATE notification_channels SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params)

    return ok({ id }, '渠道已更新')
  }),
)
