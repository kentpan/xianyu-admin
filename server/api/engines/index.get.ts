/**
 * GET /api/engines — 监听引擎列表 (内置引擎 + 远程代理)。
 *
 * 返回:
 *   - engines: 引擎注册表 (含每引擎独立接入令牌 token / 心跳 last_seen_at / last_status)
 *   - activeSlug: 当前使用中的引擎 slug
 *   - builtinOnline: 内置引擎是否在线 (心跳 60s 新鲜度)
 *   - origin: 本后台对外地址 (远程代理部署配置 XY_ADMIN_URL 用)
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()

    // 存量行令牌惰性补齐 (迁移幂等)
    const missing = await db.all<any>("SELECT id FROM engines WHERE token IS NULL OR token = ''")
    for (const row of missing) {
      await db.run('UPDATE engines SET token = ? WHERE id = ?', [generateEngineToken(), row.id])
    }

    const rows = await db.all<any>('SELECT * FROM engines ORDER BY id ASC')
    const now = Date.now()
    const FRESH_MS = 60_000
    // 运行时承载能力: 内置引擎依赖进程内常驻调度器 + WebSocket 长连接,
    // cloudflare(workerd) 无常驻进程 → builtin 不可用, 引导用户使用远程代理
    const runtime = detectRuntime()
    const builtinSupported = runtime === 'node'
    const engines = rows.map((r) => {
      const lastSeen = r.last_seen_at
        ? new Date(String(r.last_seen_at).includes('T') ? r.last_seen_at : r.last_seen_at + 'Z').getTime() ||
          new Date(r.last_seen_at).getTime()
        : 0
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        type: r.type,
        host: r.host || '',
        port: r.port || 0,
        token: r.token || '',
        remark: r.remark || '',
        enabled: !!r.enabled,
        is_active: !!r.is_active,
        online: !!lastSeen && now - lastSeen < FRESH_MS,
        runtime_supported: r.type === 'builtin' ? builtinSupported : true,
        last_seen_at: r.last_seen_at || null,
        last_status: r.last_status || '',
      }
    })

    const active = engines.find((e) => e.is_active) || null
    return ok({
      engines,
      active_slug: active?.slug || '',
      origin: getRequestURL(event).origin,
      runtime,
    })
  }),
)
