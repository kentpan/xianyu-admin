import { probeEngines, type EngineProbeResult } from '../../utils/xianyu/engine-probe'

/**
 * GET /api/engines — 监听引擎列表 (内置引擎 + 远程代理)。
 *
 * 返回:
 *   - engines: 引擎注册表 (含每引擎独立接入令牌 token / 心跳 last_seen_at / last_status)
 *   - activeSlug: 当前使用中的引擎 slug
 *   - builtinOnline: 内置引擎是否在线 (心跳 60s 新鲜度)
 *   - origin: 本后台对外地址 (远程代理部署配置 XY_ADMIN_URL 用)
 *
 * 在线判定:
 *   - 内置引擎: last_seen_at 60s 新鲜度
 *   - 远程代理: 登记地址 /health 实测为准 (令牌轮询心跳只证明"某处有实例在回连",
 *     证明不了登记地址存活); 未登记地址时回退轮询心跳
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()

    const rows = await db.all<any>('SELECT * FROM engines ORDER BY id ASC')
    const now = Date.now()
    const FRESH_MS = 60_000
    // 运行时承载能力: 内置引擎依赖进程内常驻调度器 + WebSocket 长连接,
    // cloudflare(workerd) 无常驻进程 → builtin 不可用, 引导用户使用远程代理
    const runtime = detectRuntime()
    const builtinSupported = runtime === 'node'

    // remote 引擎登记地址健康探测 (30s 缓存, 并发)
    const probes = await probeEngines(
      rows
        .filter((r) => r.type === 'remote' && r.host && r.port)
        .map((r) => ({ id: r.id, host: r.host, port: r.port })),
    )

    const engines = rows.map((r) => {
      const lastSeen = r.last_seen_at
        ? new Date(String(r.last_seen_at).includes('T') ? r.last_seen_at : r.last_seen_at + 'Z').getTime() ||
          new Date(r.last_seen_at).getTime()
        : 0
      const pullOnline = !!lastSeen && now - lastSeen < FRESH_MS
      const probe: EngineProbeResult | undefined = probes.get(r.id)
      const online = r.type === 'remote' && r.host && r.port ? !!probe?.ok : pullOnline
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
        online,
        /** 令牌轮询心跳是否新鲜 (与 online 分离: 地址不可达但令牌在回连时, 说明地址填错/令牌被共用) */
        pull_online: pullOnline,
        /** /health 实测详情 (探测成功时; engine_active=false = 进程活着但未在服务) */
        health:
          probe && probe.ok
            ? {
                engine_active: !!probe.engine_active,
                accounts: probe.accounts || [],
                uptime_seconds: probe.uptime_seconds || 0,
                script_version: probe.script_version || '',
              }
            : null,
        health_error: probe && !probe.ok ? probe.error || '不可达' : '',
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
