/** PUT /api/settings/:key — admin-only: upsert a system setting. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const key = (getRouterParam(event, 'key') || '').trim()
    if (!key) throw new ApiError(400, '缺少 setting key')
    const body = await readBody(event) || {}

    const value = body.value === undefined ? '' : (
      typeof body.value === 'string' ? body.value : JSON.stringify(body.value)
    )
    const description = body.description !== undefined ? String(body.description) : undefined

    await setSystemSetting(key, value, description)
    return ok({ key, value }, '设置已保存')
  }),
)
