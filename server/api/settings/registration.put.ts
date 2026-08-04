/** PUT /api/settings/registration — toggle registration_enabled. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const body = await readBody(event) || {}
    const enabled = body.enabled === true || body.enabled === 'true' || body.value === 'true'
    await setSystemSetting('registration_enabled', enabled ? 'true' : 'false', '是否开启用户注册')
    return ok({ registration_enabled: enabled }, enabled ? '已开启注册' : '已关闭注册')
  }),
)
