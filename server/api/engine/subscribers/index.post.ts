/**
 * POST /api/engine/subscribers — 新增事件发布订阅者 (下游项目)。
 * Body: { name, webhook_url, remark? }
 * 创建时自动生成独立订阅令牌 (Authorization: Bearer), 下游项目用它做服务端鉴权。
 */
import { generateEngineToken } from '../../../utils/engine-auth'

export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const body = await readBody(event) || {}
    const name = String(body.name || '').trim()
    const webhookUrl = String(body.webhook_url || '').trim()
    const remark = String(body.remark || '').trim()
    if (!name) throw new ApiError(400, '请填写订阅者名称')
    if (!/^https?:\/\//i.test(webhookUrl)) throw new ApiError(400, 'Webhook 地址必须以 http:// 或 https:// 开头')

    const db = await getDb()
    const dup = await db.get('SELECT id FROM engine_subscribers WHERE name = ?', [name])
    if (dup) throw new ApiError(409, '已存在同名订阅者')

    await db.run(
      `INSERT INTO engine_subscribers (name, token, webhook_url, remark, enabled)
       VALUES (?, ?, ?, ?, 1)`,
      [name, generateEngineToken(), webhookUrl, remark],
    )
    const row = await db.get<any>('SELECT * FROM engine_subscribers WHERE name = ?', [name])
    return ok(row, '订阅者已添加, 事件将开始转发到其 Webhook')
  }),
)
