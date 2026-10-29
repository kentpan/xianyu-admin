/**
 * POST /api/notifications/channels/:id/test — send a real test notification
 * through the configured channel endpoint. Never throws: always returns an
 * `ok(...)` envelope so the UI gets a { sent, response | error } payload.
 *
 * 发送逻辑统一在 server/utils/channel-send.ts (与引擎通知分发器共用同一出口,
 * 保证"测试通过 = 引擎通知可用")。
 */
import { sendChannelMessage, parseChannelConfig } from '../../../../utils/channel-send'

const TEXT = '闲鱼超级管家测试通知'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的渠道 ID')

    const db = await getDb()
    const channel = await db.get<any>(
      'SELECT id, name, type, config, enabled FROM notification_channels WHERE id = ?',
      [id],
    )
    if (!channel) throw new ApiError(404, '渠道不存在')
    parseChannelConfig(channel) // config 可解析性预检 (坏配置走发送器的统一错误返回)

    const result = await sendChannelMessage(channel, TEXT)
    if (!result.sent) {
      return ok({ sent: false, error: result.error }, '发送失败: ' + (result.error || '未知错误'))
    }
    return ok({ sent: true, response: result.response }, '测试消息已发送')
  }),
)
