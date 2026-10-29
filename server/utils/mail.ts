/**
 * mail — 统一邮件发送出口。
 *
 * 邮件服务商由 system_settings.mail_provider 决定:
 *   - smtp   : nodemailer + system_settings.smtp_* (传统 SMTP 服务器)
 *   - resend : Resend HTTP API (system_settings.resend_api_key / resend_from)
 *
 * 所有需要发邮件的功能 (提现审核通知 / 通知渠道 email 测试 / 后续扩展)
 * 统一走 sendMail(), 由服务商配置自动分流, 调用方无需关心底层实现。
 */
import { getDb } from './db'

export interface SendMailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  /** 覆盖系统配置的发件人 (Resend 必须为已验证域名下的地址) */
  from?: string
}

export interface SendMailResult {
  sent: boolean
  provider: 'smtp' | 'resend'
  /** Resend 返回的邮件 ID / SMTP response */
  response?: any
  error?: string
}

async function getSetting(key: string): Promise<string> {
  const db = await getDb()
  const row = await db.get<{ value: string }>(
    'SELECT value FROM system_settings WHERE key_name = ?',
    [key],
  )
  return row?.value || ''
}

async function sendBySmtp(opts: SendMailOptions, from: string): Promise<SendMailResult> {
  const server = await getSetting('smtp_server')
  const port = Number((await getSetting('smtp_port')) || '587')
  const user = await getSetting('smtp_user')
  const password = await getSetting('smtp_password')
  const fromAddr = from || (await getSetting('smtp_from')) || user

  if (!server || !user) {
    return { sent: false, provider: 'smtp', error: 'SMTP 未配置 (服务器/用户名为空)' }
  }

  const nodemailer = await import('nodemailer')
  const transporter = nodemailer.createTransport({
    host: server,
    port,
    secure: port === 465,
    auth: { user, pass: password },
  })
  const info = await transporter.sendMail({
    from: fromAddr,
    to: Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  })
  return { sent: true, provider: 'smtp', response: info?.response || info?.messageId || '' }
}

async function sendByResend(opts: SendMailOptions, from: string): Promise<SendMailResult> {
  const apiKey = await getSetting('resend_api_key')
  const fromAddr = from || (await getSetting('resend_from'))
  if (!apiKey) return { sent: false, provider: 'resend', error: 'Resend API Key 未配置' }
  if (!fromAddr) return { sent: false, provider: 'resend', error: 'Resend 发件人地址未配置' }

  const res = await $fetch<any>('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      from: fromAddr,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    },
    timeout: 15000,
  })
  return { sent: true, provider: 'resend', response: res?.id || res }
}

/**
 * 按系统配置的 mail_provider 发送邮件。
 * 永不抛出: 失败时返回 { sent:false, error }, 调用方自行降级处理。
 */
export async function sendMail(opts: SendMailOptions): Promise<SendMailResult> {
  const provider = ((await getSetting('mail_provider')) || 'smtp').toLowerCase() === 'resend'
    ? 'resend'
    : 'smtp'
  try {
    return provider === 'resend'
      ? await sendByResend(opts, opts.from || '')
      : await sendBySmtp(opts, opts.from || '')
  } catch (e: any) {
    return { sent: false, provider, error: e?.message || String(e) }
  }
}
