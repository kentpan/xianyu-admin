/**
 * GET /api/settings/public — public system settings (no auth).
 *
 * 安全收敛: 未登录也可访问, 因此仅返回白名单内的非敏感展示键;
 * 密钥类 (smtp_password / resend_api_key / ai_api_key / engine_api_key 等)
 * 一律不在此输出, 管理页通过鉴权端点 GET /api/settings 读取。
 */
const PUBLIC_KEYS = [
  'app_name',
  'theme_color',
  'registration_enabled',
  'show_default_login_info',
  'login_captcha_enabled',
]

export default defineEventHandler(
  withApi(async () => {
    const config = useRuntimeConfig()
    const all = isInstalled() ? await getPublicSettings() : {}
    const settings: Record<string, any> = {}
    for (const k of PUBLIC_KEYS) {
      if (all[k] !== undefined) settings[k] = all[k]
    }
    return ok({
      installed: isInstalled(),
      appName: config.public.appName,
      appVersion: config.public.appVersion,
      brandColor: config.public.brandColor,
      settings,
    })
  }),
)
