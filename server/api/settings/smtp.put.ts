/** PUT /api/settings/smtp — update smtp_* settings. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const body = await readBody(event) || {}
    const allowed = ['smtp_server', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from']
    const updates: { key: string; value: string }[] = []
    for (const k of allowed) {
      if (body[k] !== undefined) updates.push({ key: k, value: String(body[k]) })
    }
    if (!updates.length) throw new ApiError(400, '没有需要更新的字段')

    for (const u of updates) await setSystemSetting(u.key, u.value)
    return ok({ updated: updates.map((u) => u.key) }, 'SMTP 设置已保存')
  }),
)
