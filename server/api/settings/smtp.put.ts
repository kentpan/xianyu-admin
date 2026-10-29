/** PUT /api/settings/smtp — update mail provider settings (SMTP / Resend). */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const body = await readBody(event) || {}
    const allowed = [
      'mail_provider', 'smtp_server', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from',
      'resend_api_key', 'resend_from',
    ]
    const updates: { key: string; value: string }[] = []
    for (const k of allowed) {
      if (body[k] !== undefined) updates.push({ key: k, value: String(body[k]) })
    }
    if (!updates.length) throw new ApiError(400, '没有需要更新的字段')

    if (body.mail_provider !== undefined && !['smtp', 'resend'].includes(String(body.mail_provider))) {
      throw new ApiError(400, '邮件服务商仅支持 smtp 或 resend')
    }

    for (const u of updates) await setSystemSetting(u.key, u.value)
    return ok({ updated: updates.map((u) => u.key) }, '邮件设置已保存')
  }),
)
