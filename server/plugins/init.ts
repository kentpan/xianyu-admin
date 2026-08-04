/**
 * Server startup plugin — initialises the DB schema on first boot.
 * Safe to call repeatedly (CREATE TABLE IF NOT EXISTS).
 */
export default defineNitroPlugin(async () => {
  try {
    const db = await getDb()
    await initSchema(db)
    // eslint-disable-next-line no-console
    console.log('[xianyu-admin] DB schema initialised (driver:', db.driver + ')')
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[xianyu-admin] DB schema init failed:', e?.message || e)
  }
})
