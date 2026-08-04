/** POST /api/notifications/channels — create a channel. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const name = (body.name || '').toString().trim()
    const type = (body.type || '').toString().trim().toLowerCase()
    const ALLOWED = ['qq', 'ding_talk', 'dingtalk', 'feishu', 'lark', 'bark', 'email', 'webhook', 'wechat', 'telegram']
    if (!name) throw new ApiError(400, '渠道名称不能为空')
    if (!ALLOWED.includes(type)) throw new ApiError(400, '渠道类型无效')

    // config: accept object or string; always store as JSON string
    let configStr = ''
    if (typeof body.config === 'string') {
      // Validate JSON
      try { JSON.parse(body.config); configStr = body.config } catch { throw new ApiError(400, 'config 不是合法的 JSON 字符串') }
    } else if (body.config && typeof body.config === 'object') {
      configStr = JSON.stringify(body.config)
    } else {
      configStr = '{}'
    }

    const r = await db.run(
      `INSERT INTO notification_channels (name, type, config, enabled) VALUES (?, ?, ?, ?)`,
      [name, type, configStr, body.enabled === false || body.enabled === 0 ? 0 : 1],
    )
    return ok({ id: r.lastInsertId }, '渠道已创建')
  }),
)
