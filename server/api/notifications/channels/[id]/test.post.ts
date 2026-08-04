/**
 * POST /api/notifications/channels/:id/test — send a real test notification
 * through the configured channel endpoint. Never throws: always returns an
 * `ok(...)` envelope so the UI gets a { sent, response | error } payload.
 *
 * Supported channel types: qq / dingtalk / ding_talk / feishu / lark / bark /
 * email / webhook / wechat / telegram. The endpoint accepts both the spec
 * field names (config.webhook, config.key, config.server, …) and the field
 * names used by the notification-channels.vue form (config.access_token,
 * config.webhook_url, config.device_key, config.server_url, …) so test send
 * works against channels actually created via the UI.
 */
import crypto from 'node:crypto'

const TEXT = '闲鱼超级管家测试通知'
const TIMEOUT = 8000

/** Build a DingTalk signed URL from access_token + secret. */
function dingTalkSignedUrl(accessToken: string, secret: string): string {
  const timestamp = Date.now()
  const stringToSign = `${timestamp}\n${secret}`
  const sign = crypto
    .createHmac('sha256', secret)
    .update(stringToSign)
    .digest('base64')
  return `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(
    accessToken,
  )}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
}

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

    const type = String(channel.type || '').toLowerCase()
    let cfg: Record<string, any> = {}
    try {
      cfg = typeof channel.config === 'string' ? JSON.parse(channel.config || '{}') : (channel.config || {})
    } catch {
      cfg = {}
    }

    try {
      let response: any = null

      if (type === 'email') {
        // Real SMTP send is out of scope; simulate success.
        return ok({ sent: true, response: { simulated: true }, message: '邮件测试已模拟（需配置SMTP）' }, '邮件测试已模拟（需配置SMTP）')
      }

      if (type === 'qq') {
        // QQ bot send requires a separate bot bridge; simulate success.
        return ok({ sent: true, response: { simulated: true }, message: 'QQ通知测试已模拟' }, 'QQ通知测试已模拟')
      }

      if (type === 'webhook') {
        const url = cfg.url || cfg.webhook || cfg.callback_url
        if (!url) throw new Error('未配置回调 URL')
        response = await $fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { text: TEXT, source: 'xianyu-admin' },
          timeout: TIMEOUT,
          ignoreResponseError: true,
        })
        return ok({ sent: true, response }, '测试消息已发送')
      }

      if (type === 'dingtalk' || type === 'ding_talk') {
        // Accept either a full webhook URL or an access_token.
        let url = cfg.webhook || cfg.url
        const secret = cfg.secret
        if (!url) {
          const token = cfg.access_token || cfg.token
          if (!token) throw new Error('未配置钉钉 Access Token 或 Webhook')
          url = `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(token)}`
        }
        if (secret) {
          // Append timestamp + sign. Works whether url is the bare oapi URL
          // (with access_token only) or already includes other params.
          const tokenMatch = url.match(/[?&]access_token=([^&]+)/)
          if (tokenMatch) {
            url = dingTalkSignedUrl(decodeURIComponent(tokenMatch[1]), secret)
          } else {
            const ts = Date.now()
            const sign = encodeURIComponent(
              crypto.createHmac('sha256', secret).update(`${ts}\n${secret}`).digest('base64'),
            )
            url = `${url}&timestamp=${ts}&sign=${sign}`
          }
        }
        response = await $fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { msgtype: 'text', text: { content: TEXT } },
          timeout: TIMEOUT,
          ignoreResponseError: true,
        })
        // DingTalk returns { errcode: 0, errmsg: 'ok' } on success.
        if (response && typeof response === 'object' && 'errcode' in response && response.errcode !== 0) {
          throw new Error(`钉钉返回错误: ${response.errmsg || response.errcode}`)
        }
        return ok({ sent: true, response }, '测试消息已发送')
      }

      if (type === 'feishu' || type === 'lark') {
        const url = cfg.webhook || cfg.webhook_url || cfg.url
        if (!url) throw new Error('未配置飞书 Webhook URL')
        response = await $fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { msg_type: 'text', content: { text: TEXT } },
          timeout: TIMEOUT,
          ignoreResponseError: true,
        })
        // Feishu returns { code: 0, msg: 'success' } on success.
        if (response && typeof response === 'object' && 'code' in response && response.code !== 0) {
          throw new Error(`飞书返回错误: ${response.msg || response.code}`)
        }
        return ok({ sent: true, response }, '测试消息已发送')
      }

      if (type === 'wechat') {
        // WeChat Work group robot webhook (preferred) — page form stores
        // corp_id/agent_id/secret which would require a token-exchange dance;
        // for test send we only fire if a webhook URL or key is configured.
        const url =
          cfg.webhook ||
          cfg.url ||
          (cfg.key ? `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${cfg.key}` : '')
        if (!url) throw new Error('未配置企业微信 Webhook')
        response = await $fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { msgtype: 'text', text: { content: TEXT } },
          timeout: TIMEOUT,
          ignoreResponseError: true,
        })
        if (response && typeof response === 'object' && 'errcode' in response && response.errcode !== 0) {
          throw new Error(`企业微信返回错误: ${response.errmsg || response.errcode}`)
        }
        return ok({ sent: true, response }, '测试消息已发送')
      }

      if (type === 'bark') {
        const key = cfg.key || cfg.device_key
        if (!key) throw new Error('未配置 Bark Device Key')
        const server = (cfg.server || cfg.server_url || 'https://api.day.app').replace(/\/+$/, '')
        // Prefer GET on the canonical api.day.app/{key}/{text} path.
        const getUrl = `${server}/${encodeURIComponent(key)}/${encodeURIComponent(TEXT)}`
        response = await $fetch(getUrl, {
          method: 'GET',
          timeout: TIMEOUT,
          ignoreResponseError: true,
        })
        if (response && typeof response === 'object' && 'code' in response && response.code !== 200) {
          throw new Error(`Bark 返回错误: ${response.message || response.code}`)
        }
        return ok({ sent: true, response }, '测试消息已发送')
      }

      if (type === 'telegram') {
        const botToken = cfg.bot_token || cfg.token
        const chatId = cfg.chat_id
        if (!botToken) throw new Error('未配置 Telegram Bot Token')
        if (!chatId) throw new Error('未配置 Telegram Chat ID')
        const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`
        response = await $fetch(url, {
          method: 'GET',
          params: { chat_id: String(chatId), text: TEXT },
          timeout: TIMEOUT,
          ignoreResponseError: true,
        })
        if (response && typeof response === 'object' && 'ok' in response && response.ok !== true) {
          throw new Error(`Telegram 返回错误: ${response.description || 'unknown'}`)
        }
        return ok({ sent: true, response }, '测试消息已发送')
      }

      throw new Error(`不支持的渠道类型: ${type}`)
    } catch (e: any) {
      // Never throw — surface the failure inside the envelope so the UI can
      // toast it without a network-error path.
      const message = e?.message || String(e)
      return ok({ sent: false, error: message }, '发送失败: ' + message)
    }
  }),
)
