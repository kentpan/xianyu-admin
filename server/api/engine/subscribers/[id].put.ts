/**
 * PUT /api/engine/subscribers/:id — 更新订阅者。
 * Body: { name?, webhook_url?, remark?, enabled?, regenerate_token? }
 * regenerate_token=true 时重新生成订阅令牌, 旧令牌即时作废。
 */
import { generateEngineToken } from '../../../utils/engine-auth'
import { invalidateSubscriberCache } from '../../../utils/xianyu/publisher'

export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Math.round(Number(getRouterParam(event, 'id')))
    if (!id) throw new ApiError(400, '无效的订阅者 ID')
    const body = await readBody(event) || {}

    const db = await getDb()
    const row = await db.get<any>('SELECT id FROM engine_subscribers WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '订阅者不存在')

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) throw new ApiError(400, '订阅者名称不能为空')
      const dup = await db.get('SELECT id FROM engine_subscribers WHERE name = ? AND id != ?', [name, id])
      if (dup) throw new ApiError(409, '已存在同名订阅者')
      await db.run('UPDATE engine_subscribers SET name = ? WHERE id = ?', [name, id])
    }
    if (body.webhook_url !== undefined) {
      const url = String(body.webhook_url).trim()
      if (!/^https?:\/\//i.test(url)) throw new ApiError(400, 'Webhook 地址必须以 http:// 或 https:// 开头')
      await db.run('UPDATE engine_subscribers SET webhook_url = ? WHERE id = ?', [url, id])
    }
    if (body.remark !== undefined) {
      await db.run('UPDATE engine_subscribers SET remark = ? WHERE id = ?', [String(body.remark).trim(), id])
    }
    if (body.enabled !== undefined) {
      await db.run('UPDATE engine_subscribers SET enabled = ? WHERE id = ?', [body.enabled ? 1 : 0, id])
    }
    if (body.regenerate_token) {
      await db.run('UPDATE engine_subscribers SET token = ?, consecutive_failures = 0, muted_until = NULL WHERE id = ?', [generateEngineToken(), id])
    }
    await db.run('UPDATE engine_subscribers SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]).catch(() => {})

    invalidateSubscriberCache()
    const updated = await db.get<any>('SELECT * FROM engine_subscribers WHERE id = ?', [id])
    return ok(updated, body.regenerate_token ? '令牌已重置, 旧令牌即时作废' : '订阅者已更新')
  }),
)
