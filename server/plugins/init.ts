/**
 * Server startup plugin — initialises the DB schema on first boot.
 * Safe to call repeatedly (CREATE TABLE IF NOT EXISTS).
 *
 * Cloudflare Pages/Workers 说明: D1 绑定在启动阶段(无请求上下文)不可用,
 * Nitro 在首个请求时才设置 globalThis.__env__。因此启动失败时把
 * initSchema 延迟到首个请求, 且失败可重试(见 getDb 的重试逻辑)。
 *
 * PROXY_MODE 代理透传模式 (v2.3.12): 站点不持有本地数据库 (工作流跳过
 * D1/KV 创建与绑定, /api/* 全部透传上游), schema 初始化没有意义 —— 整体跳过,
 * 否则每个请求都会打一遍注定失败的 getDb + initSchema。
 */
import { proxyModeState } from '../utils/proxy-mode'

export default defineNitroPlugin(async (nitroApp) => {
  if (proxyModeState().kind !== 'off') {
    console.log('[xianyu-admin] PROXY_MODE 代理透传模式: 本地数据库层停用, 跳过 schema 初始化')
    return
  }
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
