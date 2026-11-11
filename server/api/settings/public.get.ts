/**
 * GET /api/settings/public — 登录页公共展示配置 (no auth)。
 *
 * 消费边界 (全仓唯一调用方 = app/pages/login.vue, 经 useAsyncData SSR 取数):
 * 仅返回登录页实际消费的字段, 白名单外的键一律不出; 管理页 (settings.vue) 走
 * 鉴权端点 GET /api/settings 读取全部设置。appName/appVersion/brandColor 由
 * runtimeConfig 在 SSR 渲染期内联, 无需接口下发 (砍冗余, 浏览器零请求零冗余)。
 * 查询按白名单精确取行 (不再全表读 system_settings, 行读取与 D1 限额对齐)。
 */
const PUBLIC_KEYS = ['registration_enabled']

export default defineEventHandler(
  withApi(async (event) => {
    // 未安装时不触库, 直接返回空配置 (注册入口默认不显示, 语义自洽)
    if (!(await isInstalledAsync(event))) return ok({ settings: {} })
    const db = await getDb(event)
    const rows = await db.all<{ key_name: string; value: string }>(
      `SELECT key_name, value FROM system_settings WHERE key_name IN (${PUBLIC_KEYS.map(() => '?').join(',')})`,
      PUBLIC_KEYS,
    )
    const settings: Record<string, any> = {}
    for (const r of rows) {
      let v: any = r.value
      if (v === 'true') v = true
      else if (v === 'false') v = false
      settings[r.key_name] = v
    }
    return ok({ settings })
  }),
)
