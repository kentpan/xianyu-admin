/**
 * Server startup plugin — initialises the DB schema on first boot.
 * Safe to call repeatedly (CREATE TABLE IF NOT EXISTS).
 *
 * Cloudflare Pages/Workers 说明: D1 绑定在启动阶段(无请求上下文)不可用,
 * Nitro 在首个请求时才设置 globalThis.__env__。因此启动失败时把
 * initSchema 延迟到首个请求, 且失败可重试(见 getDb 的重试逻辑)。
 */
export default defineNitroPlugin(async (nitroApp) => {
  try {
    const db = await getDb()
    await initSchema(db)
    // eslint-disable-next-line no-console
    console.log('[xianyu-admin] DB schema initialised (driver:', db.driver + ')')
    return
  } catch (e: any) {
    // Node 环境启动即失败属于真实错误, 直接报告
    if (detectRuntime() !== 'cloudflare') {
      // eslint-disable-next-line no-console
      console.error('[xianyu-admin] DB schema init failed:', e?.message || e)
      return
    }
    // eslint-disable-next-line no-console
    console.log('[xianyu-admin] D1 binding not yet available at boot, deferring schema init to first request')
  }

  // Cloudflare: 首个请求时惰性初始化(全局只跑一次, 失败后可重试)
  let initOnce: Promise<void> | null = null
  nitroApp.hooks.hook('request', async () => {
    if (!initOnce) {
      initOnce = (async () => {
        const db = await getDb()
        await initSchema(db)
        // eslint-disable-next-line no-console
        console.log('[xianyu-admin] DB schema initialised on first request (driver:', db.driver + ')')
      })().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[xianyu-admin] deferred DB schema init failed:', err?.message || err)
        initOnce = null // 允许下个请求重试
      })
    }
    await initOnce
  })
})
