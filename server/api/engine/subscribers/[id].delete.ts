/**
 * DELETE /api/engine/subscribers/:id — 删除订阅者 (事件转发立即停止)。
 */
import { invalidateSubscriberCache } from '../../../utils/xianyu/publisher'

export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Math.round(Number(getRouterParam(event, 'id')))
    if (!id) throw new ApiError(400, '无效的订阅者 ID')
    const db = await getDb()
    const row = await db.get<any>('SELECT id, name FROM engine_subscribers WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '订阅者不存在')
    await db.run('DELETE FROM engine_subscribers WHERE id = ?', [id])
    invalidateSubscriberCache()
    return ok({ id }, `订阅者「${row.name}」已删除`)
  }),
)
