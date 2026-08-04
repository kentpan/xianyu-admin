/**
 * GET /api/settings/export — export all system_settings as JSON download.
 * POST /api/settings/import — import settings from JSON body { settings: {key: value} }.
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const rows = await db.all<{ key_name: string; value: string; description: string }>(
      'SELECT key_name, value, description FROM system_settings',
    )
    const settings: Record<string, { value: string; description: string }> = {}
    for (const r of rows) {
      settings[r.key_name] = { value: r.value, description: r.description }
    }
    return ok({ settings, exportedAt: new Date().toISOString(), version: '1.0' }, '配置已导出')
  }),
)
