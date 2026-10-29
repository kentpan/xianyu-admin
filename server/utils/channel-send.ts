/**
 * channel-send — 通知渠道真实发送器 (8 类渠道, 被 notify 分发器与渠道测试端点共用)。
 *
 * 支持类型: qq(OneBot v11) / webhook / dingtalk / feishu / wechat(企业微信) / bark /
 *           telegram / email。全部为真实网络发送, 无任何模拟分支; 发送失败如实返回
 *           { sent: false, error }, 由调用方决定重试/落日志策略。
 *
 * 兼容两套配置字段名: 规范字段 (config.webhook/config.key/config.server …) 与
 * 通知渠道页表单字段 (config.access_token/config.webhook_url/config.device_key …)。
 */
import crypto from 'node:crypto'

export interface ChannelRow {
  id: number | string
  name: string
  type: string
  config: string | Record<string, any>
}

export interface SendResult {
  sent: boolean
  response?: any
  error?: string
}

const TIMEOUT = 8000

export function parseChannelConfig(channel: ChannelRow): Record<string, any> {
  try {
    return typeof channel.config === 'string' ? JSON.parse(channel.config || '{}') : (channel.config || {})
  } catch {
    return {}
  }
}

/** Build a DingTalk signed URL from access_token + secret. */
function dingTalkSignedUrl(accessToken: string, secret: string): string {
  const timestamp = Date.now()
  const stringToSign = `${timestamp}\n${secret}`
  const sign = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64')
  return `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(
    accessToken,
  )}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
}

/**
 * sendChannelMessage — 向单个渠道发送一条文本通知。
 * 永不抛出: 失败以 { sent: false, error } 返回。
 */
export async function sendChannelMessage(channel: ChannelRow, text: string, html?: string): Promise<SendResult> {
  const type = String(channel.type || '').toLowerCase()
  const cfg = parseChannelConfig(channel)

  try {
    if (type === 'email') {
      const to = cfg.to || cfg.email || cfg.recipient || cfg.address
      if (!to) return { sent: false, error: '渠道未配置收件邮箱 (config.to)' }
      const result = await sendMail({ to, subject: text.split('\n')[0] || '闲鱼管家通知', html: html || `<pre style="white-space:pre-wrap;font-family:inherit">${text}</pre>` })
      if (!result.sent) return { sent: false, error: result.error || '邮件发送失败' }
      return { sent: true, response: { provider: result.provider, id: result.response } }
    }

    if (type === 'qq') {
      // OneBot v11 HTTP API (NapCat / go-cqhttp / LLOneBot 等均兼容)。
      let base = String(cfg.base_url || cfg.server || cfg.url || '').replace(/\/+$/, '')
      if (!base) return { sent: false, error: '未配置 QQ 机器人 OneBot HTTP 地址 (config.base_url)' }
      if (!/https?:\/\//.test(base)) base = `http://${base}`
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = cfg.access_token || cfg.token
      if (token) headers.Authorization = `Bearer ${token}`
      const userId = cfg.user_id || cfg.qq
      const groupId = cfg.group_id || cfg.group
      if (!userId && !groupId) return { sent: false, error: '未配置接收人 (config.user_id 或 config.group_id)' }
      const endpoint = groupId ? `${base}/send_group_msg` : `${base}/send_private_msg`
      const payload = groupId
        ? { message: text, group_id: Number(groupId) }
        : { message: text, user_id: Number(userId) }
      const response: any = await $fetch(endpoint, {
        method: 'POST',
        headers,
        body: payload,
        timeout: TIMEOUT,
        ignoreResponseError: true,
      })
      if (response && typeof response === 'object' && response.retcode !== undefined && response.retcode !== 0) {
        return { sent: false, error: `QQ 机器人返回错误: ${response.msg || response.wording || response.retcode}`, response }
      }
      return { sent: true, response }
    }

    if (type === 'webhook') {
      const url = cfg.url || cfg.webhook || cfg.callback_url
      if (!url) return { sent: false, error: '未配置回调 URL' }
      const response: any = await $fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { text, source: 'xianyu-admin' },
        timeout: TIMEOUT,
        ignoreResponseError: true,
      })
      return { sent: true, response }
    }

    if (type === 'dingtalk' || type === 'ding_talk') {
      let url = cfg.webhook || cfg.url
      const secret = cfg.secret
      if (!url) {
        const token = cfg.access_token || cfg.token
        if (!token) return { sent: false, error: '未配置钉钉 Access Token 或 Webhook' }
        url = `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(token)}`
      }
      if (secret) {
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
      const response: any = await $fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { msgtype: 'text', text: { content: text } },
        timeout: TIMEOUT,
        ignoreResponseError: true,
      })
      if (response && typeof response === 'object' && 'errcode' in response && response.errcode !== 0) {
        return { sent: false, error: `钉钉返回错误: ${response.errmsg || response.errcode}`, response }
      }
      return { sent: true, response }
    }

    if (type === 'feishu' || type === 'lark') {
      const url = cfg.webhook || cfg.webhook_url || cfg.url
      if (!url) return { sent: false, error: '未配置飞书 Webhook URL' }
      const response: any = await $fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { msg_type: 'text', content: { text } },
        timeout: TIMEOUT,
        ignoreResponseError: true,
      })
      if (response && typeof response === 'object' && 'code' in response && response.code !== 0) {
        return { sent: false, error: `飞书返回错误: ${response.msg || response.code}`, response }
      }
      return { sent: true, response }
    }

    if (type === 'wechat') {
      // 企业微信群机器人 webhook (qyapi.weixin.qq.com)。
      const url =
        cfg.webhook ||
        cfg.url ||
        (cfg.key ? `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${cfg.key}` : '')
      if (!url) return { sent: false, error: '未配置企业微信 Webhook' }
      const response: any = await $fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { msgtype: 'text', text: { content: text } },
        timeout: TIMEOUT,
        ignoreResponseError: true,
      })
      if (response && typeof response === 'object' && 'errcode' in response && response.errcode !== 0) {
        return { sent: false, error: `企业微信返回错误: ${response.errmsg || response.errcode}`, response }
      }
      return { sent: true, response }
    }

    if (type === 'bark') {
      const key = cfg.key || cfg.device_key
      if (!key) return { sent: false, error: '未配置 Bark Device Key' }
      const server = (cfg.server || cfg.server_url || 'https://api.day.app').replace(/\/+$/, '')
      const getUrl = `${server}/${encodeURIComponent(key)}/${encodeURIComponent(text.slice(0, 200))}`
      const response: any = await $fetch(getUrl, {
        method: 'GET',
        timeout: TIMEOUT,
        ignoreResponseError: true,
      })
      if (response && typeof response === 'object' && 'code' in response && response.code !== 200) {
        return { sent: false, error: `Bark 返回错误: ${response.message || response.code}`, response }
      }
      return { sent: true, response }
    }

    if (type === 'telegram') {
      const botToken = cfg.bot_token || cfg.token
      const chatId = cfg.chat_id
      if (!botToken) return { sent: false, error: '未配置 Telegram Bot Token' }
      if (!chatId) return { sent: false, error: '未配置 Telegram Chat ID' }
      const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`
      const response: any = await $fetch(url, {
        method: 'GET',
        params: { chat_id: String(chatId), text },
        timeout: TIMEOUT,
        ignoreResponseError: true,
      })
      if (response && typeof response === 'object' && 'ok' in response && response.ok !== true) {
        return { sent: false, error: `Telegram 返回错误: ${response.description || 'unknown'}`, response }
      }
      return { sent: true, response }
    }

    return { sent: false, error: `不支持的渠道类型: ${type}` }
  } catch (e: any) {
    return { sent: false, error: e?.message || String(e) }
  }
}
