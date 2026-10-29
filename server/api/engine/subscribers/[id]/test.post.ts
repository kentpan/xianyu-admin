/**
 * POST /api/engine/subscribers/:id/test — 测试推送。
 * 向订阅者 Webhook 发送一条标记测试事件 (标准 Bearer 鉴权), 同步返回投递结果供 UI 展示。
 */
import { deliverTestEvent } from '../../../../utils/xianyu/publisher'

export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Math.round(Number(getRouterParam(event, 'id')))
    if (!id) throw new ApiError(400, '无效的订阅者 ID')
    const result = await deliverTestEvent(id)
    if (!result.ok) throw new ApiError(502, `投递失败: ${result.message}`)
    return ok(result, '测试事件已送达')
  }),
)
