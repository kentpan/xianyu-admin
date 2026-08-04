/**
 * POST /api/settings/import — import system settings from JSON.
 * Body: { settings: { key: { value, description? } | string } }
 * Upserts each key via setSystemSetting.
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const body = await readBody(event)
    const { settings } = body || {}
    if (!settings || typeof settings !== 'object') throw new ApiError(400, '配置格式无效')

    const db = await getDb()
    let imported = 0
    let skipped = 0
    const protectedKeys = ['app_name'] // can be overridden but warned

    for (const [key, val] of Object.entries(settings)) {
      if (!key || typeof key !== 'string') { skipped++; continue }
      let value: string
      let description: string | undefined
      if (typeof val === 'string') {
        value = val
      } else if (val && typeof val === 'object' && 'value' in (val as any)) {
        value = String((val as any).value)
        description = (val as any).description
      } else {
        skipped++; continue
      }

      const existing = await db.get('SELECT key_name FROM system_settings WHERE key_name=?', [key])
      if (existing) {
        await db.run(
          'UPDATE system_settings SET value=?, description=COALESCE(?, description), updated_at=CURRENT_TIMESTAMP WHERE key_name=?',
          [value, description ?? null, key],
        )
      } else {
        await db.run(
          'INSERT INTO system_settings (key_name, value, description) VALUES (?, ?, ?)',
          [key, value, description ?? null],
        )
      }
      imported++
    }

    return ok({ imported, skipped }, `已导入 ${imported} 项配置，跳过 ${skipped} 项`)
  }),
)
